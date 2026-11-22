// Edit a LexLean model and see LexLean's verdict on it as you type, in this tab.
//
// The page is given a project as a listing of its files (project.json beside the page: { files: ['lexlean.toml',
// 'src/App.lex.tex', ...], entry: 'src/App.lex.tex' }) and fetches them from project/. One file is open for
// editing; after each pause the whole project, with the edited text in place, goes to the worker, which runs
// `lexlean check`. Diagnostics are listed with their line and marked beside the text.
//
// Phase 2b of docs/proposals/prism-ide-phase-2.md, first step: a plain text area, not yet the workbench editor,
// and checking only. Proving in the tab is phase 2c. Nothing is saved anywhere: a reload brings the project back.

// The pin of the LexLean executable (commit, BLAKE3 label, encoding), as prism-code states it in
// src/journey/lexlean-wasm.mjs. That module reads files, so whoever serves the page hands the pin over as pin.json.
const LEXLEAN_WASM = await (await fetch('./pin.json', { cache: 'no-store' })).json();

const $ = (id) => document.getElementById(id);
const state = (window.prismEdit = { ready: false, checks: 0, last: null, error: null, engine: null });
const PAUSE_MS = 350;

// Offline, by content: the site's service worker, where the site was assembled with one (tools/build-offline-site.mjs).
// It serves each published file only as the bytes its BLAKE3 label names, from this browser once it has them. This
// page loaded before the worker could take over, so it tells the worker what it loaded.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', location.href)).then(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data && 'warmed' in data) state.offline = data; });
    setTimeout(() => worker?.postMessage({ warm: [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)] }), 4000);
  }).catch(() => { /* no worker here: the page works as before, from the network */ });
}

// ?project=<address of a folder> opens the model published there: its project.json lists its files, which are
// fetched from that folder. Without it, the model that came with the page is opened.
const asked = new URLSearchParams(location.search).get('project');
const PROJECT = asked ? new URL(asked.replace(/\/?$/, '/'), location.href).href : null;
const files = {};
let listing;
try {
  listing = await (await fetch(PROJECT ? PROJECT + 'project.json' : './project.json', { cache: 'no-store' })).json();
  await Promise.all(listing.files.map(async (path) => {
    const response = await fetch((PROJECT ?? './project/') + path, { cache: 'no-store' });
    if (!response.ok) throw new Error(path + ' answered ' + response.status);
    files['/' + path] = await response.text();
  }));
} catch (error) {
  // A browser gives no reason when another site's files may not be read, so the likely ones are named.
  state.error = String(error?.message ?? error);
  state.ready = true;
  $('status').textContent = `The model at ${PROJECT ?? './project/'} could not be opened (${state.error}). It needs a project.json listing its files, and its host must let other sites read them.`;
  $('status').dataset.state = 'bad';
  throw error;
}
const entry = '/' + listing.entry;
const original = files[entry];
$('file').textContent = listing.entry;
$('source').value = original;

// What each executable turned out to be, once known: 'pinned', 'mismatch' or 'absent'. The terminal asks.
const settle = {};
const settled = { lexlean: new Promise((r) => { settle.lexlean = r; }), kernel: new Promise((r) => { settle.kernel = r; }) };
const worker = new Worker(new URL('./lexlean-worker.mjs', import.meta.url), { type: 'module' });
const waiting = new Map();
let nextId = 0;
worker.onmessage = ({ data }) => {
  if (data.ready) { settle.lexlean('pinned'); state.engine = data; $('engine').textContent = `LexLean ${LEXLEAN_WASM.commit.slice(0, 7)}, ${(data.bytes / 1048576).toFixed(1)} MB, checked against ${data.kappa.slice(0, 19)}… and ready in ${data.ms} ms`; return; }
  if (data.failed) { settle.lexlean(data.reason ?? 'absent'); state.error = data.failed; $('engine').textContent = 'LexLean could not start: ' + data.failed; $('status').textContent = 'Not checked.'; state.ready = true; return; }
  waiting.get(data.id)?.(data);
  waiting.delete(data.id);
};
worker.postMessage({ start: { url: new URL('./lexlean.wasm.gz', import.meta.url).href, pin: { kappa: LEXLEAN_WASM.kappa, encoding: LEXLEAN_WASM.encoding } } });
const check = (project) => new Promise((resolve) => { const id = ++nextId; waiting.set(id, resolve); worker.postMessage({ id, files: project }); });
const snapshotOf = (project) => new Promise((resolve) => { const id = ++nextId; waiting.set(id, resolve); worker.postMessage({ id, files: project, snapshot: true }); });

