// The facts the extension page sends to Holospace's gate (ide/src/gate-facts.js), against the library the page pins.
// Usage: node ide/tools/gate-facts-test.mjs [folder holding the pinned library]
//
// The library is fetched from the release tools/holospace-pins.json names, or read from the folder given (or
// PRISM_HOLOSPACE_DIR), and used only when its bundle is the pinned bytes. Its own `extensionLine` then reads each
// set of facts, with nothing of a browser needed: this checks that the place the scope rules give is the place the
// gate reads from the path sent, and that the eight words are the ones meant. The kernel's answers are Holospace's
// to prove and are asked in a page, not here.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kappa } from '../../src/blake3.mjs';

// ide/ is a CommonJS package to Node, so the page's two modules are read as text and loaded as one module, as
// scope-test.mjs loads scope.js: the scope rules first, then the facts, which import them.
const read = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const joined = [read('scope.js'), read('gate-facts.js').split('\n').filter((line) => line !== "import { pathInside } from './scope.js';").join('\n')].join('\n');
assert.equal(/^import /m.test(joined), false, 'gate-facts.js imports something this test does not load');
const { gateFacts, placeOfCall, RESOURCES } = await import('data:text/javascript;base64,' + Buffer.from(joined).toString('base64'));

const pins = JSON.parse(readFileSync(new URL('./holospace-pins.json', import.meta.url), 'utf8'));
const pin = pins.files.find((file) => file.path === pins.entry);
const folder = process.argv[2] ?? process.env.PRISM_HOLOSPACE_DIR ?? null;
let bytes;
if (folder) bytes = new Uint8Array(readFileSync(join(folder, pin.path)));
else {
  const response = await fetch(new URL(pin.path.split('/').pop(), pins.from));
  assert.equal(response.ok, true, `${pins.from}${pin.path} answered HTTP ${response.status}`);
  bytes = new Uint8Array(await response.arrayBuffer());
}
assert.equal(kappa(bytes), pin.kappa, 'the library is not the pinned bytes');
const kept = join(mkdtempSync(join(tmpdir(), 'holospace-')), 'holospace.bundle.mjs');
writeFileSync(kept, bytes);
const { extensionLine } = await import(pathToFileURL(kept).href);
assert.equal(typeof extensionLine, 'function', 'the pinned library has no extensionLine');

const all = new Set(RESOURCES);
const file = (path) => ({ scheme: 'file', path });
const cases = [
  // [what, uri, other, place]
  ['no file named', null, false, 'workspace'],
  ['a file of the workspace', file('/workspace/src/a.txt'), false, 'workspace'],
  ['the workspace itself', file('/workspace'), false, 'workspace'],
  ['a folder that only starts like the workspace', file('/workspace2/a.txt'), false, 'outside'],
  ['a file outside', file('/secret/token.txt'), false, 'outside'],
  ['a path that climbs out', file('/workspace/../secret/token.txt'), false, 'outside'],
  ['its own global storage', file('/User/globalStorage/pub.ext/state.json'), false, 'storage'],
  ['its own workspace storage', file('/User/workspaceStorage/abc/pub.ext/x'), false, 'storage'],
  ['the same storage through the editor\'s own scheme', { scheme: 'vscode-userdata', path: '/User/globalStorage/pub.ext/state.json' }, false, 'storage'],
  ['another extension\'s storage', file('/User/globalStorage/other.ext/state.json'), true, 'outside'],
  ['the editor\'s settings, which are not storage', { scheme: 'vscode-userdata', path: '/User/settings.json' }, false, 'outside'],
  ['its log', { scheme: 'vscode-log', path: '/20261122/exthost/pub.ext.log' }, false, 'storage'],
  ['a scheme that is not a file', { scheme: 'https', path: '/workspace/a.txt' }, false, 'outside'],
  ['a path with no leading slash', file('workspace/a.txt'), false, 'outside'],
  ['an address that could not be read', { scheme: undefined, path: undefined }, false, 'outside'],
];
for (const [what, uri, other, place] of cases) {
  assert.equal(placeOfCall(uri, { other }).place, place, `the scope rules: ${what}`);
  for (const resource of RESOURCES) {
    const sent = gateFacts({ resource, uri, other, declared: all, granted: false, denied: false, trusted: true });
    const read = extensionLine(sent.facts);
    assert.equal(read.place, place, `the gate reads ${what} as ${read.place}, not ${place}`);
    assert.equal(read.line, `${resource} yes no yes ${place === 'outside' ? 'no' : 'yes'} no tab ${place === 'storage' ? 'yes' : 'no'}`, what);
  }
}

// What is declared, granted, denied and trusted reaches the line as given.
{
  const facts = (over) => gateFacts({ resource: 'network', uri: file('/workspace/a.txt'), declared: all, granted: true, denied: false, trusted: true, ...over }).facts;
  assert.equal(extensionLine(facts({})).line, 'network yes no yes yes yes tab no');
  // The planted request: network not declared, with everything else in its favour.
  assert.equal(extensionLine(facts({ declared: new Set(RESOURCES.filter((r) => r !== 'network')) })).line, 'network no no yes yes yes tab no');
  assert.equal(extensionLine(facts({ denied: true })).line, 'network yes yes yes yes yes tab no');
  assert.equal(extensionLine(facts({ trusted: false })).line, 'network yes no no yes yes tab no');
  assert.equal(extensionLine(facts({ granted: false })).line, 'network yes no yes yes no tab no');
  // A word that is not a resource is never sent as declared.
  assert.deepEqual(facts({ declared: new Set(['network', 'root']) }).declared, ['network']);
}
// A path under one scheme is never read as a path of another.
assert.notEqual(gateFacts({ resource: 'read', uri: { scheme: 'vscode-userdata', path: '/workspace/a.txt' }, declared: all }).facts.target, '/workspace/a.txt');

console.log(`gate-facts: over ${cases.length} places and ${RESOURCES.length} resources the gate reads the place the scope rules give; declared, denied, trusted and granted reach its line as given (library ${pins.commit.slice(0, 7)})`);
