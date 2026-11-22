// The terminal in a real browser: both pages are opened in headless Chrome, lines are entered, and keys are timed.
//
// tools/terminal-test.mjs tests the command line with no browser. This is what that cannot show: that the pages
// start, that the emulator draws, that a line typed into each terminal is answered, and how long a key takes to
// be drawn. It serves the pages itself (tools/serve-edit.mjs) and drives Chrome over its debugging protocol.
//
// Usage: node tools/terminal-browser-test.mjs [--keys N] [--require-workbench] [--base <address of a published site>]
//   --keys N              keys timed in each page (default 1000)
//   --require-workbench   fail when the workbench has not been built (npx vite build -c vite.model.config.js)
//   --base <address>      test a site that is already served, e.g. https://uor-foundation.github.io/prismpm
// It needs puppeteer-core, which is not one of the IDE's dependencies: npm install --no-save puppeteer-core@23.11.1
// and Chrome, found at CHROME_PATH or where the system keeps it.
//
// What fails it: a page error, a file the page could not fetch, a line answered wrongly, a key that was never
// drawn, or the slowest twentieth of keys taking over 50 ms. The figures are printed either way.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ide = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, otherwise) => { const at = args.indexOf(name); return at < 0 ? otherwise : args[at + 1]; };
const keys = Number(option('--keys', '1000'));
const given = option('--base', null);
const built = existsSync(join(ide, 'dist-model', 'model.html'));
const P95_MS = 50;

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => path && existsSync(path));
if (!chrome) { console.error('No Chrome was found. Set CHROME_PATH to its executable.'); process.exit(64); }
let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch { console.error('puppeteer-core is not installed: npm install --no-save puppeteer-core@23.11.1'); process.exit(64); }

