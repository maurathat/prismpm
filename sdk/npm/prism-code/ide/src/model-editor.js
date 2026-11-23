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

// How long after a keystroke LexLean is asked. A check takes tens of milliseconds, so the pause is one frame or
// two, enough to take a burst of keys as one edit; and only one check is ever waiting, the newest, so typing faster
// than LexLean answers never builds a queue behind what is on screen.
const PAUSE_MS = 40;
const ERROR = 8; // MarkerSeverity.Error
const strip = document.getElementById('strip');
const state = (window.prismModel = { ready: false, checks: 0, last: null, proof: null, error: null, markers: 0 });
const say = (text, kind) => { strip.textContent = text; strip.dataset.state = kind ?? ''; };
// What stands of the model's guarantees after the last edit, one row each, whichever kind of model it is: a
// theorem by its name, a rule table's guarantee by its place. Null until Lean's kernel has answered in this tab.
window.prismModel.guarantees = () => {
  const proof = state.proof;
  if (!proof || proof.error) return null;
  if (proof.table) return (proof.statuses ?? []).map((status, index) => ({ name: `guarantee ${index + 1}`, status }));
  return (proof.theorems ?? []).map((theorem) => ({ name: theorem.theorem, status: theorem.status }));
};

// Inside an app's holospace. Holospace's page loads this IDE by its one label into a frame of its own page, on the
// same origin, and hands it that app's things and nothing else, on the page that holds the frame:
//
//   holospaceHost = { space: { id, address, workspace, storage, grants }, app: { address, name, holo },
//                     files: { workbench }, run: { open, runner }, view: { viewFiles, viewDocument, serveIntents },
//                     replace, store: { writable, onWritable, persisted, persist } }
//
// Under a host this page registers no service worker (the host's serves its files by label), loads no copy of
// Holospace's library, takes the model from the app's holospace, and asks the host to replace the running app after
// a build. The IDE is inside the trust of that origin: the host's gate decides for apps and extensions, not for
// this page's own code. Read once; a page with no host is the published site, unchanged.
const HOST = (() => {
  try { return window.holospaceHost ?? (window.parent !== window ? window.parent.holospaceHost : null) ?? null; } catch { return null; }
})();
state.host = HOST !== null;

// Offline, by content: the site's service worker, where the site was assembled with one (tools/build-offline-site.mjs).
// It serves each published file only as the bytes its BLAKE3 label names, from this browser once it has them. This
// page loaded before the worker could take over, so it tells the worker what it loaded.
if (!HOST && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../../sw.js', location.href)).then(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data && 'warmed' in data) state.offline = data; });
    setTimeout(() => worker?.postMessage({ warm: [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)] }), 4000);
  }).catch(() => { /* no worker here: the page works as before, from the network */ });
}

// The edit page's files, served beside this page. Plain URLs, so the bundler leaves the workers as they are.
// This page lives in the edit page's folder, at ide/, wherever that folder is published.
const EDIT = new URL('../', location.href).href;
// A fresh copy when the network gives one; when that request fails, as it does in a browser switched to work offline,
// the same address asked plainly, which the site's worker answers from what it keeps.
const fresh = (url) => fetch(url, { cache: 'no-store' }).catch(() => fetch(url));
const json = async (url) => (await fresh(url)).json();
// ?project=<address of a folder> opens the model published there: its project.json lists its files, which are
// fetched from that folder. Without it, the model that came with the page is opened.
// Under a host the model is the app's own: the folder model/ beside the holo the host opened. A holo does not carry
// its sources yet, so they are read from where the app publishes them, which the host hands over as `app.from`: the
// address its link named, and nothing more. Nothing is trusted for coming from there; what is read is compared with
// the holo's own label (holo-match.mjs). What was edited before is in the app's holospace.
const hostedModel = () => {
  try { return typeof HOST.app.from === 'string' ? new URL('model/', HOST.app.from).href : null; } catch { return null; }
};
const asked = HOST ? hostedModel() : new URLSearchParams(location.search).get('project');
const PROJECT = asked ? new URL(asked.replace(/\/?$/, '/'), location.href).href : null;
const files = {};
let listing, pin;
// Which file of a model is opened first is part of its listing, which the app publishes. Under a host it is kept in
// the app's own storage beside the model, so the model can be opened again with its site out of reach.
const LISTING_KEPT = '/prism-ide/project.json';
async function rememberListing(of) {
  try { await HOST.space.storage.writeFile(LISTING_KEPT, new TextEncoder().encode(JSON.stringify({ entry: of.entry, files: of.files }))); } catch { /* storage that refuses keeps nothing; the next visit asks the app's site again */ }
}
/** The model as the app's holospace holds it, `{ listing, files }`, or null when it holds none or its listing is not kept. */
async function heldModel() {
  try {
    const workspace = HOST.space.workspace;
    const there = (await walkProvider(workspace)).filter((entry) => !entry.dir).map((entry) => entry.path);
    if (there.length === 0) return null;
    const kept = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await HOST.space.storage.readFile(LISTING_KEPT)));
    if (typeof kept?.entry !== 'string' || !there.includes(kept.entry)) return null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const held = {};
    for (const path of there) held['/' + path] = decoder.decode(await workspace.readFile('/' + path));
    return { listing: { entry: kept.entry, files: there.slice().sort() }, files: held };
  } catch { return null; }
}
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
  pin = await json(EDIT + 'pin.json');
  // Under a host the model is opened from the app's holospace when it is already there, with nothing fetched: the
  // app's own site is asked only on the first visit, when the holospace is empty. So a second visit needs no network.
  const held = HOST ? await heldModel() : null;
  if (held) {
    listing = held.listing;
    Object.assign(files, held.files);
    state.source = { kind: 'holospace', files: listing.files.length };
  } else {
    listing = await json(PROJECT ? PROJECT + 'project.json' : EDIT + 'project.json');
    await Promise.all(listing.files.map(async (path) => {
      const response = await fresh((PROJECT ?? EDIT + 'project/') + path);
      if (!response.ok) throw new Error(path + ' answered ' + response.status);
      files['/' + path] = await response.text();
    }));
    if (HOST) await rememberListing(listing);
  }
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
    state.app = { found: true, kind: 'holo', state: said.state, holo: holoBeside.holo, ...APP_FACTS };
    matchLine.textContent = said.text;
    matchLine.dataset.state = said.state;
    matchLine.hidden = false;
    return;
  }
  const differs = beside && table ? differences(tableFacts(table, { tableWords, tableShape }), beside.record) : [];
  const said = !beside ? verdict(null, [], false) : !table ? { state: 'unread', text: `This model is not read as a rule table here, so it is not compared with the app at ${beside.app}.` } : verdict(beside, differs, edited);
  state.app = { found: !!beside, state: said.state, differs, ...(APP_FACTS ?? {}) };
  matchLine.textContent = said.text;
  matchLine.dataset.state = said.state;
  matchLine.hidden = false;
}

