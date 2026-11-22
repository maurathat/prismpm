// The comparison the edit pages make between a model and the holo app it was published with (ide/edit/holo-match.mjs).
// Usage: node ide/tools/holo-match-test.mjs
//
// holo-match.mjs imports prism-code as the published page lays it out (./prism-code/blake3.mjs), so this test loads
// it through a loader hook that points that one address at src/blake3.mjs.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { kappa } from '../../src/blake3.mjs';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === './prism-code/blake3.mjs') return next(new URL('../../src/blake3.mjs', context.parentURL).href, context);
  return next(specifier, context);
}`));
const { bareId, holoAppRecord, holoVerdict } = await import('../edit/holo-match.mjs');

const enc = new TextEncoder();
const holoBytes = enc.encode('the holo, as built');
const ID = 'a245e321289408c327650395074cd1a67f83ba1c82fa2f6e87493fb2efeaf818';
const OTHER = '8307e81dce117afbf7cde568760fa610bedec844e97d610b4bd79de750e9fde4';
const record = { schema: 'prism/holo-app/1', name: 'app', holo: kappa(holoBytes), bytes: holoBytes.length, semanticId: 'sha256:' + ID };
const PROJECT = 'https://app.example/thing/model/';

/** A site that serves the given files under https://app.example/thing/. */
const site = (files) => async (address) => {
  const path = address.replace('https://app.example/thing/', '');
  if (!(path in files)) return new Response('not found', { status: 404 });
  return new Response(files[path]);
};
const published = { 'app.holo.json': JSON.stringify(record), 'app.holo': holoBytes };

// The record is found beside model/, and the holo is the bytes it names.
const found = await holoAppRecord(PROJECT, { fetch: site(published) });
assert.equal(found.app, 'https://app.example/thing/');
assert.equal(found.holo, 'same');
assert.equal(bareId('sha256:' + ID), ID);
assert.equal(bareId(ID), ID);
assert.equal(bareId('sha256:xyz'), null);

// The model LexLean reads as the record's identity is the app's, however the identity is written.
for (const identity of [ID, 'sha256:' + ID]) {
  const said = holoVerdict(found, identity, false);
  assert.equal(said.state, 'same');
  assert.match(said.text, /^This is the model the app at https:\/\/app\.example\/thing\/ was built from: .* The app's holo is the bytes its record names, blake3:[0-9a-f]{64}\.$/);
}
assert.equal(holoVerdict(found, ID, true).state, 'same');
assert.match(holoVerdict(found, ID, true).text, /^Your text still has the identity /);

// Planted defect: a model published otherwise than the record names is said plainly; the reader's own change is not blamed on the app.
assert.equal(holoVerdict(found, OTHER, false).state, 'other');
assert.match(holoVerdict(found, OTHER, false).text, new RegExp(`^This is NOT the model the app at .* LexLean gives it sha256:${OTHER}, and the app's record names sha256:${ID}\\.$`));
assert.equal(holoVerdict(found, OTHER, true).state, 'changed');
assert.match(holoVerdict(found, OTHER, true).text, /The app itself is unchanged\.$/);
assert.equal(holoVerdict(found, null, false).state, 'unread');

// Planted defect: the app serves a holo altered by one byte. Whatever the model's identity, nothing is called the app's.
const altered = holoBytes.slice(); altered[0] ^= 1;
const wrong = await holoAppRecord(PROJECT, { fetch: site({ ...published, 'app.holo': altered }) });
assert.equal(wrong.holo, 'other');
assert.equal(wrong.got, kappa(altered));
assert.equal(holoVerdict(wrong, ID, false).state, 'other');
assert.match(holoVerdict(wrong, ID, false).text, /does not serve the holo its record names/);

// A holo that cannot be fetched is said as not checked, and the model is still compared.
const absent = await holoAppRecord(PROJECT, { fetch: site({ 'app.holo.json': JSON.stringify(record) }) });
assert.equal(absent.holo, 'absent');
assert.match(holoVerdict(absent, ID, false).text, /could not be fetched, so it was not checked against its record\.$/);

// No record, a record of another kind, or one that names no holo or no identity: there is nothing to compare with.
assert.equal(await holoAppRecord(PROJECT, { fetch: site({}) }), null);
assert.equal(await holoAppRecord(null, { fetch: site(published) }), null);
for (const bad of [{ ...record, schema: 'prism/rule-app/1' }, { ...record, holo: 'sha256:' + ID }, { ...record, semanticId: 'nothing' }, 'not an object']) {
  assert.equal(await holoAppRecord(PROJECT, { fetch: site({ ...published, 'app.holo.json': JSON.stringify(bad) }) }), null, JSON.stringify(bad).slice(0, 60));
}
assert.equal(await holoAppRecord(PROJECT, { fetch: async () => { throw new TypeError('Failed to fetch'); } }), null);

console.log('holo-match: a model with the identity the record names is the app\'s; another identity, or a holo that is not the named bytes, is not');
