// A LexLean model open in the VS Code workbench, checked and proved as it is edited.
//
// The editor, the Problems panel and the squiggles are the workbench's own (@codingame/monaco-vscode-api). What
// they show comes from the same two workers as the plain edit page (../edit): LexLean's pinned front end checks the
// model after every pause, and, when it checks and is a rule table, Lean's kernel judges each guarantee.
//
//   A LexLean diagnostic        -> an error marker at its place in the file
//   A guarantee a request breaks -> an error marker on the line that states the guarantees, naming the request
//   Everything proved            -> no marker; the strip above the workbench says how many
//
// Every file of the model is in the workbench's Explorer and can be opened and changed. A check reads all of them
// as they stand in the editor, and a diagnostic is marked in the file it is about.
//
// The page is served beside ../edit by tools/serve-edit.mjs, which gives it the project, the LexLean executable and
// the kernel. No extension runs here, so the capability gate of main.js has nothing to judge and is not loaded.

import { initialize, getService, ICommandService, IEditorService, IMarkerService, IWorkbenchThemeService } from '@codingame/monaco-vscode-api/services';
import getExtensionsOverride from '@codingame/monaco-vscode-extensions-service-override';
import getFilesOverride, { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import getConfigurationOverride, { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import getWorkbenchOverride from '@codingame/monaco-vscode-workbench-service-override';
import getModelOverride from '@codingame/monaco-vscode-model-service-override';
import getLanguagesOverride from '@codingame/monaco-vscode-languages-service-override';
import getThemeOverride from '@codingame/monaco-vscode-theme-service-override';
import getMarkersOverride from '@codingame/monaco-vscode-markers-service-override';
import getStorageOverride from '@codingame/monaco-vscode-storage-service-override';
import getLifecycleOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getNotificationsOverride from '@codingame/monaco-vscode-notifications-service-override';
import getDialogsOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getExplorerOverride from '@codingame/monaco-vscode-explorer-service-override';
import getKeybindingsOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getQuickAccessOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import extHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';
import editorWorkerUrl from '@codingame/monaco-vscode-api/workers/editor.worker?worker&url';
import { LEXLEAN, registerLexLean, tokenTypes } from './lexlean-language.js';
import { prismTerminal } from './model-terminal.js';
import { ITerminalService } from '@codingame/monaco-vscode-terminal-service-override';

const PAUSE_MS = 350;
const ERROR = 8; // MarkerSeverity.Error
const strip = document.getElementById('strip');
const state = (window.prismModel = { ready: false, checks: 0, last: null, proof: null, error: null, markers: 0 });
const say = (text, kind) => { strip.textContent = text; strip.dataset.state = kind ?? ''; };

// Offline, by content: the site's service worker, where the site was assembled with one (tools/build-offline-site.mjs).
// It serves each published file only as the bytes its BLAKE3 label names, from this browser once it has them. This
// page loaded before the worker could take over, so it tells the worker what it loaded.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../../sw.js', location.href)).then(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data && 'warmed' in data) state.offline = data; });
    setTimeout(() => worker?.postMessage({ warm: [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)] }), 4000);
  }).catch(() => { /* no worker here: the page works as before, from the network */ });
}

