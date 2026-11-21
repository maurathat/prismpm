// A built holo in the app bundle (src/journey/app-bundle.mjs): what prism_push carries and prism_pull returns for an
// app that is not a rule app. Every address here is a UOR κ-label, BLAKE3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../src/blake3.mjs';
import { bundleOf, pullBundle, pushBundle } from '../src/journey/app-bundle.mjs';
import { EVALUATOR_GUEST } from '../src/journey/model-guest.mjs';
import { buildHolo } from '../src/journey/model-holo.mjs';
import { readSession, startApp } from '../src/journey/project.mjs';

const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const skip = !existsSync(fileURLToPath(new URL('loan-snapshot.json', models))) && 'no lean-prover package beside this one';
const fresh = (name) => mkdtempSync(join(tmpdir(), `prism-${name}-`));
const env = { PRISM_KAPPA_DIR: fresh('kappa') };

/** A started decision app with a holo recorded as built, as engine.mjs records one. */
async function builtApp() {
  const dir = fresh('app');
  startApp(dir, 'decision-app');
  const snapshot = JSON.parse(readFileSync(new URL('loan-snapshot.json', models), 'utf8'));
  const built = await buildHolo(snapshot, { evaluator: readFileSync(new URL(`../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url)) });
  const path = join(dir, '.prism', 'build', 'app.holo');
  mkdirSync(join(dir, '.prism', 'build'), { recursive: true });
  writeFileSync(path, built.bytes);
  const session = { ...readSession(dir), starter: 'decision-app', status: { holo: path, built: { path, address: built.label, semanticId: `sha256:${built.semanticId}` } } };
  return { dir, session, built };
}

test("a holo's address is the BLAKE3 label of its bytes", { skip }, async () => {
  const { built } = await builtApp();
  assert.equal(built.label, kappa(built.bytes));
  assert.match(built.label, /^blake3:[0-9a-f]{64}$/);
});

test('a built app that is not a rule app carries its holo in the bundle, under that label', { skip }, async () => {
  const { dir, session, built } = await builtApp();
  const bundle = bundleOf(dir, session);
  assert.deepEqual(bundle.manifest.built, { kind: 'holo', holo: built.label, address: built.label, semanticId: `sha256:${built.semanticId}` });
  assert.deepEqual(new Uint8Array(bundle.objects.get(built.label)), built.bytes);
  for (const [label, bytes] of bundle.objects) assert.equal(kappa(bytes), label);
  // Without a build the bundle is the model alone.
  assert.equal(bundleOf(dir, { ...session, status: {} }).manifest.built, undefined);
});

test('pushed to a folder and pulled back, the holo is the same bytes', { skip }, async () => {
  const { dir, session, built } = await builtApp();
  const folder = fresh('store');
  const pushed = await pushBundle(bundleOf(dir, session), `dir://${folder}`, { env });
  const pulled = await pullBundle(pushed.reference, { env });
  assert.equal(pulled.manifest.built.address, built.label);
  assert.deepEqual(new Uint8Array(pulled.built.holo), built.bytes);
  assert.equal(pulled.built.record, null);
});

test('planted defect: one changed byte of the stored holo is refused, and nothing is returned', { skip }, async () => {
  const { dir, session, built } = await builtApp();
  const folder = fresh('store');
  const pushed = await pushBundle(bundleOf(dir, session), `dir://${folder}`, { env });
  const file = join(folder, built.label.slice('blake3:'.length));
  const changed = readFileSync(file);
  changed[changed.length >> 1] ^= 1;
  writeFileSync(file, changed);
  await assert.rejects(pullBundle(pushed.reference, { env }), (e) => e.code === 'bundle.altered');
});
