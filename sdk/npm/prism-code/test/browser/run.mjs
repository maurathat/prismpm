// Runs test/browser/build.html in Chromium, Firefox and WebKit and compares each with this process.
//
//   node test/browser/run.mjs [--shell <a Holospace shell checkout>] [--browsers chromium,firefox,webkit]
//
// For each starter that builds a holo, this process starts the app in a temporary folder, takes its snapshot with
// LexLean as WebAssembly and builds its holo. The page then does the same from the same files, in a worker, and
// must name the holo by the same κ-label. With --shell, the holo is also kept in the shell's store, a changed byte
// planted there must be refused, and the shell's own path must answer `verified`.
//
// Playwright is not a dependency of this package: it is taken from PLAYWRIGHT (a path to its index.mjs), else
// from the global npm root. PW_EXECUTABLES='{"firefox":"…"}' names browsers installed elsewhere.
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appDir, startApp } from '../../src/journey/project.mjs';
import { LEXLEAN_WASM, lexleanReady, lexleanWasmFile, projectFiles, wasmSnapshot } from '../../src/journey/lexlean-wasm.mjs';
import { EVALUATOR_GUEST } from '../../src/journey/model-guest.mjs';
import { buildHolo } from '../../src/journey/model-holo.mjs';
import { modelProgram } from '../../src/journey/model-eval.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const shellDir = option('shell') ? resolve(option('shell')) : null;
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const NAMES = ['decision-app', 'stateful-app'];
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

if (!(await lexleanReady({}))) throw new Error('LexLean as WebAssembly is not on this machine');
const lexleanFile = lexleanWasmFile({});
const evaluator = readFileSync(new URL(`../../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url));

// Each starter, started here, and what this process builds from it.
const projects = new Map();
const node = [];
for (const name of NAMES) {
  const cwd = mkdtempSync(join(tmpdir(), `prism-browser-${name}-`));
  const dir = appDir(cwd);
  startApp(dir, name);
  const t0 = performance.now();
  const taken = await wasmSnapshot(dir, {});
  if (!taken.ok) throw new Error(`${name}: LexLean refused the starter`);
  const t1 = performance.now();
  const built = await buildHolo(taken.snapshot, { evaluator, snapshotBytes: taken.bytes });
  const vector = modelProgram(taken.snapshot).application.acceptanceVectors.find((v) => v.request.length > 0);
  node.push({ name, snapshotMs: Math.round(t1 - t0), buildMs: Math.round(performance.now() - t1), holoBytes: built.bytes.length, label: built.label });
  projects.set(name, JSON.stringify({ expected: built.label, vector: { request: base64(vector.request), response: base64(vector.response) }, files: Object.fromEntries([...projectFiles(dir)].map(([path, bytes]) => [path, base64(bytes)])) }));
}

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.holo': 'application/octet-stream', '.gz': 'application/gzip' };
const pins = { lexlean: LEXLEAN_WASM.kappa, shell: shellDir ? JSON.parse(readFileSync(join(shellDir, 'kernels', 'kernel.json'), 'utf8')).sha256 : null };
const under = (folder, rest) => { const file = resolve(folder, `.${sep}${rest}`); return file.startsWith(resolve(folder) + sep) && existsSync(file) && statSync(file).isFile() ? file : null; };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const send = (body, type) => { response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(body); };
  if (path === '/pins.json') return send(JSON.stringify(pins), TYPES['.json']);
  if (path === '/lexlean.wasm.gz') return send(readFileSync(lexleanFile), TYPES['.gz']);
  const project = /^\/projects\/([a-z-]+)\.json$/.exec(path);
  if (project && projects.has(project[1])) return send(projects.get(project[1]), TYPES['.json']);
  const file = path.startsWith('/prism-code/') ? under(join(root, 'src'), path.slice('/prism-code/'.length))
    : path.startsWith('/shell/') && shellDir ? under(shellDir, path.slice('/shell/'.length))
      : under(join(root, 'test', 'browser'), path.slice(1));
  if (!file) { response.writeHead(404); response.end('not found'); return; }
  return send(readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/build.html`;

const playwrightAt = process.env.PLAYWRIGHT ?? join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs');
const pw = await import(pathToFileURL(playwrightAt).href);
const executables = process.env.PW_EXECUTABLES ? JSON.parse(process.env.PW_EXECUTABLES) : {};
console.log(`node ${process.version}: ${JSON.stringify(node)}`);
let bad = 0;
for (const name of browsers) {
  let browser;
  try {
    browser = await pw[name].launch({ headless: true, executablePath: executables[name] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const started = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => window.results, null, { timeout: 300000 });
    const { start, rows } = await page.evaluate(() => window.results);
    console.log(`=== ${name} ${browser.version()} (${((Date.now() - started) / 1000).toFixed(1)} s wall) ${JSON.stringify(start)}`);
    for (const row of rows) { if (!row.ok) bad += 1; console.log(`  ${JSON.stringify(row)}`); }
    if (rows.length !== NAMES.length) bad += 1;
    if (errors.length) console.log(`  errors: ${errors.join(' | ').slice(0, 300)}`);
  } catch (error) {
    bad += 1;
    console.log(`=== ${name}: ${error.message.split('\n')[0]}`);
  }
  await browser?.close();
}
server.close();
process.exit(bad ? 1 : 0);