// Holospace's library, published beside this page and held to its labels when the site was built. It is opened
// once, by whichever needs it first: a workspace kept in its store, or the run panel.
let holospace = null;
/** Every file and folder under a provider's root, as Holospace's own \`walk\` gives them: \`{ path, dir }\`. */
async function walkProvider(provider, { limit = 5000 } = {}) {
  const out = [];
  const visit = async (folder) => {
    for (const entry of await provider.readDirectory(folder === '' ? '/' : '/' + folder)) {
      if (out.length >= limit) return;
      const at = folder === '' ? entry.name : `${folder}/${entry.name}`;
      out.push({ path: at, dir: entry.dir === true });
      if (entry.dir) await visit(at);
    }
  };
  await visit('');
  return out;
}
const holospaceModule = HOST
  ? async () => ({ ...HOST.view, walk: (provider, options) => walkProvider(provider, options) })
  : () => import(/* @vite-ignore */ EDIT + 'holospace/holospace.bundle.mjs');
// Under a host there is one app and its things; nothing else of the library is reachable from here.
const library = HOST
  ? async () => ({ open: (bytes) => HOST.run.open(bytes), run: (opened) => HOST.run.runner(opened), workbench: (provider, options) => HOST.files.workbench(provider, options), app: async () => HOST.space, store: HOST.store })
  : () => (holospace ??= holospaceModule().then((m) => m.openHolospace()));

// ?workspace=<name> keeps the model's files in a workspace of Holospace's store, in this browser, and mounts them in
// the workbench through Holospace's own file provider. The first visit puts the model there as fetched, in one
// step; later visits open what was saved. Without it the files are held in memory and changes are kept as a draft.
const WORKSPACE = (() => { const name = new URLSearchParams(location.search).get('workspace'); return name !== null && /^[a-z0-9][a-z0-9._-]{0,62}$/.test(name) ? name : null; })();
// An app opened from its own link (?project=<app>/model/) has a holospace of its own, named by Holospace from the
// BLAKE3 label of the holo the app publishes: the same on every visit and for every rebuild of that app, and apart
// from every other app's. The label is the one the app's record names, taken only because the published holo's
// bytes derive to it (holo-match.mjs). A library that gives an app no holospace leaves the page as it was.
const APP_ADDRESS = HOST ? HOST.space.address : !WORKSPACE && holoBeside?.holo === 'same' ? holoBeside.record.holo : null;
// What the page read of the app, kept with what is later said of the model against it (state.app).
const APP_FACTS = HOST ? { address: HOST.space.address, from: asked, id: HOST.space.id ?? null, space: null, hosted: true }
  : holoBeside ? { address: holoBeside.holo === 'same' ? holoBeside.record.holo : null, from: holoBeside.app, id: null, space: null }
  : beside ? { address: null, from: PROJECT ? new URL('../', PROJECT).href : null, id: null, space: null } : null;