// Lean's kernel, in its own worker, so a proof never holds up typing.
const { ruleTable, tableWords, tableShape, counterexample, OPS } = await import('./prism-code/journey/rule-table.mjs');
// The app this model was published with, if any: its record says what the app runs.
const { appRecord, tableFacts, differences, verdict } = await import('./app-match.mjs');
const beside = await appRecord(PROJECT);
// A holo app has another record: the label of its holo and the identity of the model it was built from.
const { holoAppRecord, holoVerdict } = await import('./holo-match.mjs');
const holoBeside = beside ? null : await holoAppRecord(PROJECT);
function compare(table, text) {
  if (!PROJECT) { $('appMatch').hidden = true; state.app = null; return; }
  if (holoBeside) {
    const said = holoVerdict(holoBeside, state.last?.semanticId, text !== original);
    state.app = { found: true, kind: 'holo', state: said.state, holo: holoBeside.holo };
    $('appMatch').textContent = said.text;
    $('appMatch').dataset.state = said.state;
    $('appMatch').hidden = false;
    return;
  }
  const differs = beside && table ? differences(tableFacts(table, { tableWords, tableShape }), beside.record) : [];
  const said = !beside ? verdict(null, [], false) : !table ? { state: 'unread', text: `This model is not read as a rule table here, so it is not compared with the app at ${beside.app}.` } : verdict(beside, differs, text !== original);
  state.app = { found: !!beside, state: said.state, differs };
  $('appMatch').textContent = said.text;
  $('appMatch').dataset.state = said.state;
  $('appMatch').hidden = false;
}
const prover = new Worker(new URL('./prove-worker.mjs', import.meta.url), { type: 'module' });
const proving = new Map();
prover.onmessage = ({ data }) => {
  if (data.ready) { settle.kernel('pinned'); state.kernel = data; return; }
  if (data.failed) { settle.kernel(data.reason ?? 'absent'); state.kernel = { failed: data.failed }; for (const done of proving.values()) done({ error: data.failed }); proving.clear(); return; }
  proving.get(data.id)?.(data);
  proving.delete(data.id);
};
const prove = (words, guarantees) => (state.kernel?.failed ? Promise.resolve({ error: state.kernel.failed })
  : new Promise((resolve) => { const id = ++nextId; proving.set(id, resolve); prover.postMessage({ id, words, guarantees }); }));

// After a clean check: read the model as a rule table, look for a request that breaks each guarantee, then have the
// kernel judge each. A breaking request is found by trying every request in the bounds; proved is the kernel's word.
async function guarantees(project, mine) {
  const cell = (tr, i) => tr.children[i];
  const taken = await snapshotOf(project);
  if (mine !== latest) return;
  let table;
  try { table = ruleTable(JSON.parse(taken.snapshot)); } catch (e) {
    $('guaranteesSection').hidden = false;
    $('guarantees').replaceChildren();
    $('proofStatus').textContent = 'This model is not a rule table, so its guarantees are not proved in this tab: ' + (e?.message ?? e);
    state.proof = { table: false, why: String(e?.message ?? e) };
    compare(null, project[entry]);
    return;
  }
  compare(table, project[entry]);
  const value = (f, v) => (f.values ? f.values[v] : v);
  const said = (g) => 'When ' + g.when.map(([f, op, v]) => table.fields[f].name + ' ' + OPS[op] + ' ' + value(table.fields[f], v)).join(' and ')
    + ', the answer is ' + (g.always ? 'always ' : 'never ') + table.answers[g.outcome] + '.';
  const rows = table.guarantees.map((g) => {
    const tr = document.createElement('tr');
    const found = counterexample(table, g);
    const broken = found.request !== null;
    for (const text of [said(g), broken ? 'broken' : 'proving…', broken ? 'the request "' + found.request + '" answers ' + found.answer : '']) tr.append(Object.assign(document.createElement('td'), { textContent: text }));
    cell(tr, 1).className = 's';
    if (broken) cell(tr, 1).dataset.s = 'broken';
    return { tr, broken, request: found.request };
  });
  $('guarantees').replaceChildren(...rows.map((r) => r.tr));
  $('guaranteesSection').hidden = false;
  $('proofStatus').textContent = "Asking Lean's kernel about " + rows.length + ' guarantee' + (rows.length === 1 ? '' : 's') + '…';
  const shaped = tableWords(table);
  const reply = await prove(shaped.words, shaped.guarantees);
  if (mine !== latest) return;
  if (reply.error) {
    for (const r of rows) if (!r.broken) { cell(r.tr, 1).textContent = 'not proved here'; cell(r.tr, 2).textContent = 'no request in the bounds breaks it'; }
    $('proofStatus').textContent = "Lean's kernel could not run in this tab: " + reply.error;
    state.proof = { table: true, error: reply.error, broken: rows.filter((r) => r.broken).length };
    return;
  }
  let count = 0;
  for (const [i, r] of rows.entries()) {
    const ok = reply.results[i].proved;
    if (ok) count++;
    const status = ok ? 'proved' : r.broken ? 'broken' : 'refused';
    cell(r.tr, 1).textContent = status;
    cell(r.tr, 1).dataset.s = status;
    if (ok) cell(r.tr, 2).textContent = "accepted by Lean's kernel in this tab";
    else if (!r.broken) cell(r.tr, 2).textContent = "Lean's kernel did not accept it, and no request in the bounds breaks it";
  }
  $('proofStatus').textContent = count + ' of ' + rows.length + " proved by Lean's kernel in this tab, in " + reply.ms + ' ms.';
  state.proof = { table: true, proved: count, total: rows.length, ms: reply.ms, statuses: rows.map((r) => cell(r.tr, 1).textContent), breaking: rows.map((r) => r.request) };
}

