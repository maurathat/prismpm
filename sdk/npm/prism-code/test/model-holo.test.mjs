// A text application's holo built with nothing compiled (src/journey/model-holo.mjs), and its page
// (src/journey/text-view.mjs). The holo is read back by the package's own loader, as any holo is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadArchive } from '../src/index.mjs';
import { readObjects, writeObjects } from '../src/uorc.mjs';
import { EVALUATOR_GUEST } from '../src/journey/model-guest.mjs';
import { HOLO_BUILDER, NO_CAPABILITIES_OBJECT, buildHolo } from '../src/journey/model-holo.mjs';
import { TEXT_VIEW_CSS, TEXT_VIEW_HOLOGRAM_JS, TEXT_VIEW_SHARED_JS, textViewBundle } from '../src/journey/text-view.mjs';

const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const here = existsSync(fileURLToPath(new URL('loan-snapshot.json', models)));
const skip = !here && 'no lean-prover package beside this one';
const snapshot = (name) => JSON.parse(readFileSync(new URL(`${name}-snapshot.json`, models), 'utf8'));
const evaluator = () => readFileSync(new URL(`../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url));
const objectsOf = (bytes) => readObjects(bytes).map((o) => Uint8Array.from(o.bytes ?? o));
const dec = new TextDecoder();
const enc = new TextEncoder();

test('the page is the bytes the SDK image writes for the same view', () => {
  const sdk = objectsOf(readFileSync(new URL('../fixtures/PaymentApproval.v5.holo', import.meta.url)));
  const app = JSON.parse(dec.decode(sdk[6])).application;
  const v = app.view;
  const made = textViewBundle({ title: v.title, heading: v.heading, inputLabel: v.input_label, submitLabel: v.submit_label, outputLabel: v.output_label, inputError: v.input_error, responseError: v.response_error }, { requestMaximum: app.request_maximum, responseMaximum: app.response_maximum });
  assert.deepEqual(made, sdk[5]);
  assert.deepEqual(NO_CAPABILITIES_OBJECT, sdk[3]);
});

test("the page's texts are the generator's own files", { skip: !existsSync(fileURLToPath(new URL('../../../../vendor/lean4-prod/rust/prod-codegen/src/text_view.rs', import.meta.url))) && 'no lean4-prod beside this package' }, () => {
  const source = (name) => readFileSync(new URL(`../../../../vendor/lean4-prod/rust/prod-codegen/src/${name}`, import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.equal(TEXT_VIEW_SHARED_JS, source('text_view_shared.js'));
  assert.equal(TEXT_VIEW_HOLOGRAM_JS, source('text_view_hologram.js'));
  assert.ok(source('text_view.rs').includes(`const CSS: &str = "${TEXT_VIEW_CSS.split('\n').join('\\n')}";`));
});

test('text in a view is never markup or code', () => {
  const view = { title: '<b>&"\'', heading: 'h', inputLabel: 'i', submitLabel: 's', outputLabel: 'o', inputError: 'a"b\\c\nd', responseError: 'r' };
  const text = dec.decode(textViewBundle(view, { requestMaximum: 8, responseMaximum: 8 }));
  assert.ok(text.includes('<title>&lt;b&gt;&amp;&quot;&#39;</title>'));
  assert.ok(text.includes('const INPUT_ERROR="a\\"b\\\\c\\nd";'));
  assert.throws(() => textViewBundle({ ...view, heading: ' ' }, { requestMaximum: 8, responseMaximum: 8 }));
  assert.throws(() => textViewBundle(view, { requestMaximum: 0, responseMaximum: 8 }));
});

for (const name of ['loan', 'seat']) {
  test(`${name}: the holo verifies, answers its own vectors, and is the same bytes twice`, { skip }, async () => {
    const built = await buildHolo(snapshot(name), { evaluator: evaluator() });
    const app = await loadArchive(built.bytes, {});
    assert.equal(app.identities.verified, true);
    assert.equal(app.identities.consistent, true);
    const acceptance = await app.acceptance();
    assert.ok(acceptance.total > 0);
    assert.deepEqual(acceptance.failed, []);
    assert.deepEqual((await buildHolo(snapshot(name), { evaluator: evaluator() })).bytes, built.bytes);
    assert.equal(built.compared.agreed, built.compared.total);
  });
}

test('the provenance names what built the holo, and no Cargo crate or browser adapter', { skip }, async () => {
  const built = await buildHolo(snapshot('loan'), { evaluator: evaluator() });
  const provenance = JSON.parse(dec.decode(objectsOf(built.bytes)[2]));
  assert.equal(provenance.builder.name, HOLO_BUILDER);
  assert.equal(provenance.builder.evaluator_guest, EVALUATOR_GUEST.kappa);
  assert.equal(provenance.semantic_id, snapshot('loan').semantic_id);
  assert.ok(!('cargo_crate_sha256' in provenance) && !('lean4_prod_commit' in provenance));
});

test('planted defects: a changed guest, a changed model member, and a changed byte of the file are each seen', { skip }, async () => {
  const built = await buildHolo(snapshot('loan'), { evaluator: evaluator() });
  const objects = objectsOf(built.bytes);
  // One byte of the file: the seal no longer matches.
  const flipped = built.bytes.slice();
  flipped[flipped.length - 40] ^= 1;
  await assert.rejects(loadArchive(flipped, {}));
  // The guest's program changed and the file sealed again: the manifest names another guest.
  const guest = objects[4].slice();
  guest[guest.length - 8] ^= 1;
  const resealed = writeObjects([...objects.slice(0, 4), guest, ...objects.slice(5)]);
  await assert.rejects(loadArchive(resealed, {}));
  assert.equal((await loadArchive(resealed, { allowUnverified: true })).identities.verified, false);
  // The model document changed and the file sealed again.
  const model = enc.encode(dec.decode(objects[6]).replace('"response_maximum":', '"response_maximum" :'));
  assert.equal((await loadArchive(writeObjects([...objects.slice(0, 6), model]), { allowUnverified: true })).identities.verified, false);
});

test('a model with no acceptance vectors is not built', { skip }, async () => {
  const changed = JSON.parse(JSON.stringify(snapshot('loan')));
  const record = changed.modules.find((m) => m.name === 'LoanApproval').semantic.declarations.find((d) => d.name === 'application').body;
  record.fields.find((f) => f.field === 'acceptanceVectors').value = { kind: 'nil', element: { kind: 'named', member: { name: 'AcceptanceVector' }, arguments: [] } };
  await assert.rejects(buildHolo(changed, { evaluator: evaluator() }), (e) => e.code === 'holo.no-vectors');
});

test('a model whose own example its rules do not answer is not built', { skip }, async () => {
  const changed = JSON.parse(JSON.stringify(snapshot('loan')));
  const app = changed.modules.find((m) => m.name === 'LoanApproval');
  const constant = app.semantic.declarations.find((d) => d.kind === 'definition' && d.parameters.length === 0 && d.body.kind === 'nat' && d.name.startsWith('answer'));
  constant.body.value = String(BigInt(constant.body.value) + 1n);
  await assert.rejects(buildHolo(changed, { evaluator: evaluator() }), (e) => e.code === 'holo.vectors');
});

test('an evaluator guest that is not the pinned one builds nothing', { skip }, async () => {
  const other = evaluator();
  other[other.length - 1] ^= 1;
  await assert.rejects(buildHolo(snapshot('loan'), { evaluator: other }), (e) => e.code === 'guest.evaluator');
});