// Each line and what its answer must hold. The model is the capability gate's, which the pages open by default.
const LINES = [
  ['ls | grep tex | wc -l', /^\s*5\b/],
  ['for f in a b; do echo "<$f>"; done', /<a> \/ <b>/],
  ['echo $((6 * 7)) $(ls | grep -c toml)', /^42 \d+/],
  ['greet() { echo "hello $1"; }; greet there', /hello there/],
  ['case lexlean.toml in *.toml) echo a-toml ;; *) echo other ;; esac', /a-toml/],
  ['echo made > note.txt && cat note.txt; rm note.txt; [ -f note.txt ] || echo gone', /made \/ gone/],
  ['prove | tail -1', /13 of 13 proved by Lean's kernel in this tab\./],
  ['bash -c ls', /bash: not a command here/],
  ['echo x > ../outside.txt', /not in the open model/],
];

// In the page: read the screen, enter a line, time keys.
const install = () => {
  window.__t = {
    screen(term) { const b = term.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); while (out.length && out[out.length - 1] === '') out.pop(); return out; },
    async enter(term, editor, feed, line) {
      const before = this.screen(term).length;
      const t0 = performance.now();
      await feed(line);
      await feed('\r');
      for (let i = 0; i < 4000 && editor.busy; i++) await new Promise((x) => setTimeout(x, 5));
      const ms = +(performance.now() - t0).toFixed(1);
      await new Promise((x) => setTimeout(x, 250));
      return { ms, text: this.screen(term).slice(before).join(' / ') };
    },
    /** Each key from reaching the emulator to the frame that draws its echo; a key not drawn in 2 s is lost. */
    async keys(term, count) {
      (term.element?.closest('#terminal') ?? term.element)?.scrollIntoView({ block: 'center' });
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await frame();
      const times = [];
      let lost = 0;
      for (let i = 0; i < count; i++) {
        if (i % 60 === 59) { term.input('\x15'); await frame(); }
        const t0 = performance.now();
        const took = await new Promise((resolve) => {
          const timer = setTimeout(() => { d.dispose(); resolve(null); }, 2000);
          const d = term.onRender(() => { d.dispose(); clearTimeout(timer); resolve(performance.now() - t0); });
          term.input('abcdefghijklmnopqrstuvwxyz'[i % 26]);
        });
        if (took === null) lost++; else times.push(took);
      }
      term.input('\x15');
      await frame();
      times.sort((a, b) => a - b);
      const q = (p) => (times.length ? +times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(1) : null);
      return { keys: count, lost, median: q(0.5), p95: q(0.95), worst: q(1), over33: times.filter((t) => t > 33.4).length };
    },
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server = null;
let base = given;
if (!base) {
  const port = 4300 + Math.floor(Math.random() * 400);
  server = spawn(process.execPath, [join(ide, 'tools', 'serve-edit.mjs'), join(ide, '..', 'model', 'ide-capability-gate'), String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
  base = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await fetch(base + '/edit/').then((r) => r.ok, () => false); }
  if (!up) { server.kill(); console.error('The pages were not served.'); process.exit(1); }
}

const problems = [];
const report = {};
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 180000, args: ['--no-sandbox', '--window-size=1400,1000'], defaultViewport: { width: 1400, height: 1000 } });
try {
  for (const path of ['/edit/', '/edit/ide/']) {
    const plain = path === '/edit/';
    if (!plain && !given && !built) {
      report[path] = { skipped: 'the workbench is not built' };
      if (args.includes('--require-workbench')) problems.push(path + ': the workbench is not built');
      continue;
    }
    const r = (report[path] = {});
    const page = await browser.newPage();
    const errors = [];
    const missing = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) missing.push(res.status() + ' ' + res.url().replace(base, '')); });
    try {
      await page.goto(base + path, { waitUntil: 'load' });
      await page.waitForFunction(plain ? 'window.prismTerminal?.ready === true || !!window.prismTerminal?.error'
        : 'window.prismModel?.terminals?.length > 0 && !!window.prismModel?.xterm?.() && !!window.prismModel.terminals[0].line', { timeout: 150000 });
      await page.evaluate(install);
      // The page's own first check and proof are let finish, so they are not what the lines and keys wait on.
      await sleep(8000);
      if (plain) r.start = await page.evaluate(() => ({ error: window.prismTerminal.error, renderer: window.prismTerminal.renderer, timing: window.prismTerminal.timing }));
      if (r.start?.error) throw new Error('the terminal did not start: ' + r.start.error);
      r.lines = {};
      for (const [line, wanted] of LINES) {
        const got = await page.evaluate((line, plain) => {
          const T = plain ? window.prismTerminal : null;
          const P = plain ? null : window.prismModel;
          const term = plain ? T.term : P.xterm();
          const editor = plain ? T.editor : P.terminals[0].line.editor;
          const feed = plain ? async (data) => { if (data === '\r') await T.editor.feed(data); else for (const ch of data) await T.editor.feed(ch); } : async (data) => { P.terminals[0].input(data); };
          return window.__t.enter(term, editor, feed, line);
        }, line, plain);
        r.lines[line] = got;
        if (!wanted.test(got.text)) problems.push(`${path}: \`${line}\` answered ${JSON.stringify(got.text.slice(0, 200))}`);
      }
      if (keys > 0) {
        r.keys = await page.evaluate((count, plain) => window.__t.keys(plain ? window.prismTerminal.term : window.prismModel.xterm(), count), keys, plain);
        if (r.keys.lost > 0) problems.push(`${path}: ${r.keys.lost} of ${keys} keys were never drawn`);
        if (r.keys.p95 === null || r.keys.p95 > P95_MS) problems.push(`${path}: the 95th percentile key took ${r.keys.p95} ms, over ${P95_MS} ms`);
      }
    } catch (error) { problems.push(`${path}: ${String(error?.message ?? error).slice(0, 300)}`); }
    r.errors = errors.slice(0, 5);
    r.missing = missing.slice(0, 8);
    for (const error of r.errors) problems.push(`${path}: page error: ${error}`);
    for (const file of r.missing) problems.push(`${path}: not fetched: ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

console.log(JSON.stringify(report, null, 1));
for (const [path, r] of Object.entries(report)) if (r.keys) console.log(`${path} ${r.keys.keys} keys: median ${r.keys.median} ms, 95th percentile ${r.keys.p95} ms, worst ${r.keys.worst} ms, ${r.keys.lost} lost`);
if (problems.length) { console.log('FAILED\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`ok: ${Object.keys(report).filter((p) => !report[p].skipped).length} page(s), ${LINES.length} lines each`);