// The edit page's files, served beside this page. Plain URLs, so the bundler leaves the workers as they are.
// This page lives in the edit page's folder, at ide/, wherever that folder is published.
const EDIT = new URL('../', location.href).href;
const json = async (url) => (await fetch(url, { cache: 'no-store' })).json();
// ?project=<address of a folder> opens the model published there: its project.json lists its files, which are
// fetched from that folder. Without it, the model that came with the page is opened.
const asked = new URLSearchParams(location.search).get('project');
const PROJECT = asked ? new URL(asked.replace(/\/?$/, '/'), location.href).href : null;
const files = {};
let listing, pin;
// ?model=blake3:<label>&registry=<address>&namespace=<name> opens a model by its content: the archive "Download
// model" makes, fetched from a kappa-registry under its BLAKE3 label and taken only if its bytes are that label.
const wanted = new URLSearchParams(location.search);
const BY_LABEL = wanted.get('model') ? { label: wanted.get('model'), registry: wanted.get('registry') ?? '', namespace: wanted.get('namespace') ?? '' } : null;
if (BY_LABEL) {
  try {
    const [{ fetchBlob }, { readModelTar }] = await Promise.all([import(/* @vite-ignore */ EDIT + 'kappa-registry.mjs'), import(/* @vite-ignore */ EDIT + 'model-tar.mjs')]);
    pin = await json(EDIT + 'pin.json');
    const blob = await fetchBlob(BY_LABEL.registry, BY_LABEL.namespace, BY_LABEL.label);
    const read = readModelTar(blob.bytes);
    for (const [path, text] of Object.entries(read.files)) files['/' + path] = text;
    listing = { files: Object.keys(read.files).sort(), entry: read.entry };
    state.source = { kind: 'registry', label: BY_LABEL.label, address: blob.address, bytes: blob.bytes.length, files: listing.files.length };
  } catch (error) {
    state.error = String(error?.message ?? error);
    state.source = { kind: 'registry', label: BY_LABEL.label, refused: error?.code ?? 'unreadable' };
    say(`The model ${BY_LABEL.label} could not be opened: ${state.error}`, 'bad');
    throw error;
  }
} else try {
  [listing, pin] = await Promise.all([json(PROJECT ? PROJECT + 'project.json' : EDIT + 'project.json'), json(EDIT + 'pin.json')]);
  await Promise.all(listing.files.map(async (path) => {
    const response = await fetch((PROJECT ?? EDIT + 'project/') + path, { cache: 'no-store' });
    if (!response.ok) throw new Error(path + ' answered ' + response.status);
    files['/' + path] = await response.text();
  }));
} catch (error) {
  // A browser gives no reason when another site's files may not be read, so the likely ones are named.
  state.error = String(error?.message ?? error);
  say(`The model at ${PROJECT ?? EDIT + 'project/'} could not be opened (${state.error}). It needs a project.json listing its files, and its host must let other sites read them.`, 'bad');
  throw error;
}
const entry = '/' + listing.entry;
const { ruleTable, tableWords, tableShape, counterexample, OPS } = await import(/* @vite-ignore */ EDIT + 'prism-code/journey/rule-table.mjs');
// The app this model was published with, if any: its record says what the app runs.
const { appRecord, tableFacts, differences, verdict } = await import(/* @vite-ignore */ EDIT + 'app-match.mjs');
const beside = await appRecord(PROJECT);
// A holo app has another record: the label of its holo and the identity of the model it was built from.
const { holoAppRecord, holoVerdict } = await import(/* @vite-ignore */ EDIT + 'holo-match.mjs');
const holoBeside = beside ? null : await holoAppRecord(PROJECT);
const original = files[entry];
const matchLine = document.getElementById('match');
function compare(table, edited) {
  if (BY_LABEL) {
    // A model opened by its label is compared with no app; what is known is where it came from and that it is those bytes.
    state.app = null;
    matchLine.textContent = edited
      ? `Opened as ${BY_LABEL.label} from ${state.source.address}. You have changed it since: "Download model" gives the label of what is in the editor now.`
      : `This is the model ${BY_LABEL.label}: ${state.source.bytes} bytes fetched from ${state.source.address}, which derive to that label. It is compared with no app.`;
    matchLine.dataset.state = edited ? 'changed' : 'same';
    matchLine.hidden = false;
    return;
  }
  if (!PROJECT) { matchLine.hidden = true; state.app = null; return; }
  if (holoBeside) {
    const said = holoVerdict(holoBeside, state.last?.semanticId, edited);
    state.app = { found: true, kind: 'holo', state: said.state, holo: holoBeside.holo };
    matchLine.textContent = said.text;
    matchLine.dataset.state = said.state;
    matchLine.hidden = false;
    return;
  }
  const differs = beside && table ? differences(tableFacts(table, { tableWords, tableShape }), beside.record) : [];
  const said = !beside ? verdict(null, [], false) : !table ? { state: 'unread', text: `This model is not read as a rule table here, so it is not compared with the app at ${beside.app}.` } : verdict(beside, differs, edited);
  state.app = { found: !!beside, state: said.state, differs };
  matchLine.textContent = said.text;
  matchLine.dataset.state = said.state;
  matchLine.hidden = false;
}

