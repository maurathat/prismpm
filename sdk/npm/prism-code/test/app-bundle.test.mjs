// DK-49: an app as one content-addressed bundle. Every object is named by the BLAKE3 label of its bytes and the app by
// the label of its manifest; a bundle is pushed to a folder or to this machine's store and pulled back only when every
// object re-derives its label. Nothing is fetched here (PRISM_LEXLEAN_FETCH=0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appDir, readSession, startApp, writeSession } from '../src/journey/project.mjs';
import { BUNDLE_SCHEMA, bundleOf, parseReference, pullBundle, pushBundle } from '../src/journey/app-bundle.mjs';
import { kappa } from '../src/blake3.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));
process.env.PRISM_LEXLEAN_FETCH = '0';
const env = { PRISM_HOME: process.env.PRISM_HOME };
const fresh = (name) => mkdtempSync(join(tmpdir(), `prism-${name}-`));
const ruleApp = () => {
  const dir = appDir(fresh('app'));
  startApp(dir, 'rule-app');
  const session = readSession(dir);
  session.starter = 'rule-app';
  writeSession(dir, session);
  return { dir, session };
};

test('an app is one bundle: every object named by the label of its bytes, the app by the label of its manifest', () => {
  const { dir, session } = ruleApp();
  const one = bundleOf(dir, session);
  const two = bundleOf(dir, readSession(dir));
  assert.equal(one.address, two.address, 'the same app is the same address');
  assert.equal(one.manifest.schema, BUNDLE_SCHEMA);
  assert.equal(one.manifest.starter, 'rule-app');
  assert.ok(one.manifest.model['src/App.lex.tex'], 'the model is in the bundle');
  for (const [label, bytes] of one.objects) assert.equal(kappa(bytes), label);
  writeFileSync(join(dir, 'src', 'App.lex.tex'), readFileSync(join(dir, 'src', 'App.lex.tex'), 'utf8') + '\n');
  assert.notEqual(bundleOf(dir, readSession(dir)).address, one.address, 'an edit is another address');
});

test('a bundle pushed to a folder or to this machine is pulled back byte for byte', async () => {
  const { dir, session } = ruleApp();
  const bundle = bundleOf(dir, session);
  const folder = fresh('store');
  const pushed = await pushBundle(bundle, `dir://${folder}`, { env });
  assert.equal(pushed.address, bundle.address);
  assert.equal(pushed.reference, `dir://${folder}#${bundle.address}`);
  assert.equal(readdirSync(folder).length, bundle.objects.size, 'one file per object, named by its label');
  for (const reference of [pushed.reference, (await pushBundle(bundle, undefined, { env })).reference]) {
    const pulled = await pullBundle(reference, { env });
    assert.equal(pulled.address, bundle.address);
    for (const [path, label] of Object.entries(bundle.manifest.model)) assert.equal(kappa(pulled.files.get(path)), label, path);
  }
});

test('an object that does not re-derive its label is refused', async () => {
  const { dir, session } = ruleApp();
  const bundle = bundleOf(dir, session);
  const folder = fresh('store');
  const { reference } = await pushBundle(bundle, `dir://${folder}`, { env });
  const model = bundle.manifest.model['src/App.lex.tex'];
  writeFileSync(join(folder, model.slice(7)), 'not the model');
  await assert.rejects(pullBundle(reference, { env }), (e) => e.code === 'bundle.altered');
});

test('a manifest that names a path outside the app is refused', async () => {
  const folder = fresh('store');
  const object = new TextEncoder().encode('x');
  writeFileSync(join(folder, kappa(object).slice(7)), object);
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: BUNDLE_SCHEMA, starter: 'rule-app', entry: 'src/App.lex.tex', model: { '../escape.txt': kappa(object) } }));
  writeFileSync(join(folder, kappa(manifest).slice(7)), manifest);
  await assert.rejects(pullBundle(`dir://${folder}#${kappa(manifest)}`, { env }), (e) => e.code === 'bundle.path');
});

test('references: a κ-label, dir://<folder>#<κ> or https://<site>#<κ>; https is read-only, and a pull names an app', async () => {
  const label = kappa(new TextEncoder().encode('app'));
  assert.deepEqual(parseReference(label), { kind: 'local', at: null, address: label });
  assert.equal(parseReference(`https://example.github.io/apps#${label}`).kind, 'https');
  assert.throws(() => parseReference('ftp://host#x'), (e) => e.code === 'bundle.reference');
  assert.throws(() => parseReference('dir://x#not-a-label'), (e) => e.code === 'bundle.reference');
  const { dir, session } = ruleApp();
  await assert.rejects(pushBundle(bundleOf(dir, session), `https://example.github.io/apps`, { env }), (e) => e.code === 'bundle.read-only');
  await assert.rejects(pullBundle('dir://somewhere', { env }), (e) => e.code === 'bundle.reference');
});
