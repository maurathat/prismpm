import { initialize, getService, IConfigurationService, IEditorService, IMarkerService, IExtensionService } from '@codingame/monaco-vscode-api/services';
import { ExtensionIdentifier } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import { registerExtension, ExtensionHostKind } from '@codingame/monaco-vscode-api/extensions';
import { registerAssets } from '@codingame/monaco-vscode-api/assets';
import getExtensionsOverride from '@codingame/monaco-vscode-extensions-service-override';
import getFilesOverride, { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override';
import { RPCProtocol } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/rpcProtocol';
import { CommandsRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import getConfigurationOverride, { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import { Registry } from '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform';
import { Extensions as ConfigurationExtensions } from '@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configurationRegistry';
import getWorkbenchOverride from '@codingame/monaco-vscode-workbench-service-override';
import getModelOverride from '@codingame/monaco-vscode-model-service-override';
import getLanguagesOverride from '@codingame/monaco-vscode-languages-service-override';
import getThemeOverride from '@codingame/monaco-vscode-theme-service-override';
import getMarkersOverride from '@codingame/monaco-vscode-markers-service-override';
import getStorageOverride from '@codingame/monaco-vscode-storage-service-override';
import getLifecycleOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getNotificationsOverride from '@codingame/monaco-vscode-notifications-service-override';
import getDialogsOverride from '@codingame/monaco-vscode-dialogs-service-override';
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import METHOD_TABLE from './method-table.json';
import METHOD_SIDS from './method-sids.json';
// The judge's two files, named by content: BLAKE3 kappa labels in kappa-registry's form (blake3:<64 hex>).
// Compiled into the page, so a swapped file under /gate/ is refused. Written by capability-gate/tools/kappa_labels.mjs.
import GATE_PINS from './gate-pins.json';
// Which editor command ids map to which word of the proved command table. Any other id is the word "other".
import COMMAND_WORDS from './command-words.json';
import { pathInside } from './scope.js';
import { gateFacts } from './gate-facts.js';
// The Holospace library whose kernel answers for a call: each file is taken only as the bytes this names.
import HOLOSPACE_PINS from '../tools/holospace-pins.json';
import { openIdentity, loadGrants, saveGrants, clearGrants, corruptGrants, RESOURCES, DEFAULT_GRANTS } from './identity.js';
import { kappa } from '../public/gate/prism-code/src/blake3.mjs';
const TABLE_SIDS = new Set(METHOD_SIDS);
import extHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';
import editorWorkerUrl from '@codingame/monaco-vscode-api/workers/editor.worker?worker&url';

const params = new URLSearchParams(location.search);
const useGate = params.get('gate') !== 'off';
const strictCsp = params.get('csp') === 'strict';
const out = document.getElementById('out');
const altOrigin = params.get('origin') === 'alt' ? 'http://localhost:4174' : null;
const realExt = params.get('ext');
const fullWorkbench = params.get('wb') === 'full';
const state = { commandIds: {}, filePaths: {}, fullWorkbench, activationErrors: [], realExt, editor: null, useGate, strictCsp, altOrigin, judge: null, judgeMs: [], customers: 0, hosts: [], activated: {}, wrappedNotInTable: [], byClass: {}, calls: {}, denied: [], probe: null, registered: false, error: null };
window.__spike = state;
const show = () => { out.textContent = JSON.stringify(state, null, 1); };

// The proved judge: the rule app built from capability-gate/prism/src/App.lex.tex.
// Loaded the way the built page loads it; anything that does not match its own names fails closed.
const enc = new TextEncoder();
const dec = new TextDecoder();
const hexWord = (n) => [0, 8, 16, 24].map((k) => ((n >>> k) & 255).toString(16).padStart(2, '0')).join('');
const readWord = (hex) => parseInt(hex.match(/../g).reverse().join(''), 16);
const sha256 = async (bytes) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function loadJudge(recordFile = 'app.rule-app.json') {
  const base = new URL('/gate/', location.origin).href;
  const started = performance.now();
  const recordBytes = new Uint8Array(await (await fetch(base + recordFile)).arrayBuffer());
  const holo = new Uint8Array(await (await fetch(base + 'kernel.holo')).arrayBuffer());
  // Content first: both files must be the bytes this page was built against, before either is read.
  const kappas = { record: kappa(recordBytes), holo: kappa(holo) };
  const kappaMatches = kappas.record === GATE_PINS.files[recordFile].kappa && kappas.holo === GATE_PINS.files['kernel.holo'].kappa;
  if (!kappaMatches) return { ask: async () => 'deny', facts: { kappas, kappaMatches }, admitted: false, loadMs: Math.round(performance.now() - started) };
  const record = JSON.parse(dec.decode(recordBytes));
  const { loadArchive } = await import(/* @vite-ignore */ base + 'prism-code/src/index.mjs');
  const kernel = await loadArchive(holo, { capabilities: null, capabilitySet: undefined, allowUnverified: false });
  const facts = {
    kappas, kappaMatches,
    holoNamed: record.kernel.holo,
    holoPinned: await sha256(holo),
    holoVerified: kernel.identities?.verified === true,
    vectorsFailed: (await kernel.acceptance()).failed.length,
    proofVerdict: record.proof?.verdict ?? null,
    statementMatches: record.proof != null && record.proof.statement === await sha256(enc.encode(JSON.stringify(['prism/kernel-statement/1', record.words, record.guarantees]))),
  };
  const admitted = facts.holoNamed === facts.holoPinned && facts.holoVerified && facts.vectorsFailed === 0 && facts.proofVerdict === 'proved' && facts.statementMatches;
  const prefix = 'rule ' + record.words.map(hexWord).join('');
  const ask = async (request) => {
    if (!admitted) return 'deny';
    const numbers = record.fields.map((f) => f.values.indexOf(request[f.name]));
    if (numbers.some((n) => n < 0)) return 'deny';
    const reply = dec.decode(await kernel.dispatch(enc.encode(prefix + numbers.map(hexWord).join(''))));
    const outcome = /^ok [0-9a-f]{24}$/.test(reply) ? record.outcomes[readWord(reply.slice(11, 19))] : undefined;
    return outcome ?? 'deny';
  };
  return { ask, facts, admitted, loadMs: Math.round(performance.now() - started) };
}
const yn = (b) => (b ? 'yes' : 'no');
// What the user has granted this worker. Everything else is refused or asked.
// Filled before any extension runs: from the Prism id's signed, sealed record for this extension, else the defaults.
// ?grant=network,exec grants more for a trial; ?undeclared=network leaves a resource out of what the extension
// declares, and ?trusted=no marks it untrusted: the planted requests a test asks with.
const ASKED = (name) => new Set((params.get(name) ?? '').split(',').filter(Boolean));
const GRANTS = { show: true, read: true, write: false, network: false, secrets: false, exec: false };
for (const resource of ASKED('grant')) if (resource in GRANTS) GRANTS[resource] = true;
const DENIED = {};
const DECLARED = new Set(['show', 'read', 'write', 'network', 'secrets', 'exec'].filter((resource) => !ASKED('undeclared').has(resource)));
const TRUSTED = params.get('trusted') !== 'no';
const useIdentity = fullWorkbench && params.get('id') !== 'off';
const grantsFor = realExt ?? 'spike.probe';
// One worker per extension under test: the editor's affinity setting puts it in a worker of its own, apart from the probe.
// The gate then knows which worker a call came from, so one extension cannot use another's storage or grants.
const separate = fullWorkbench && !!realExt && params.get('sep') !== 'off';
state.separate = separate;
const PROBE_GRANTS = { show: true, read: true, exec: ASKED('grant').has('exec') };
const KNOWN_IDS = ['spike.probe'];
let realId = null;
const HOSTS = new WeakMap();
// A worker is one RPC protocol. Which extensions live in it is learned from the worker's own activation notices;
// a page-side source for that would be stronger and is not wired yet.
function hostOf(protocol) {
  let h = HOSTS.get(protocol);
  if (!h) {
    h = { index: state.hosts.length, extensions: new Set() };
    HOSTS.set(protocol, h);
    state.hosts.push({ index: h.index, extensions: [], calls: 0, denied: 0 });
  }
  return h;
}
// Commands are their own table of several hundred ids; only the probe's report command is let through here.
const COMMANDS_ALLOWED = new Set(['spike.report']);
// The class of a command comes from the proved command table: a listed command is 'show', every other is 'exec'.
const WORD_OF_COMMAND = Object.fromEntries(Object.entries(COMMAND_WORDS).flatMap(([word, ids]) => ids.map((id) => [id, word])));
const COMMAND_CLASS = {}; // word -> class, filled from the command judge before any extension runs

// Decide one call from the extension worker. Returns 'pass' (not gated), 'refuse' (no judge needed), or a gate request.
// The class of every method comes from src/method-table.json; a method the table does not hold is refused.
function requestFor(sid, method, args, host) {
  let cls = METHOD_TABLE[`${sid}.${method}`];
  if (cls === undefined) return { refuse: 'unmapped' };
  if (cls === 'internal') return 'pass';
  if (cls === 'exec') {
    // one named command is let through; every other exec call goes to the judge like any resource
    if (sid === 'MainThreadCommands' && method === '$executeCommand') {
      state.commandIds[args[0]] = (state.commandIds[args[0]] ?? 0) + 1;
      if (COMMANDS_ALLOWED.has(args[0])) return 'pass';
      cls = COMMAND_CLASS[WORD_OF_COMMAND[args[0]] ?? 'other'];
      if (cls !== 'show' && cls !== 'exec') return { refuse: 'command table not admitted' };
    }
  }
  // Where the call points: outside, workspace or storage, by the scope rules. A call with no file target counts as
  // the workspace. The gate, not this code, decides what each place may do.
  let target = 'workspace';
  let uri = null;
  let other = false;
  // The stored grants belong to the extension under test. Any other worker gets the defaults.
  const own = !separate || (realId !== null && host.extensions.has(realId));
  const granted = (own ? GRANTS : PROBE_GRANTS)[cls] === true;
  const refused = own && DENIED[cls] === true;
  if (sid === 'MainThreadFileSystem') {
    let where = 'unreadable';
    try {
      uri = URI.revive(args[0]);
      // The editor gives every extension storage folders of its own.
      // With one shared worker this cannot tell one extension's folder from another's.
      // Some extensions reach the same folders through the file: scheme, so both schemes count.
      // Inside or outside a folder is decided by the scope rules (src/scope.js, after scope-kernel/src/Scope.lex.tex).
      const storage = ((uri.scheme === 'vscode-userdata' || uri.scheme === 'file') && (pathInside(uri.path, '/User/globalStorage') || pathInside(uri.path, '/User/workspaceStorage'))) || uri.scheme === 'vscode-log';
      target = storage ? 'storage' : (uri.scheme === 'file' && pathInside(uri.path, '/workspace')) ? 'workspace' : 'outside';
      where = target === 'outside' ? `outside: ${uri.scheme}:${uri.path}`.slice(0, 120) : target;
      if (storage && separate) {
        // Storage is the caller's own only if it is not another known extension's folder.
        const segments = uri.path.toLowerCase().split('/');
        const otherId = KNOWN_IDS.find((id) => segments.includes(id) && !host.extensions.has(id));
        other = otherId !== undefined;
        if (other) { target = 'outside'; where = 'outside: storage of ' + otherId; }
      }
    } catch { target = 'outside'; uri = { scheme: undefined, path: undefined }; }
    state.filePaths[`${cls} ${where}`] = (state.filePaths[`${cls} ${where}`] ?? 0) + 1;
  }
  // The same facts in the form Holospace's gate takes. The place the scope rules gave goes with them: an answer is
  // used only when the gate reads the path as the same place.
  const sent = gateFacts({ resource: cls, uri: uri === null ? null : { scheme: uri.scheme, path: uri.path }, other, declared: DECLARED, granted, denied: refused, trusted: TRUSTED });
  if (sent.place !== target) return { refuse: `the scope rules say ${target}, the facts sent say ${sent.place}` };
  return { place: target, facts: sent.facts };
}

// The gate: Holospace's kernel, through the library this page pins. Each of the library's files is fetched and taken
// only as the bytes its BLAKE3 label names; a file that is not, or a library that does not open, answers "deny" to
// everything. The answer is the kernel's word: allow, deny or ask. "ask" lets nothing through here, since this
// page puts no question to the user in the middle of a call; the stored grants are the user's answers.
async function loadGate() {
  const started = performance.now();
  const base = new URL('/holospace/', location.origin).href;
  const closed = (why, facts = {}) => ({ ask: async () => ({ answer: 'deny', place: null, line: null }), admitted: false, facts: { ...facts, why }, loadMs: Math.round(performance.now() - started) });
  const got = {};
  for (const pin of HOLOSPACE_PINS.files) {
    let bytes;
    try { const response = await fetch(base + pin.path); if (!response.ok) return closed(`${pin.path} answered ${response.status}`); bytes = new Uint8Array(await response.arrayBuffer()); } catch (error) { return closed(`${pin.path}: ${error?.message ?? error}`); }
    got[pin.path] = kappa(bytes);
    if (got[pin.path] !== pin.kappa || bytes.length !== pin.bytes) return closed(`${pin.path} is not the pinned bytes`, { kappas: got });
  }
  try {
    const library = await import(/* @vite-ignore */ base + HOLOSPACE_PINS.entry);
    const h = await library.openHolospace();
    if (typeof h.extensionGate !== 'function') return closed('the library has no extension gate', { kappas: got });
    return { ask: (facts) => h.extensionGate(facts), admitted: true, facts: { kappas: got, commit: HOLOSPACE_PINS.commit }, loadMs: Math.round(performance.now() - started) };
  } catch (error) {
    return closed(`the library did not open: ${error?.code ?? error?.message ?? error}`, { kappas: got });
  }
}
const judge = useGate ? loadGate() : null;
const commandJudge = useGate ? loadJudge('commands.rule-app.json').then(async (j) => {
  for (const word of ['other', ...Object.keys(COMMAND_WORDS)]) COMMAND_CLASS[word] = await j.ask({ command: word });
  state.commandJudge = { admitted: j.admitted, loadMs: j.loadMs, classes: { ...COMMAND_CLASS }, kappas: j.facts.kappas };
  return j;
}, (e) => { state.error = 'command judge: ' + e; }) : null;
if (judge) judge.then((j) => { state.judge = { admitted: j.admitted, loadMs: j.loadMs, facts: j.facts }; }, (e) => { state.error = 'judge: ' + e; });

// Hook 1: every page-side API object reaches the worker through RPCProtocol.set, whether the library
// registers it as a named customer or sets it directly (text editors, documents and others are set directly).
// Wrapping here puts the gate in front of all of them. The page keeps its own direct reference.
function gated(sid, instance, host) {
  if (!TABLE_SIDS.has(sid)) state.wrappedNotInTable.push(sid);
  state.customers++;
  return new Proxy(instance, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !prop.startsWith('$')) return value.bind(target);
      return async (...args) => {
        const key = `${sid}.${prop}`;
        state.calls[key] = (state.calls[key] ?? 0) + 1;
        if (prop === '$onExtensionActivationError' || prop === '$onExtensionRuntimeError') state.activationErrors.push({ ext: args[0]?.value ?? String(args[0]), message: args[1]?.message, stack: String(args[1]?.stack ?? '').split('\n').slice(0, 8) });
        const seen = state.hosts[host.index];
        seen.calls++;
        if (prop === '$onWillActivateExtension' || prop === '$onDidActivateExtension') {
          const id = String(args[0]?.value ?? args[0]).toLowerCase();
          host.extensions.add(id);
          seen.extensions = [...host.extensions];
          if (prop === '$onDidActivateExtension') state.activated[id] = host.index;
        }
        const request = requestFor(sid, prop, args, host);
        const cls = METHOD_TABLE[key] ?? 'unmapped';
        state.byClass[cls] = (state.byClass[cls] ?? 0) + 1;
        if (request.refuse) {
          state.denied.push({ call: key, answer: 'refused: ' + request.refuse });
          throw new Error(`gate: refused (${request.refuse}) ${key}`);
        }
        if (request !== 'pass') {
          const t = performance.now();
          let answer;
          try {
            const said = await (await judge).ask(request.facts);
            // The gate and the scope rules must read the path as the same place, or nothing is let through.
            answer = said.place !== null && said.place !== request.place ? `deny (the gate reads the path as ${said.place}, the scope rules as ${request.place})` : said.answer;
            (state.gateLines ??= []).length < 200 && state.gateLines.push(`${said.line} -> ${said.answer}`);
          } catch (error) {
            // A fact the gate does not admit is refused by it, not guessed.
            answer = `deny (${error?.code ?? error?.message ?? error})`;
          }
          state.judgeMs.push(+(performance.now() - t).toFixed(3));
          if (answer !== 'allow') {
            state.denied.push({ call: key, answer, host: host.index });
          seen.denied++;
            throw new Error(`gate: ${answer} ${key}`);
          }
        }
        return value.apply(target, args);
      };
    },
  });
}
if (useGate) {
  const originalSet = RPCProtocol.prototype.set;
  RPCProtocol.prototype.set = function (identifier, instance) {
    originalSet.call(this, identifier, gated(identifier.sid ?? String(identifier), instance, hostOf(this)));
    return instance;
  };
}

