// The folder a built holo app is published from (src/journey/model-site.mjs): the holo, what it is, and the model's
// source beside it, as a rule app's page carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kappa } from '../src/blake3.mjs';
import { MODEL_LISTING_SCHEMA, modelFiles } from '../src/journey/model-files.mjs';
import { HOLO_APP_SCHEMA, writeHoloSite } from '../src/journey/model-site.mjs';
import { startApp } from '../src/journey/project.mjs';

const fresh = (name) => mkdtempSync(join(tmpdir(), `prism-${name}-`));
const holo = readFileSync(new URL('../fixtures/PaymentApproval.v5.holo', import.meta.url));
const semanticId = `sha256:${'ab'.repeat(32)}`;

test('the folder holds the holo, its record under the BLAKE3 label, and the model with its listing', () => {
  const app = fresh('app');
  startApp(app, 'decision-app');
  writeFileSync(join(app, 'session.json'), '{}');
  const model = modelFiles(app);
  const site = writeHoloSite(join(fresh('site'), 'out'), holo, { name: 'Parking fee tier', semanticId, model });
  assert.deepEqual(readFileSync(join(site.directory, 'app.holo')), holo);
  assert.deepEqual(JSON.parse(readFileSync(join(site.directory, 'app.holo.json'), 'utf8')), { schema: HOLO_APP_SCHEMA, name: 'Parking fee tier', holo: kappa(holo), bytes: holo.length, semanticId });
  const listing = JSON.parse(readFileSync(join(site.directory, 'model', 'project.json'), 'utf8'));
  assert.equal(listing.schema, MODEL_LISTING_SCHEMA);
  assert.equal(listing.semanticId, semanticId);
  assert.equal(listing.entry, model.entry);
  for (const path of listing.files) assert.deepEqual(readFileSync(join(site.directory, 'model', path)), Buffer.from(model.files.get(path)), path);
  // Nothing a static host would not serve, and nothing of the author's machine.
  assert.ok(site.files.every((path) => !path.split('/').some((part) => part.startsWith('.'))), 'no file or folder starts with a dot');
  assert.ok(!site.files.includes('model/session.json'));
});

test('writing again replaces what was there, and a holo alone is written without a model', () => {
  const directory = join(fresh('site'), 'out');
  writeHoloSite(directory, holo, { name: 'a', semanticId, model: { files: new Map([['old.txt', Buffer.from('x')]]), entry: 'old.txt' } });
  const second = writeHoloSite(directory, holo, { name: 'a', semanticId });
  assert.deepEqual(second.files, ['app.holo', 'app.holo.json']);
  assert.throws(() => readFileSync(join(directory, 'model', 'old.txt')));
});
