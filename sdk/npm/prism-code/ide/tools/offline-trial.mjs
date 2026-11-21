// A real-browser trial of the site's offline worker: headless Edge or Chrome over the DevTools protocol, no packages.
// Not run in CI: it needs a browser. Run it by hand after a change to ide/offline/ or to how the site is assembled.
//
// Usage: node tools/offline-trial.mjs <folder holding the site as prismpm/> <port> <path to msedge or chrome>
//   the site is assembled into <folder>/prismpm by build-audit-site.mjs, build-edit-site.mjs, build-offline-site.mjs,
//   with every dot-file removed, as GitHub Pages serves it.
//
// It opens the workbench page, opens it again, switches the site off and opens it a third time, then switches the
// site back on with one byte of one published file changed. It prints what each step showed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [dir, port, exe] = process.argv.slice(2);
const root = resolve(dir);
const T = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
let serving = true;
let served = 0;
const server = createServer(async (q, r) => {
  if (!serving) { q.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(root, p));
  if (!f.startsWith(root + sep)) { r.writeHead(403).end(); return; }
  try { const b = await readFile(f); served++; r.writeHead(200, { 'content-type': T[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(b); }
  catch { r.writeHead(404).end('not found'); }
});
await new Promise((ok) => server.listen(Number(port), '127.0.0.1', ok));

const profile = mkdtempSync(join(tmpdir(), 'offline-trial-'));
const debugPort = Number(port) + 1000;
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
if (!target) throw new Error('the browser did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let next = 0;
const waiting = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok) => { const id = ++next; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return { thrown: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }; return r.result?.result?.value; };
const open = async (url, ms) => { await send('Page.navigate', { url }); await sleep(ms); };
await send('Page.enable');
await send('Runtime.enable');

const base = `http://localhost:${port}/prismpm/`;
const workbench = `const m = window.prismModel; return { strip: document.getElementById('strip')?.textContent ?? null, error: m?.error ?? null, controlled: !!navigator.serviceWorker.controller, explorer: document.querySelectorAll('.explorer-folders-view .monaco-list-row').length, offline: m?.offline ?? null, kept: (await (await caches.open('prism-ide-kappa-1')).keys()).length, failed: performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400).map((r) => r.name) };`;
const out = {};

// 1. First visit, online.
await open(base + 'edit/ide/', 22000);
out.first = await evaluate(workbench);
out.servedOnFirst = served;

// 2. Second visit, online: every listed file should come from the store.
served = 0;
await open(base + 'edit/ide/', 16000);
out.second = await evaluate(workbench);
out.servedOnSecond = served;
out.kinds = await evaluate(`const tally = {}; for (const path of ['edit/ide/index.html', 'edit/lexlean.wasm.gz', 'edit/project.json', 'edit/kernel/manifest.json']) { const r = await fetch('${base}' + path); tally[path] = r.status + ' ' + r.headers.get('x-prism-kappa'); } return tally;`);

// 3. The server stops answering: the network is off for this site.
serving = false;
server.closeAllConnections?.();
await open(base + 'edit/ide/', 16000);
out.offline = await evaluate(workbench);
await open(base + 'edit/', 12000);
out.offlinePlain = await evaluate(`return { status: document.getElementById('status')?.textContent ?? null, proof: document.getElementById('proofStatus')?.textContent ?? null, controlled: !!navigator.serviceWorker.controller };`);
await open(base + 'audit/', 6000);
out.offlineAudit = await evaluate(`return { summary: document.getElementById('summary')?.textContent ?? null, title: document.title };`);

// 4. Back online, with one byte of one published file changed and the listing left alone: it must be refused.
serving = true;
const victim = join(root, 'prismpm', 'edit', 'app-match.mjs');
const original = await readFile(victim);
const altered = Buffer.from(original); altered[altered.length - 2] ^= 1;
await writeFile(victim, altered);
try {
  await open(base + 'audit/', 5000);
  out.altered = await evaluate(`await caches.delete('prism-ide-kappa-1'); const r = await fetch('${base}edit/app-match.mjs'); const other = await fetch('${base}edit/drafts.mjs'); return { status: r.status, kind: r.headers.get('x-prism-kappa'), said: (await r.text()).slice(0, 90), otherStatus: other.status, otherKind: other.headers.get('x-prism-kappa') };`);
} finally { await writeFile(victim, original); }

console.log(JSON.stringify(out, null, 1));
ws.close();
browser.kill();
server.close();
await sleep(800);
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* left in the temp folder */ }
process.exit(0);