// Hook 2: replace the extension-host iframe page with one whose CSP blocks outside connections.
if (strictCsp) {
  registerAssets({
    'vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html': () => new URL('/strict-iframe.html', altOrigin ?? location.origin).href,
  });
}

window.MonacoEnvironment = {
  getWorkerUrl: (_moduleId, label) => (label === 'extensionHostWorkerMain' ? extHostWorkerUrl : editorWorkerUrl),
  getWorkerOptions: () => ({ type: 'module' }),
};

CommandsRegistry.registerCommand('spike.report', (_accessor, json) => {
  state.probe = JSON.parse(json);
  show();
  return 'reported';
});

// Private page data an extension must not reach.
await new Promise((res, rej) => {
  const q = indexedDB.open('gate-private', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onerror = () => rej(q.error);
  q.onsuccess = () => {
    const tx = q.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('IDB-SECRET', 'token');
    tx.oncomplete = () => { q.result.close(); res(); };
  };
});
{
  const dir = await navigator.storage.getDirectory();
  const w = await (await dir.getFileHandle('gate-private.txt', { create: true })).createWritable();
  await w.write('OPFS-SECRET');
  await w.close();
}

try {
  if (judge) await judge;
  if (commandJudge) await commandJudge;
  if (useIdentity) {
    // Prism ID, as in every Prism app: no sign-in. With one shared worker the grants of the extension under test
    // apply to every call from the worker, the probe's included.
    try {
      const id = await openIdentity();
      const g = await loadGrants(id, grantsFor);
      if (g.source === 'stored') for (const r of RESOURCES) { GRANTS[r] = g.granted.includes(r); DENIED[r] = g.denied.includes(r); }
      state.identity = { prism: id.account.id, device: id.account.key, extension: grantsFor, grants: g };
      window.__grants = {
        save: (granted, denied = []) => saveGrants(id, grantsFor, { granted, denied }),
        clear: () => clearGrants(grantsFor),
        corrupt: () => corruptGrants(grantsFor),
        defaults: DEFAULT_GRANTS,
      };
    } catch (e) {
      state.identity = { error: String((e?.code ? e.code + ': ' : '') + (e?.message ?? e)) };
    }
  }
  const provider = new RegisteredFileSystemProvider(false);
  provider.registerFile(new RegisteredMemoryFile(URI.file('/workspace/allowed.txt'), 'hello from the workspace'));
  provider.registerFile(new RegisteredMemoryFile(URI.file('/secret/token.txt'), 'SECRET-TOKEN'));
  provider.registerFile(new RegisteredMemoryFile(URI.file('/workspace/demo.txt'), 'const answer = 41;\nconsole.log(anwser);\n'));
  registerFileSystemOverlay(1, provider);

  if (realExt) {
    // A real extension, unpacked from its .vsix under /ext/<name>/, loaded unmodified.
    // Registered before the workbench starts, so its settings are in the worker's first snapshot.
    const base = new URL(`/ext/${realExt}/`, location.origin).href;
    const manifest = await (await fetch(base + 'package.json')).json();
    const list = await (await fetch(base + 'files.json')).json();
    // The worker can activate an extension before its default settings arrive. Register them up front.
    const configs = [manifest.contributes?.configuration ?? []].flat();
    Registry.as(ConfigurationExtensions.Configuration).registerConfigurations(configs.map((c, i) => ({ id: `${manifest.name}.${i}`, title: c.title, type: 'object', properties: c.properties })));
    const real = registerExtension(manifest, ExtensionHostKind.LocalWebWorker);
    for (const f of list) real.registerFileUrl('./' + f, base + f);
    state.realRegistered = `${manifest.publisher}.${manifest.name}@${manifest.version}`;
    realId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
    KNOWN_IDS.push(realId);
    if (separate) await initUserConfiguration(JSON.stringify({ 'extensions.experimental.affinity': { [`${manifest.publisher}.${manifest.name}`]: 1 } }));
  }

  await initialize(
    {
      ...getExtensionsOverride({ enableWorkerExtensionHost: true, ...(altOrigin ? { iframeAlternateDomain: altOrigin } : {}) }),
      ...getFilesOverride(),
      ...getConfigurationOverride(),
      // The library's whole workbench: layout, editor service, status bar, themes, problems.
      ...(fullWorkbench ? {
        ...getWorkbenchOverride(), ...getModelOverride(), ...getLanguagesOverride(), ...getThemeOverride(), ...getMarkersOverride(),
        ...getStorageOverride(), ...getLifecycleOverride(), ...getNotificationsOverride(), ...getDialogsOverride(),
      } : {}),
    },
    fullWorkbench ? document.getElementById('wbfull') : document.getElementById('wb'),
  );

  const { registerFileUrl, whenReady } = registerExtension({
    name: 'probe',
    publisher: 'spike',
    version: '1.0.0',
    engines: { vscode: '*' },
    browser: './extension.js',
    activationEvents: ['*'],
  }, ExtensionHostKind.LocalWebWorker);
  registerFileUrl('./extension.js', new URL('/ext/extension.js', location.origin).href);
  if (whenReady) await whenReady();
  state.registered = true;

  if (separate) {
    // The probe cannot see or activate an extension in another worker, so the page does it and reads the outcome
    // from what that worker reports: a did-activate notice, or an activation error.
    const extensions = await getService(IExtensionService);
    setTimeout(async () => {
      const row = { id: realId, activeBefore: state.activated[realId] !== undefined };
      let timedOut = false;
      try {
        await Promise.race([
          extensions.activateById(new ExtensionIdentifier(realId), { startup: false, extensionId: new ExtensionIdentifier('spike.probe'), activationEvent: 'api' }),
          new Promise((_, rej) => setTimeout(() => { timedOut = true; rej(new Error('activation timed out after 8s')); }, 8000)),
        ]);
      } catch (e) { row.error = String((e && e.message) || e).slice(0, 300); }
      await new Promise((r) => setTimeout(r, 500));
      const failure = state.activationErrors.find((e) => String(e.ext).toLowerCase() === realId);
      row.activated = !timedOut && state.activated[realId] !== undefined && !failure;
      if (!row.activated && !row.error) row.error = String(failure?.message ?? 'no activation notice from its worker').slice(0, 300);
      row.host = state.activated[realId] ?? null;
      state.pageLate = { exts: [row] };
      show();
    }, 4000);
  }

  if (realExt) {
    // A real extension, unpacked from its .vsix under /ext/<name>/, loaded unmodified.
    const cfg = await getService(IConfigurationService);
    state.pageSeesExtensionSettings = cfg.getValue('errorLens') !== undefined;
    setTimeout(() => { state.pageSeesExtensionSettingsLater = cfg.getValue('errorLens') !== undefined; state.enabledDefault = cfg.getValue('errorLens.enabled'); }, 2000);

    const problems = [
      { severity: 8, message: 'Spike error: anwser is not defined', startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 19 },
      { severity: 4, message: 'Spike warning: answer is never read', startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 13 },
    ];
    if (fullWorkbench) {
      // Open the file the way a user would: through the workbench's editor service.
      const demo = URI.file('/workspace/demo.txt');
      const pane = await (await getService(IEditorService)).openEditor({ resource: demo, options: { pinned: true } });
      state.editor = { opened: !!pane };
      const markers = await getService(IMarkerService);
      // A language service reports problems after the editor is open, not in the same tick.
      setTimeout(() => { markers.changeOne('spike', demo, problems); state.editor.markers = markers.read({ resource: demo }).length; }, 3000);
    } else {
      // One visible editor with two problems in it, so the extension has something to draw.
      const host = document.getElementById('editor');
      host.style.display = 'block';
      const model = monaco.editor.createModel('const answer = 41;\nconsole.log(anwser);\n', 'plaintext', monaco.Uri.file('/workspace/demo.txt'));
      const editor = monaco.editor.create(host, { model, automaticLayout: true });
      const setProblems = () => {
        monaco.editor.setModelMarkers(model, 'spike', [
          { severity: monaco.MarkerSeverity.Error, message: 'Spike error: anwser is not defined', startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 19 },
          { severity: monaco.MarkerSeverity.Warning, message: 'Spike warning: answer is never read', startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 13 },
        ]);
        state.editor = { lines: model.getLineCount(), markers: monaco.editor.getModelMarkers({}).length };
      };
      // A language service reports problems after the editor is open, not in the same tick.
      setTimeout(setProblems, 3000);
      state.editor = { lines: model.getLineCount(), markers: monaco.editor.getModelMarkers({}).length };
      window.__editor = editor;
    }
  }
} catch (e) {
  state.error = String((e && e.stack) || e);
}
show();