function gutter(marks) {
  const lines = $('source').value.split('\n').length;
  $('gutter').replaceChildren(...Array.from({ length: lines }, (_, i) => {
    const line = document.createElement('span');
    line.textContent = (marks.has(i + 1) ? '●' : ' ') + String(i + 1).padStart(4) + '\n';
    if (marks.has(i + 1)) line.className = 'mark';
    return line;
  }));
}
function goTo(line, column) {
  const text = $('source').value;
  let at = 0;
  for (let n = 1; n < line; n++) at = text.indexOf('\n', at) + 1;
  $('source').focus();
  $('source').setSelectionRange(at + column - 1, at + column - 1);
  // A text area scrolls by pixels; one line is its line height.
  $('source').scrollTop = Math.max(0, (line - 4) * parseFloat(getComputedStyle($('source')).lineHeight));
  $('gutter').scrollTop = $('source').scrollTop;
}

let latest = 0;
async function run() {
  const mine = ++latest;
  $('status').textContent = 'Checking…';
  const reply = await check({ ...files, [entry]: $('source').value });
  if (mine !== latest) return; // a newer edit is already being checked
  state.checks++;
  $('diagnostics').replaceChildren();
  const marks = new Set();
  if (reply.error) {
    state.last = { error: reply.error };
    $('status').textContent = 'LexLean did not answer: ' + reply.error;
  } else {
    const result = reply.result;
    const own = (d) => (d.primary?.path ?? '').replace(/^\//, '') === listing.entry;
    state.last = { success: result.success, ms: reply.ms, semanticId: result.semantic_id ?? null, diagnostics: result.diagnostics.map((d) => ({ code: d.code, line: d.primary?.line_start, column: d.primary?.column_start, path: d.primary?.path, message: d.message })) };
    for (const d of result.diagnostics) {
      const item = document.createElement('li');
      const where = d.primary ? `${d.primary.path}:${d.primary.line_start}:${d.primary.column_start}` : '';
      const link = document.createElement(own(d) ? 'button' : 'span');
      link.textContent = where;
      if (own(d)) { link.type = 'button'; link.addEventListener('click', () => goTo(d.primary.line_start, d.primary.column_start)); marks.add(d.primary.line_start); }
      item.append(link, ` ${d.code}: ${d.message}`);
      $('diagnostics').append(item);
    }
    $('status').textContent = result.success
      ? `The model checks, in ${reply.ms} ms. Its identity is ${result.semantic_id ? 'sha256:' + result.semantic_id.replace(/^sha256:/, '') : 'not given'}.`
      : `${result.diagnostics.length} problem${result.diagnostics.length === 1 ? '' : 's'}, found in ${reply.ms} ms.`;
    $('status').dataset.state = result.success ? 'ok' : 'bad';
  }
  gutter(marks);
  // A model that does not check has no meaning to prove anything about.
  if (!state.last?.success) { $('guaranteesSection').hidden = true; state.proof = null; $('appMatch').hidden = true; }
  else { state.proving = true; await guarantees({ ...files, [entry]: $('source').value }, mine); if (mine === latest) state.proving = false; }
  state.ready = true;
}

let timer = null;
$('source').addEventListener('input', () => { clearTimeout(timer); gutter(new Set()); timer = setTimeout(run, PAUSE_MS); });
$('source').addEventListener('scroll', () => { $('gutter').scrollTop = $('source').scrollTop; });
$('revert').addEventListener('click', () => { $('source').value = original; run(); });
gutter(new Set());
run();

// The terminal: a command line for this model, on xterm.js. It gets the page's own workers and nothing else.
import('./terminal/terminal.mjs').then(({ startTerminal }) => startTerminal($('terminal'), {
  project: () => ({ ...files, [entry]: $('source').value }),
  check, snapshotOf, prove,
  held: async () => ({ lexlean: await settled.lexlean, kernel: await settled.kernel }),
  pin: LEXLEAN_WASM,
  setTitle: (text) => { $('terminalTitle').textContent = text; },
  find: $('terminalFind'),
  // The six commands that change a file change what this page holds: the open file in the editor, the others in
  // memory. As with typing, nothing is saved anywhere, and the model is checked again.
  change: {
    write: (path, text) => { if (path === entry) $('source').value = text; else files[path] = text; clearTimeout(timer); run(); },
    remove: (path) => { if (path === entry) throw new Error(listing.entry + ' is the file open in the editor; it stays'); delete files[path]; clearTimeout(timer); run(); },
  },
})).catch((error) => { $('terminal').textContent = 'The terminal could not start: ' + (error?.message ?? error); });