// The reader's changes from an earlier visit, kept in this browser under BLAKE3 labels for exactly this model.
const { baseLabel, openDrafts } = await import(/* @vite-ignore */ EDIT + 'drafts.mjs');
const drafts = await openDrafts();
const base = baseLabel(listing.entry, files);
const kept = await drafts.load(base);
// A path the model no longer has is not restored: the draft is for this model, so there should be none.
const restored = Object.fromEntries(Object.entries(kept.restored).filter(([path]) => path in files));
const draftLine = document.getElementById('draft');
const draftText = document.getElementById('draftText');
state.draft = { base, off: drafts.off, restored: Object.keys(restored), dropped: kept.dropped, kept: Object.keys(restored) };
function sayDraft(paths) {
  state.draft.kept = paths;
  const names = paths.map((path) => path.replace(/^\//, '')).join(', ');
  const lost = kept.dropped.length ? ` ${kept.dropped.length} earlier change${kept.dropped.length === 1 ? ' was' : 's were'} not restored: the stored text is no longer what its label names.` : '';
  draftLine.hidden = paths.length === 0 && !lost;
  draftText.textContent = (paths.length === 0 ? '' : drafts.off
    ? `Changed: ${names}. This browser keeps nothing for this page, so a reload loses the change${paths.length === 1 ? '' : 's'}.`
    : `Changed and kept in this browser: ${names}.`) + lost;
  document.getElementById('draftDiscard').hidden = paths.length === 0;
}
document.getElementById('draftDiscard').addEventListener('click', async () => { await drafts.discard(base); location.reload(); });

// The model as one file the reader can take away: a tar archive named by the BLAKE3 label of its bytes.
const { modelTar } = await import(/* @vite-ignore */ EDIT + 'model-tar.mjs');

// One request at a time to each worker, matched by id.
function channel(url, onNote) {
  const worker = new Worker(url, { type: 'module' });
  const waiting = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    if (data.id === undefined) { onNote(data); if (data.failed) { for (const done of waiting.values()) done({ error: data.failed }); waiting.clear(); } return; }
    waiting.get(data.id)?.(data);
    waiting.delete(data.id);
  };
  return { post: (message) => worker.postMessage(message), ask: (message) => new Promise((resolve) => { const id = ++next; waiting.set(id, resolve); worker.postMessage({ id, ...message }); }) };
}
// What each executable turned out to be, once known: 'pinned', 'mismatch' or 'absent'. The terminal asks.
const settle = {};
const settled = { lexlean: new Promise((r) => { settle.lexlean = r; }), kernel: new Promise((r) => { settle.kernel = r; }) };
const noted = (which) => (note) => { state[which] = note; if (note.ready) settle[which]('pinned'); if (note.failed) settle[which](note.reason ?? 'absent'); };
const lexlean = channel(EDIT + 'lexlean-worker.mjs', noted('lexlean'));
lexlean.post({ start: { url: EDIT + 'lexlean.wasm.gz', pin: { kappa: pin.kappa, encoding: pin.encoding } } });
const kernel = channel(EDIT + 'prove-worker.mjs', noted('kernel'));

// The terminal panel's command line: the one the plain edit page uses, from the files published beside it.
// `projectNow` is the model as it is in the editor, once the editor has opened it.
let projectNow = () => files;
// How a terminal command changes a file of the model, once the editor has opened it.
let changeNow = null;
const changing = (how) => (...args) => { if (!changeNow) throw new Error('the editor is still opening'); return changeNow[how](...args); };
const terminals = [];
async function commandLine(io) {
  const at = (path) => import(/* @vite-ignore */ EDIT + path);
  const [{ createCommandLine }, { createKeptIn, openStore }, { kappa }, { reuseAdmits }, rules, published, manifest] = await Promise.all([
    at('terminal/programs.mjs'), at('terminal/kappa-space.mjs'), at('prism-code/blake3.mjs'), at('prism-code/journey/kappa-rules.mjs'), at('prism-code/journey/rule-table.mjs'),
    json(EDIT + 'terminal/tables.json'), json(EDIT + 'kernel/manifest.json').catch(() => null),
  ]);
  return createCommandLine({
    tables: published.tables, luts: published.luts, rules, kappa, reuseAdmits, project: () => projectNow(),
    check: (project) => lexlean.ask({ files: project }), snapshotOf: (project) => lexlean.ask({ files: project, snapshot: true }),
    prove: (words, guarantees) => kernel.ask({ words, guarantees }),
    held: async () => ({ lexlean: await settled.lexlean, kernel: await settled.kernel }),
    pin, manifest, kept: createKeptIn(await openStore({ kappa })), change: { write: changing('write'), remove: changing('remove') }, ...io,
  });
}

window.MonacoEnvironment = {
  getWorkerUrl: (_moduleId, label) => (label === 'extensionHostWorkerMain' ? extHostWorkerUrl : editorWorkerUrl),
  getWorkerOptions: () => ({ type: 'module' }),
};

try {
  // The project, as files the workbench can open. The model's entrypoint is the one that gets edited.
  const provider = new RegisteredFileSystemProvider(false);
  const uriOf = (path) => URI.file('/workspace' + path);
  // A file the reader changed on an earlier visit opens as they left it; `files` stays the model as fetched.
  // Each file's registration, so a file a terminal command removes or replaces can be taken out again.
  const registered = {};
  const register = (path, text) => { registered[path]?.dispose(); registered[path] = provider.registerFile(new RegisteredMemoryFile(uriOf(path), text)); };
  for (const [path, text] of Object.entries(files)) register(path, restored[path] ?? text);
  // A file made on an earlier visit, by a terminal command, comes back with the rest of the draft.
  for (const [path, text] of Object.entries(restored)) if (!(path in files)) register(path, text);
  registerFileSystemOverlay(1, provider);
  // LexLean's colours reach the editor as semantic tokens, so they are on whatever the theme would choose.
  // ?theme=<a theme's name> opens the page in that theme; without it, the workbench's own choice stands.
  const theme = new URLSearchParams(location.search).get('theme');
  await initUserConfiguration(JSON.stringify({ 'editor.semanticHighlighting.enabled': true, ...(theme ? { 'workbench.colorTheme': theme } : {}) }));

  await initialize({
    ...getExtensionsOverride({ enableWorkerExtensionHost: true }), ...getFilesOverride(), ...getConfigurationOverride(),
    ...getWorkbenchOverride(), ...getModelOverride(), ...getLanguagesOverride(), ...getThemeOverride(), ...getMarkersOverride(),
    ...getStorageOverride(), ...getLifecycleOverride(), ...getNotificationsOverride(), ...getDialogsOverride(),
    ...prismTerminal(commandLine, terminals),
    // The Explorer, so every file of the model can be opened; the keyboard shortcuts and the command palette.
    ...getExplorerOverride(), ...getKeybindingsOverride(), ...getQuickAccessOverride(),
  }, document.getElementById('workbench'), {
    // The model is the one folder of the workspace. It lives in this tab's memory: nothing is written anywhere.
    workspaceProvider: { trusted: true, workspace: { folderUri: URI.file('/workspace') }, open: async () => false },
  });

  // LexLean's name, brackets and colours, before the file is opened, so the editor takes it for LexLean.
  registerLexLean(monaco);
  const resource = uriOf(entry);
  await (await getService(IEditorService)).openEditor({ resource, options: { pinned: true } });
  const markers = await getService(IMarkerService);
  const model = monaco.editor.getModels().find((m) => m.uri.toString() === resource.toString());
  if (!model) throw new Error('the workbench opened no model for ' + listing.entry);
  // The file ending should be enough; if the workbench chose otherwise, say which language this is.
  if (model.getLanguageId() !== LEXLEAN) monaco.editor.setModelLanguage(model, LEXLEAN);
  state.model = { lines: model.getLineCount(), language: model.getLanguageId() };
  // The terminal panel, open from the start. A test reaches its command lines through window.prismModel.terminals.
  window.prismModel.terminals = terminals;
  // The workbench's emulator for the terminal in front, so a test can read what was drawn and when.
  const terminalService = await getService(ITerminalService);
  window.prismModel.xterm = () => terminalService.activeInstance?.xterm?.raw ?? null;
  (await getService(ICommandService)).executeCommand('workbench.action.terminal.focus').catch((error) => { state.terminalError = String(error?.message ?? error); });
  const themes = await getService(IWorkbenchThemeService);
  // The editor gives each token a class, mtk<n>, where n indexes the theme's table of colours. In VS Code the
  // stylesheet that gives those classes their colours is written by the TextMate service, which this page does not
  // load, so it is written here from the same table. The table grows as the theme meets new kinds of token, so it is
  // written again after the theme changes and a moment after the editor asks for colours.
  const tokenStyle = document.head.appendChild(document.createElement('style'));
  const paint = () => {
    const table = themes.getColorTheme().tokenColorMap ?? [];
    tokenStyle.textContent = table.map((colour, n) => (colour ? '.mtk' + n + ' { color: ' + colour + '; }' : '')).join(' ');
    state.colours = table.filter(Boolean).length;
  };
  themes.onDidColorThemeChange(paint);
  paint();
  setInterval(paint, 1000);
  window.prismModel.themes = async () => (await themes.getColorThemes()).map((t) => t.settingsId ?? t.label);
  window.prismModel.colouring = () => { const t = themes.getColorTheme(); return { theme: t.label ?? t.id, rules: t.tokenColors?.length ?? null, semantic: t.semanticHighlighting ?? null, asked: registerLexLean.calls }; };
  window.prismModel.tokenize = (text) => tokenTypes(monaco, text);
  window.prismModel.setText = (text) => model.setValue(text); // for a test to type with
  window.prismModel.text = () => model.getValue();

  // The model as it stands in the editor: each file as fetched, or as the reader has changed it. A file that was
  // opened and changed keeps its change after its editor is closed, for as long as the tab is open.
  const current = { ...restored };
  // What the terminal's commands read: every file as the reader has it now.
  // Files a terminal command removed, until the page is loaded again.
  const removed = new Set();
  const whole = () => { const all = { ...files, ...current, [entry]: model.getValue() }; for (const path of removed) delete all[path]; return all; };
  projectNow = whole;
  sayDraft(Object.keys(current).filter((path) => current[path] !== files[path]).sort());
  // The model as it stands in the editor, as one archive. The same model gives the same bytes, so the label names it.
  window.prismModel.archive = () => { const all = { ...files, ...current }; for (const path of removed) delete all[path]; return modelTar(all); };
  const took = document.getElementById('took');
  document.getElementById('download').addEventListener('click', () => {
    try {
      const { bytes, label } = window.prismModel.archive();
      const name = `model-${label.slice('blake3:'.length, 'blake3:'.length + 12)}.tar`;
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes], { type: 'application/x-tar' })), download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      const changed = Object.keys(current).filter((path) => current[path] !== files[path]).length;
      state.took = { name, label, bytes: bytes.length, changed };
      took.textContent = `Downloaded ${name}: the model ${changed ? `with your ${changed} changed file${changed === 1 ? '' : 's'}` : 'as fetched'}, ${bytes.length} bytes. Its address is ${label}. It unpacks into a folder named model.`;
    } catch (error) {
      state.took = { error: String(error?.message ?? error) };
      took.textContent = 'The model could not be put in an archive: ' + state.took.error;
    }
    took.hidden = false;
  });
  let saving = null;
  const keep = () => {
    clearTimeout(saving);
    saving = setTimeout(async () => {
      const changed = Object.fromEntries(Object.entries(current).filter(([path, text]) => text !== files[path]));
      await drafts.save(base, changed);
      sayDraft(Object.keys(changed).sort());
    }, 400);
  };
  const pathOf = (uri) => (uri.scheme === 'file' && uri.path.startsWith('/workspace/') ? uri.path.slice('/workspace'.length) : null);
  const rooted = (path) => '/' + path.replace(/^\//, '');
  window.prismModel.changed = () => Object.keys(current).filter((path) => current[path] !== files[path]);
  window.prismModel.open = async (path) => { await (await getService(IEditorService)).openEditor({ resource: uriOf(rooted(path)), options: { pinned: true } }); };
  window.prismModel.setFile = (path, text) => { const m = monaco.editor.getModel(uriOf(rooted(path))); if (!m) throw new Error(path + ' is not open'); m.setValue(text); };
  window.prismModel.fileText = (path) => current[rooted(path)] ?? files[rooted(path)];
  window.prismModel.marks = () => markers.read({}).map((m) => ({ file: pathOf(m.resource), line: m.startLineNumber, code: m.code, owner: m.owner }));

  let latest = 0;
  async function run() {
    const mine = ++latest;
    const project = whole();
    const text = project[entry];
    const edited = Object.keys(project).some((path) => project[path] !== files[path]);
    say('Checking…');
    const reply = await lexlean.ask({ files: project });
    if (mine !== latest) return;
    state.checks++;
    if (reply.error) { state.last = { error: reply.error }; say('LexLean did not answer: ' + reply.error, 'bad'); state.ready = true; return; }
    const result = reply.result;
    // Each diagnostic is marked in the file it is about; a file with none has its marks cleared.
    const fileOf = (d) => rooted(d.primary?.path ?? '');
    const placed = result.diagnostics.filter((d) => d.primary && fileOf(d) in project);
    for (const path of Object.keys(project)) {
      markers.changeOne('lexlean', uriOf(path), placed.filter((d) => fileOf(d) === path).map((d) => ({
        severity: ERROR, source: 'LexLean', code: d.code, message: d.message,
        startLineNumber: Math.max(1, d.primary.line_start), startColumn: Math.max(1, d.primary.column_start), endLineNumber: Math.max(1, d.primary.line_end), endColumn: Math.max(d.primary.column_end, d.primary.column_start + 1),
      })));
    }
    state.last = { success: result.success, ms: reply.ms, semanticId: result.semantic_id ?? null, diagnostics: result.diagnostics.map((d) => ({ code: d.code, line: d.primary?.line_start, message: d.message })) };
    if (!result.success) {
      // A model that does not check has no meaning to prove anything about.
      markers.changeOne('prism-guarantees', resource, []);
      state.proof = null;
      matchLine.hidden = true;
      // A problem with no place in a file of the model is named in the strip, since no editor can show it.
      const elsewhere = result.diagnostics.find((d) => !placed.includes(d));
      say(`${result.diagnostics.length} problem${result.diagnostics.length === 1 ? '' : 's'} from LexLean, in ${reply.ms} ms, listed under Problems. Guarantees are not judged until the model checks.`
        + (elsewhere ? ` Not in a file of the model: ${elsewhere.code}: ${elsewhere.message}` : ''), 'bad');
      state.markers = markers.read({}).length;
      state.ready = true;
      return;
    }
    say(`The model checks, in ${reply.ms} ms. Judging its guarantees…`);
    const taken = await lexlean.ask({ files: project, snapshot: true });
    if (mine !== latest) return;
    let table;
    try { table = ruleTable(JSON.parse(taken.snapshot)); } catch (e) {
      markers.changeOne('prism-guarantees', resource, []);
      state.proof = { table: false };
      compare(null, edited);
      say(`The model checks, in ${reply.ms} ms. It is not a rule table, so its guarantees are not proved in this tab.`, 'ok');
      state.markers = markers.read({ resource }).length;
      state.ready = true;
      return;
    }
    const value = (f, v) => (f.values ? f.values[v] : v);
    const said = (g) => 'When ' + g.when.map(([f, op, v]) => table.fields[f].name + ' ' + OPS[op] + ' ' + value(table.fields[f], v)).join(' and ') + ', the answer is ' + (g.always ? 'always ' : 'never ') + table.answers[g.outcome];
    const found = table.guarantees.map((g) => counterexample(table, g));
    compare(table, edited);
    const shaped = tableWords(table);
    const judged = await kernel.ask({ words: shaped.words, guarantees: shaped.guarantees });
    if (mine !== latest) return;
    // Where the model states its guarantees: the place a broken one is reported.
    const at = text.split('\n').findIndex((line) => /^\s*name:\s*guarantees\s*,/.test(line)) + 1 || 1;
    const statuses = table.guarantees.map((g, i) => (judged.results?.[i]?.proved ? 'proved' : found[i].request !== null ? 'broken' : judged.error ? 'not proved here' : 'refused'));
    markers.changeOne('prism-guarantees', resource, table.guarantees.flatMap((g, i) => (statuses[i] === 'proved' ? [] : [{
      severity: ERROR, source: 'Prism', code: statuses[i],
      message: statuses[i] === 'broken' ? `Guarantee broken: ${said(g)}. The request "${found[i].request}" answers ${found[i].answer}.`
        : statuses[i] === 'refused' ? `Guarantee not accepted by Lean's kernel, though no request in the bounds breaks it: ${said(g)}.`
          : `Guarantee not proved here (Lean's kernel could not run: ${judged.error}): ${said(g)}.`,
      startLineNumber: at, startColumn: 1, endLineNumber: at, endColumn: 1000,
    }])));
    const proved = statuses.filter((s) => s === 'proved').length;
    state.proof = { table: true, proved, total: statuses.length, ms: judged.ms ?? null, statuses, breaking: found.map((f) => f.request), line: at };
    say(`${proved} of ${statuses.length} guarantees proved by Lean's kernel in this tab` + (judged.ms ? `, in ${judged.ms} ms` : '') + (proved === statuses.length ? '.' : `; ${statuses.length - proved} not, listed under Problems.`), proved === statuses.length ? 'ok' : 'bad');
    state.markers = markers.read({ resource }).length;
    state.ready = true;
  }

  // Any file of the model that is open is watched: a change to any of them is a change to the model.
  let timer = null;
  const watch = (m) => {
    const path = pathOf(m.uri);
    if (path === null) return;
    if (m.getLanguageId() !== LEXLEAN && path.endsWith('.lex.tex')) monaco.editor.setModelLanguage(m, LEXLEAN);
    m.onDidChangeContent(() => { current[path] = m.getValue(); keep(); clearTimeout(timer); timer = setTimeout(run, PAUSE_MS); });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
  // The terminal's six commands that change a file. An open file changes in its editor, so the change can be
  // undone there; a file that is not open changes where the workbench reads it from. Either way it is kept with
  // the draft and the model is checked again. A removed file is back when the page is loaded again.
  const changedByTerminal = () => { keep(); clearTimeout(timer); timer = setTimeout(run, PAUSE_MS); };
  changeNow = {
    write(path, text) {
      removed.delete(path);
      const open = monaco.editor.getModel(uriOf(path));
      if (open && path in registered) { if (open.getValue() !== text) open.setValue(text); current[path] = text; } else { register(path, text); current[path] = text; }
      changedByTerminal();
    },
    remove(path) {
      if (path === entry) throw new Error(listing.entry + " is the model's entry; it stays");
      registered[path]?.dispose();
      delete registered[path];
      delete current[path];
      removed.add(path);
      changedByTerminal();
    },
  };
  await run();
} catch (e) {
  state.error = String(e?.stack ?? e);
  say('The editor could not start: ' + (e?.message ?? e), 'bad');
  state.ready = true;
}