let stored = null;
let storedBench = null;
let space = null;
// The store, for what it says of this tab: whether it may write, and when that changes.
let store = null;
const PLACE = () => (space ? "This app's own holospace" : `Workspace "${WORKSPACE}"`);
const READ_ONLY = 'This workspace is open for editing in another tab; this one is read-only until that tab closes. ';
// Measured in Chromium with the library at ea96397: when the writing tab closes, this tab is told it may write, but
// a save from the workbench already open here still does not reach the store. After a reload it does. So the page
// asks for the reload instead of saying it can save. A later library (holospace-shell 0e2d04e) tells the workbench
// to look at its open files again when the lock passes, and with it a save does reach the store, measured the same
// way; such a provider has `announceReadonly`, and then no reload is asked for.
const passesLock = () => typeof storedBench?.announceReadonly === 'function';
const RELOAD ='The tab that was editing this workspace has closed. Reload this tab to edit it here. ';
// Files of the model that a saved workspace no longer has: they were removed there on an earlier visit.
const goneFromWorkspace = [];
// The reader's changes from an earlier visit, kept in this browser under BLAKE3 labels for exactly this model.
const { baseLabel, openDrafts } = await import(/* @vite-ignore */ EDIT + 'drafts.mjs');
const drafts = await openDrafts();
const base = baseLabel(listing.entry, files);
let kept = { restored: {}, dropped: [] };
let restored = {};
if (WORKSPACE || APP_ADDRESS) {
  try {
    const [h, { walk }] = await Promise.all([library(), holospaceModule()]);
    if (!WORKSPACE && typeof h.app !== 'function') throw Object.assign(new Error('the library this site pins gives an app no holospace of its own yet'), { quiet: true });
    if (!WORKSPACE) { space = await h.app({ address: APP_ADDRESS }); APP_FACTS.id = space.id ?? null; }
    stored = space ? space.workspace : h.workspace(WORKSPACE);
    store = h.store ?? null;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const there = (await walk(stored, { path: '/', limit: 5000 })).filter((e) => !e.dir);
    if (there.length === 0) {
      await stored.writeFiles(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.slice(1), encoder.encode(text)])));
    } else {
      const names = new Set(there.map((e) => '/' + e.path));
      for (const path of names) { const text = decoder.decode(await stored.readFile(path)); if (text !== files[path]) restored[path] = text; }
      for (const path of Object.keys(files)) if (!names.has(path)) goneFromWorkspace.push(path);
    }
    storedBench = h.workbench(stored);
    // Only one tab writes a store. Another is told so, reads what the first saves, and takes over when it closes.
    state.workspace = { name: WORKSPACE, app: space ? APP_ADDRESS : null, made: there.length === 0, label: await stored.label(), changed: Object.keys(restored).sort(), gone: [...goneFromWorkspace], writable: store?.writable ?? 'unknown' };
  } catch (error) {
    // A browser that gives no store, or a library that did not open: the page says so and goes on in memory.
    if (error?.quiet) APP_FACTS.space = error.message; else state.workspace = { name: WORKSPACE, app: APP_ADDRESS, error: String(error?.message ?? error) };
    stored = null;
    storedBench = null;
    space = null;
    store = null;
    restored = {};
  }
}
if (!stored) {
  kept = await drafts.load(base);
  // A path the model no longer has is not restored: the draft is for this model, so there should be none.
  restored = Object.fromEntries(Object.entries(kept.restored).filter(([path]) => path in files));
}
const draftLine = document.getElementById('draft');
const draftText = document.getElementById('draftText');
state.draft = { base, off: drafts.off, restored: Object.keys(restored), dropped: kept.dropped, kept: Object.keys(restored) };
// When the tab that was writing closes, the line says so.
store?.onWritable?.((writable) => { if (state.workspace) { state.workspace.writable = writable && state.workspace.writable === false && !passesLock() ? 'after a reload' : writable; sayDraft(state.draft?.kept ?? []); } });
function sayDraft(paths) {
  if (stored) {
    // In a workspace the files are saved by the workbench into the store; there is no draft apart from them.
    state.draft.kept = paths;
    draftLine.hidden = false;
    draftText.textContent = (state.workspace?.writable === false ? READ_ONLY : state.workspace?.writable === 'after a reload' ? RELOAD : '') + `${PLACE()}, kept in this browser's store. ` + (paths.length === 0 ? 'Its files are the model as fetched.' : `Changed from the model as fetched: ${paths.map((path) => path.replace(/^\//, '')).join(', ')}.`);
    document.getElementById('draftDiscard').hidden = true;
    return;
  }
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
// The kernel for a model's own theorems, started only when a model that is not a rule table is met: its base
// library is 20 MB, and a page that opens rule tables never fetches it.
let theoremProver = null;
// What a running build says as each of its steps begins.
let onBuildStage = null;
let liveNow = null;
let liveJudge = null;
let liveShow = null;
const theorems = () => {
  if (!theoremProver) {
    theoremProver = channel(EDIT + 'model-prove-worker.mjs', (note) => { if (note.stage) { state.building = note.stage; onBuildStage?.(note.stage); } else state.modelKernel = note; });
    theoremProver.post({ start: { lexlean: { url: EDIT + 'lexlean.wasm.gz', pin: { kappa: pin.kappa, encoding: pin.encoding } }, kernel: EDIT + 'model-kernel/pins.json' } });
  }
  return theoremProver;
};

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
    pin, manifest, kept: createKeptIn(await openStore({ kappa })), change: { write: changing('write'), remove: changing('remove') },
    // A paste of several lines is one block; the effects table says to ask before it is entered.
    askLines: async (lines) => window.confirm(`Run these ${lines.length} pasted lines?\n\n` + lines.join('\n').slice(0, 600)),
    ...io,
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
  if (storedBench) {
    // The workspace's files, through Holospace's provider: the workbench reads and saves there.
    registerFileSystemOverlay(1, storedBench);
  } else {
    for (const [path, text] of Object.entries(files)) register(path, restored[path] ?? text);
    // A file made on an earlier visit, by a terminal command, comes back with the rest of the draft.
    for (const [path, text] of Object.entries(restored)) if (!(path in files)) register(path, text);
    registerFileSystemOverlay(1, provider);
  }
  // LexLean's colours reach the editor as semantic tokens, so they are on whatever the theme would choose.
  // ?theme=<a theme's name> opens the page in that theme; without it, the workbench's own choice stands.
  // Dark+ unless the address names another theme: ?theme=<a theme's name, as the command palette lists it>.
  const theme = new URLSearchParams(location.search).get('theme') || 'Default Dark+';
  // No minimap: it is one more thing drawn on every keystroke, and the files here are short.
  await initUserConfiguration(JSON.stringify({ 'editor.semanticHighlighting.enabled': true, 'workbench.colorTheme': theme, 'editor.minimap.enabled': false }));

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
  const removed = new Set(goneFromWorkspace);
  const whole = () => { const all = { ...files, ...current, [entry]: model.getValue() }; for (const path of removed) delete all[path]; return all; };
  projectNow = whole;
  sayDraft(Object.keys(current).filter((path) => current[path] !== files[path]).sort());
  // The model as it stands in the editor, as one archive. The same model gives the same bytes, so the label names it.
  window.prismModel.archive = () => { const all = { ...files, ...current }; for (const path of removed) delete all[path]; return modelTar(all); };
  const took = document.getElementById('took');
  // Run: the holo that was just built, opened and run by Holospace's library, published beside this page and held
  // to its labels when the site was built. The library judges the holo again (its seal, its members, its examples
  // replayed) before anything is run, and gives nothing to call unless its verdict is "verified". Each request is
  // one call on a fresh instance: an app that keeps state keeps it in the request, and this page holds the earlier
  // requests for it.
  const runBox = document.getElementById('run');
  const runVerdict = document.getElementById('runVerdict');
  const runForm = document.getElementById('runForm');
  const runInput = document.getElementById('runInput');
  const runKeep = document.getElementById('runKeep');
  const runLog = document.getElementById('runLog');
  let running = null;
  let runningLabel = null; // the BLAKE3 label of the holo that is running
  let lastSent = null; // the last request typed in the box, sent again to the next build when Live is on
  // The app's own page, when its holo carries one: the View's files made into one document by Holospace's library
  // and shown in a frame that may run scripts and nothing else (no network, no storage, no way out of the frame; the
  // document carries the library's own content policy). What the page asks of its app is sent as the page gave it,
  // and listed below with its answer, marked "page". A page keeps its own session: nothing is added to its requests.
  const runView = document.getElementById('runView');
  let stopIntents = null;
  async function showView(opened) {
    stopIntents?.();
    stopIntents = null;
    runView.hidden = true;
    runView.removeAttribute('srcdoc');
    if (!opened) return null;
    const { viewFiles, viewDocument, serveIntents } = await holospaceModule();
    const view = viewFiles(opened.view);
    if (!view) return { shown: false, why: 'the holo carries no View' };
    runView.srcdoc = viewDocument(view);
    stopIntents = serveIntents(runView, async (request) => { const answers = await ask(request, 'page '); return answers[answers.length - 1]; });
    runView.hidden = false;
    return { shown: true, entry: view.entry, files: Object.keys(view.files).length };
  }
  async function openRun(bytes) {
    running = null;
    runLog.textContent = '';
    runForm.hidden = true;
    state.run = null;
    await showView(null);
    if (!bytes) { runBox.hidden = true; return; }
    runBox.hidden = false;
    runBox.dataset.state = '';
    runVerdict.textContent = 'Opening the holo to run it…';
    try {
      const h = await library();
      const opened = await h.open(bytes.slice());
      const replayed = opened.replay ? `; ${opened.replay.passed} of ${opened.replay.total} of its examples replayed` : '';
      state.run = { verdict: opened.verdict, error: opened.error ?? null, kind: opened.kind ?? null, stateful: opened.stateful ?? null, replay: opened.replay ?? null, sent: [], answers: [] };
      if (opened.verdict !== 'verified') {
        runBox.dataset.state = 'refused';
        runVerdict.textContent = `Not run: the holo was judged "${opened.verdict}"` + (opened.error ? ` (${opened.error})` : '') + '. Nothing of it was started.';
        return;
      }
      running = { runner: h.run(opened), steps: [] };
      runBox.dataset.state = 'verified';
      runVerdict.textContent = `Ready to run ${opened.name ?? 'the app'}: its holo was judged verified in this tab${replayed}. Each request is one call on a fresh instance.`;
      runForm.hidden = false;
      // A View that cannot be shown does not stop the app being run by request.
      try { state.run.view = await showView(opened); } catch (error) { state.run.view = { shown: false, why: String(error?.message ?? error) }; }
      if (state.run.view?.shown) runVerdict.textContent += ' Its own page is shown below, in a frame that can reach nothing but the app.';
    } catch (error) {
      state.run = { verdict: null, error: String(error?.message ?? error) };
      runBox.dataset.state = 'refused';
      runVerdict.textContent = `Not run: the holo could not be opened here (${state.run.error}).`;
    }
  }
  // `send`, not `run`: this object is also the page's state, and `run` there is what the last run was.
  // One request to the app, as given, listed with its answer. `from` says who asked when it was not the box above.
  async function ask(request, from = '') {
    if (!running) throw new Error('nothing is ready to run: build first');
    let answers;
    try { answers = await running.runner.step(request); } catch (error) { answers = [`(the app did not answer: ${String(error?.message ?? error)})`]; }
    state.run.sent.push(request);
    state.run.answers.push(answers);
    runLog.textContent += `${from}> ${request}\n${answers.map((a) => '  ' + a).join('\n')}\n`;
    runLog.scrollTop = runLog.scrollHeight;
    return answers;
  }
  window.prismModel.send = async (text) => {
    if (!running) throw new Error('nothing is ready to run: build first');
    const answers = await ask(runKeep.checked ? [...running.steps, text].join(';') : text);
    if (runKeep.checked) running.steps.push(text);
    lastSent = text;
    return answers;
  };
  runForm.addEventListener('submit', (event) => { event.preventDefault(); const text = runInput.value; if (text === '') return; runInput.value = ''; window.prismModel.send(text); });
  document.getElementById('runClear').addEventListener('click', () => { lastSent = null; if (running) running.steps = []; runLog.textContent = ''; if (state.run) { state.run.sent = []; state.run.answers = []; } });
  // Push: the holo that was just built goes to a registry by the package's own push (prism-code/push-core.mjs,
  // the steps `prism-code push` runs, with oci-registry.mjs as the client). Nothing of it is this page's: the page
  // gives the bytes, the reference and, when the registry asks, what the reader typed, which is held for that one
  // push and kept nowhere. A holo that does not verify reaches no registry. Nothing is signed here.
  const pushForm = document.getElementById('pushForm');
  const pushSaid = document.getElementById('pushSaid');
  window.prismModel.push = async (target, { username = '', password = '' } = {}) => {
    const bytes = window.prismModel.holo?.();
    if (!bytes) throw new Error('nothing is built to push: build first');
    const [{ pushHolo }, { createRegistryClient }, { parseReference }] = await Promise.all(
      ['push-core.mjs', 'oci-registry.mjs', 'oci-reference.mjs'].map((name) => import(/* @vite-ignore */ EDIT + 'prism-code/' + name)));
    const reference = parseReference(target);
    if (reference.kind !== 'registry') throw new Error('a page pushes to a registry: name it as registry.example/name:tag');
    const asked = username !== '' || password !== '';
    const client = createRegistryClient(reference, { resolveCredentials: asked ? () => ({ username, password }) : undefined });
    const result = await pushHolo(bytes.slice(), client, { reference });
    // The label a second machine asks for: the holo's own BLAKE3 label, with where it now is.
    state.pushed = { label: 'blake3:' + result.blake3, where: result.reference, digest: result.digest, tags: result.tags, uploaded: result.layer.uploaded, referrers: result.referrers.length };
    return state.pushed;
  };
  // Pull: the holo a reference names is fetched with the package's registry client, which takes the manifest and
  // the layer only as the bytes their digests name. If a BLAKE3 label was asked for, the bytes must derive to it.
  // Then it is judged here as any holo is before it runs: by Holospace's library, in this tab (its seal, its
  // members, its examples replayed). Nothing is proved again by a pull, and no proof term is produced: a holo does
  // not carry a proof record yet, so what is said of its theorems is nothing.
  window.prismModel.pull = async (target, { label = null, username = '', password = '' } = {}) => {
    const [{ createRegistryClient }, { parseReference }, { holoLayerOf }, { kappa }] = await Promise.all(
      ['oci-registry.mjs', 'oci-reference.mjs', 'oci-manifest.mjs', 'blake3.mjs'].map((name) => import(/* @vite-ignore */ EDIT + 'prism-code/' + name)));
    const reference = parseReference(target);
    if (reference.kind !== 'registry') throw new Error('a page pulls from a registry: name it as registry.example/name:tag');
    const asked = username !== '' || password !== '';
    const client = createRegistryClient(reference, { resolveCredentials: asked ? () => ({ username, password }) : undefined });
    const manifest = await client.getManifest(reference.digest ?? reference.tag);
    const layer = holoLayerOf(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest.bytes)));
    if (!layer || typeof layer.digest !== 'string' || !Number.isSafeInteger(layer.size) || layer.size < 0) throw new Error('what is at that address is not a holo: its manifest does not have exactly one holo layer');
    if (layer.size > 64 * 1024 * 1024) throw new Error(`the holo there is ${layer.size} bytes, more than a page takes`);
    const bytes = await client.getBlob(layer.digest, layer.size);
    const got = kappa(bytes);
    if (label !== null && got !== label) throw new Error(`the holo there is ${got}, not the ${label} that was asked for`);
    window.prismModel.holo = () => bytes;
    await openRun(bytes);
    state.pulled = { label: got, from: target, digest: manifest.digest, bytes: bytes.length, judged: state.run?.verdict ?? null, reproved: null, termsProduced: 0 };
    return state.pulled;
  };
  document.getElementById('pullButton').addEventListener('click', async () => {
    const target = document.getElementById('pushTarget').value.trim();
    if (target === '') return;
    const secret = document.getElementById('pushSecret');
    pushSaid.textContent = 'Pulling…';
    try {
      const pulled = await window.prismModel.pull(target, { username: document.getElementById('pushUser').value, password: secret.value });
      pushSaid.textContent = `Pulled ${pulled.label}, ${pulled.bytes} bytes, and judged here: ${pulled.judged ?? 'not judged'}. Its theorems were not proved again; nothing says they hold but the build that made it.`;
      document.getElementById('pushButton').disabled = false;
    } catch (error) {
      state.pulled = { error: String(error?.code ?? ''), message: String(error?.message ?? error) };
      pushSaid.textContent = state.pulled.error === 'registry_auth_failed' ? 'Not pulled: the registry asks for a user name and a password or token.' : `Not pulled: ${state.pulled.message}`;
    } finally { secret.value = ''; }
  });
  pushForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = document.getElementById('pushTarget').value.trim();
    if (target === '') return;
    const secret = document.getElementById('pushSecret');
    pushSaid.textContent = 'Pushing…';
    try {
      const pushed = await window.prismModel.push(target, { username: document.getElementById('pushUser').value, password: secret.value });
      pushSaid.textContent = `Pushed ${pushed.label} to ${pushed.where}${pushed.uploaded ? '' : ' (the registry already held these bytes)'}. Not signed here.`;
    } catch (error) {
      state.pushed = { error: String(error?.code ?? ''), message: String(error?.message ?? error) };
      // The package's own words for this name a command a page does not have.
      pushSaid.textContent = state.pushed.error === 'registry_auth_failed' ? 'Not pushed: the registry asks for a user name and a password or token. Type them beside the address and push again.' : `Not pushed: ${state.pushed.message}`;
    } finally { secret.value = ''; }
  });
  // Build: the package's own build, in the worker that holds LexLean and Lean's kernel. The holo is offered only
  // when the build gives one: every theorem proved, the holo read back verified, every acceptance vector passing.
  const buildButton = document.getElementById('build');
  // Live: after each edit that checks and whose theorems are all proved, the model is built and the app that was
  // built is the one shown. Every such build is a whole build: checked, proved by Lean's kernel, read back verified,
  // its examples passing. So what is shown is always a proved app, and an edit that is not proved changes nothing that
  // is running. A build is named by the BLAKE3 label of the model it was made from and the app by the label of its
  // holo: the same model is not built twice, and the same holo is not opened twice.
  const liveBox = document.getElementById('live');
  try { const kept = localStorage.getItem('prism-ide-live'); if (kept !== null) liveBox.checked = kept === 'on'; } catch { /* no storage: the box as the page has it */ }
  state.live = { on: liveBox.checked, builds: 0, shown: 0, ms: null, building: false };
  let builtModel = null; // the label of the model the last build was made from
  let liveAgain = false;
  let editedAt = null; // when the first edit not yet shown was made
  async function liveBuild() {
    if (!liveBox.checked) return;
    if (state.live.building) { liveAgain = true; return; }
    let label;
    try { label = modelTar(whole()).label; } catch { return; }
    if (label === builtModel) { editedAt = null; return; }
    state.live.building = true;
    try { await liveDone(await buildAsk(whole())); } catch (error) { took.textContent = 'Not built: ' + String(error?.message ?? error); took.hidden = false; buildButton.disabled = false; }
    state.live.building = false;
    if (liveAgain) { liveAgain = false; liveBuild(); }
  }
  /** A live build's answer, shown: the app it made is the one that runs. */
  async function liveDone(reply) {
    const since = editedAt;
    editedAt = null;
    const built = await finishBuild(reply, { live: true });
    state.live.builds++;
    if (built?.holo) {
      state.live.shown++;
      // From the first edit this build holds to the app it made being the one that runs.
      if (since !== null) state.live.ms = Math.round(performance.now() - since);
    }
  }
  // Live, for a model with theorems of its own: the build judges the theorems, so it is asked for in place of the
  // judging alone, and one pass of Lean's kernel gives both the marks in the editor and the app. Null when a build
  // is already out, and the theorems are then judged as they are without Live.
  liveJudge = async (project) => {
    if (!liveBox.checked || state.live.building) return null;
    state.live.building = true;
    try { return await buildAsk(project); } catch { return null; } finally { state.live.building = false; }
  };
  liveShow = async (reply) => {
    try { await liveDone(reply); } catch (error) { took.textContent = 'Not built: ' + String(error?.message ?? error); took.hidden = false; }
    if (liveAgain) { liveAgain = false; liveBuild(); }
  };
  liveBox.addEventListener('change', () => {
    state.live.on = liveBox.checked;
    try { localStorage.setItem('prism-ide-live', liveBox.checked ? 'on' : 'off'); } catch { /* not remembered */ }
    if (liveBox.checked) liveNow?.();
  });
  window.prismModel.build = async ({ live = false } = {}) => finishBuild(await buildAsk(whole()), { live });
  /** The build of a model, asked of the worker. Its answer carries the label of the model it was made from. */
  async function buildAsk(project) {
    let model = null;
    try { model = modelTar(project).label; } catch { /* not a model that can be named: built, and not remembered */ }
    buildButton.disabled = true;
    const steps = { check: 'LexLean is checking the model', prove: 'Lean\'s kernel is judging its theorems', build: 'the holo is being made' };
    onBuildStage = (stage) => { took.textContent = `Building in this tab: ${steps[stage] ?? stage}…`; };
    took.textContent = 'Building in this tab' + (state.modelKernel?.ready ? '…' : '; the kernel is opened once, which takes some seconds…');
    took.hidden = false;
    const reply = await theorems().ask({ build: true, files: project });
    onBuildStage = null;
    buildButton.disabled = false;
    return { ...reply, model };
  }
  async function finishBuild(reply, { live = false } = {}) {
    builtModel = reply.model ?? null;
    const built = reply.built;
    if (!built) {
      state.built = { ok: false, error: reply.error ?? 'no answer' };
      took.textContent = `Not built: the build could not run in this tab (${state.built.error}).`;
      return state.built;
    }
    const theoremsProved = built.theorems ? built.theorems.filter((t) => t.status === 'proved').length : null;
    state.built = { ok: built.ok, stage: built.stage, proved: built.proved, theorems: built.theorems ? { proved: theoremsProved, total: built.theorems.length } : null, vectors: built.vectors ?? null, ms: reply.ms, message: built.message,
      diagnostics: (built.diagnostics ?? []).length, holo: built.holo ? { label: built.holo.label, name: built.holo.name, bytes: built.holo.bytes.length, semanticId: built.holo.semanticId } : null };
    // The bytes are kept for whoever runs or saves the holo next; a failed build keeps none.
    window.prismModel.holo = built.holo ? () => built.holo.bytes : null;
    document.getElementById('pushButton').disabled = !built.holo;
    pushSaid.textContent = '';
    if (!built.holo) {
      // Live: a build that gives no holo replaces nothing. The app that was running stays, and is said to be the
      // earlier one.
      if (live && running) { took.textContent = `Not built (stopped at ${built.stage}): ${built.message} The app shown is the last build that was proved.`; return state.built; }
      runningLabel = null;
      await openRun(null);
      took.textContent = `Not built (stopped at ${built.stage}): ${built.message}`;
      return state.built;
    }
    if (live && running && built.holo.label === runningLabel) {
      // The same holo, byte for byte, is already the one running: nothing is opened again.
    } else {
      const before = live && running ? { steps: [...running.steps], last: lastSent, keep: runKeep.checked } : null;
      await openRun(built.holo.bytes);
      runningLabel = running ? built.holo.label : null;
      // Live: the request last typed is asked of the new app, after the same earlier ones, so its answer is seen
      // to change with the model.
      if (before && before.last !== null && running) {
        running.steps = before.keep ? before.steps.slice(0, -1) : [];
        await window.prismModel.send(before.last).catch(() => {});
      }
    }
    const name = `${built.holo.name || 'app'}.holo`;
    took.textContent = '';
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([built.holo.bytes], { type: 'application/octet-stream' })), download: name, textContent: `Save ${name}` });
    link.id = 'saveHolo';
    took.append(`Built in this tab in ${reply.ms} ms, with nothing compiled: ${name}, ${built.holo.bytes.length} bytes, ${built.holo.label}. `
      + (built.theorems ? `Proved: Lean's kernel accepted all ${built.theorems.length} of its theorems. ` : '')
      + (built.vectors ? `Tested: ${built.vectors.passed} of ${built.vectors.total} examples give their recorded answer through it. ` : ''), link);
    // Under a host, the running app is the holospace's to replace. It judges the bytes itself and says what it
    // did, or why it did nothing; this page's own account of the build is not what decides.
    if (HOST) {
      let said;
      // The holospace may refuse, for a reason it names: a proof it cannot check, a build over its limits. It is
      // waited for a minute and no longer, so a holospace that does not answer shows as that and not as a hang.
      const answer = new Promise((resolve) => setTimeout(() => resolve({ replaced: false, reason: 'replace.unanswered' }), 60000));
      try { said = await Promise.race([HOST.replace(built.holo.bytes), answer]); } catch (error) { said = { replaced: false, reason: String(error?.code ?? error?.message ?? error) }; }
      state.replaced = { replaced: said?.replaced === true, kept: said?.kept ?? null, reason: said?.reason ?? null, address: said?.address ?? null, judged: said?.judged ?? null };
      const WHY = { 'replace.unanswered': 'its holospace did not answer within a minute', 'proof.unjudged': "its holospace cannot yet check the proof itself, and does not take this page's word for it", 'replace.unbuilt': 'its holospace judged the build and cannot replace a running app yet' };
      took.append(said?.replaced === true
        ? ` The running app was replaced${said.kept === 'restarted' ? `, and restarted: ${said.reason ?? 'no reason given'}` : ', and kept its state'}.`
        : ` The running app was not replaced: ${WHY[said?.reason] ?? said?.reason ?? 'no reason given'}.`);
    }
    return state.built;
  };
  buildButton.addEventListener('click', () => { window.prismModel.build().catch((error) => { buildButton.disabled = false; took.textContent = 'Not built: ' + String(error?.message ?? error); took.hidden = false; }); });
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
      // In a workspace the workbench has saved the change into the store; a draft would be a second copy.
      if (!stored) await drafts.save(base, changed);
      else {
        // The workbench saves, by its own command, so nothing is written behind it; this workbench does not save
        // on its own after a pause. Then the workspace has a new label.
        await (await getService(ICommandService)).executeCommand('workbench.action.files.saveAll').catch((error) => { state.workspace.error = String(error?.message ?? error); });
        state.workspace.label = await stored.label().catch(() => state.workspace.label);
        state.workspace.saves = (state.workspace.saves ?? 0) + 1;
      }
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
  // One check with LexLean at a time. An edit made while one is out is checked as soon as it comes back, and what
  // was typed in between is checked once, as it then stands.
  let checking = false;
  let checkAgain = false;
  let provedFor = 0; // the check after which every theorem or guarantee of the model stood proved
  async function run() {
    await judge();
    if (provedFor === latest && !checking) liveBuild();
  }
  liveNow = () => { if (provedFor === latest && !checking) liveBuild(); };
  async function judge() {
    if (checking) { checkAgain = true; return; }
    const mine = ++latest;
    const project = whole();
    const text = project[entry];
    const edited = Object.keys(project).some((path) => project[path] !== files[path]);
    say('Checking…');
    checking = true;
    const asked = performance.now();
    let reply;
    try { reply = await lexlean.ask({ files: project }); } finally { checking = false; }
    state.checkMs = Math.round(performance.now() - asked);
    if (checkAgain) { checkAgain = false; queueMicrotask(run); }
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
      // Not a rule table: its theorems are its own, and Lean's kernel judges them here, in a worker of their own.
      markers.changeOne('prism-guarantees', resource, []);
      state.proof = { table: false };
      compare(null, edited);
      say(`The model checks, in ${reply.ms} ms. Lean's kernel is judging its theorems in this tab` + (state.modelKernel?.ready ? '…' : '; the kernel is opened once, which takes some seconds…'));
      const liveReply = await liveJudge?.(project) ?? null;
      const judgedByBuild = Array.isArray(liveReply?.built?.theorems);
      const put = judgedByBuild ? { result: { theorems: liveReply.built.theorems, via: 'the build', message: liveReply.built.message }, ms: null } : await theorems().ask({ files: project });
      if (mine !== latest) return;
      const proving = put.result;
      if (!proving) {
        // The kernel could not be opened or did not answer: nothing is called proved, and the page says why.
        state.proof = { table: false, error: put.error ?? 'no answer' };
        say(`The model checks, in ${reply.ms} ms. Its theorems are not proved here: Lean's kernel could not judge them (${state.proof.error}).`, 'ok');
        state.markers = markers.read({}).length;
        state.ready = true;
        return;
      }
      // A theorem that is not proved is marked where the model states it, in whichever file that is.
      const stated = (name) => {
        for (const [path, body] of Object.entries(project)) {
          const line = path.endsWith('.lex.tex') ? body.split('\n').findIndex((l) => new RegExp('^\\s*name:\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,?\\s*$').test(l)) : -1;
          if (line >= 0) return { path, line: line + 1 };
        }
        return { path: entry, line: 1 };
      };
      const missed = proving.theorems.filter((t) => t.status !== 'proved').map((t) => ({ ...t, at: stated(t.theorem) }));
      for (const path of Object.keys(project)) {
        markers.changeOne('prism-guarantees', uriOf(path), missed.filter((t) => t.at.path === path).map((t) => ({
          severity: ERROR, source: 'Prism', code: t.status,
          message: t.status === 'not settled' ? `Theorem ${t.theorem} is not settled: Lean's kernel accepted no proof of it here. That says nothing about whether it is true. ${t.detail}`
            : `Theorem ${t.theorem} is not proved: ${t.detail.replace(/^not proved: /, '')}.`,
          startLineNumber: t.at.line, startColumn: 1, endLineNumber: t.at.line, endColumn: 1000,
        })));
      }
      const total = proving.theorems.length;
      const provedCount = total - missed.length;
      state.proof = { table: false, proved: provedCount, total, ms: put.ms ?? null, via: proving.via, theorems: proving.theorems.map((t) => ({ theorem: t.theorem, status: t.status, ms: t.ms })), message: proving.message };
      say(total === 0 ? `The model checks, in ${reply.ms} ms. ${proving.message ?? 'It states no theorem the kernel was given.'}`
        : `${provedCount} of ${total} theorems proved by Lean's kernel in this tab` + (put.ms ? `, in ${put.ms} ms` : '') + (missed.length === 0 ? '.' : `; ${missed.length} not, listed under Problems.`), total > 0 && missed.length === 0 ? 'ok' : total === 0 ? 'ok' : 'bad');
      state.markers = markers.read({}).length;
      state.ready = true;
      if (missed.length === 0) provedFor = mine;
      if (judgedByBuild) await liveShow(liveReply);
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
    if (proved === statuses.length) provedFor = mine;
  }

  // Any file of the model that is open is watched: a change to any of them is a change to the model.
  let timer = null;
  const watch = (m) => {
    const path = pathOf(m.uri);
    if (path === null) return;
    if (m.getLanguageId() !== LEXLEAN && path.endsWith('.lex.tex')) monaco.editor.setModelLanguage(m, LEXLEAN);
    m.onDidChangeContent(() => { current[path] = m.getValue(); editedAt ??= performance.now(); keep(); clearTimeout(timer); timer = setTimeout(run, PAUSE_MS); });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
  // The terminal's six commands that change a file. An open file changes in its editor, so the change can be
  // undone there; a file that is not open changes where the workbench reads it from. Either way it is kept with
  // the draft and the model is checked again. A removed file is back when the page is loaded again.
  const changedByTerminal = () => { editedAt ??= performance.now(); keep(); clearTimeout(timer); timer = setTimeout(run, PAUSE_MS); };
  changeNow = {
    write(path, text) {
      removed.delete(path);
      const open = monaco.editor.getModel(uriOf(path));
      if (open && (stored || path in registered)) { if (open.getValue() !== text) open.setValue(text); current[path] = text; }
      else if (stored) { current[path] = text; stored.writeFile(path, new TextEncoder().encode(text)).catch((error) => { state.workspace.error = String(error?.message ?? error); }); }
      else { register(path, text); current[path] = text; }
      changedByTerminal();
    },
    remove(path) {
      if (path === entry) throw new Error(listing.entry + " is the model's entry; it stays");
      registered[path]?.dispose();
      delete registered[path];
      if (stored) stored.delete(path).catch((error) => { state.workspace.error = String(error?.message ?? error); });
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
