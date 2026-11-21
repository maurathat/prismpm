// `prism-code publish-model`: a holo app's model, written beside its page with a record that names the holo and the
// model's identity, so the model can be opened and held to the app in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismCodeError } from '../src/index.mjs';
import { kappa } from '../src/blake3.mjs';
import { HOLO_APP_SCHEMA, writeHoloAppModel } from '../src/journey/holo-app-site.mjs';
import { MODEL_LISTING_SCHEMA } from '../src/journey/model-files.mjs';
import { holoAppRecord } from '../src/journey/model-site.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const fixture = here('../fixtures/Calculator.holo');
const holo = new Uint8Array(readFileSync(fixture));
// The identity the fixture's own provenance names.
const ID = 'be75c14a6c6ae7c21e0bf6abe3c6312cf107fee86d6a01092306ba7162d4a949';
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-publish-model-'));
const run = (args, options = {}) => {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
};
function project(files) {
  const dir = scratch();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const walk = (dir, rel = '') => readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [rel + e.name])).sort();
const MODEL = {
  'lexlean.toml': 'entrypoints = ["src/App.lex.tex"]\n',
  'src/App.lex.tex': 'model\n',
  'lake-manifest.json': '{}\n',
  // Left out: not read by a check, or not the author's to publish.
  'session.json': '{"folder":"/home/someone"}\n',
  'NOTES.md': 'notes\n',
  '.prism/build/x.holo': 'built\n',
  'target/debug/x': 'built\n',
};
const FILES = ['lake-manifest.json', 'lexlean.toml', 'src/App.lex.tex'];

test('the model is written as LexLean reads it, with a record that names the holo and the identity the holo gives', () => {
  const model = project(MODEL);
  const out = scratch();
  // A model published by an earlier build is replaced whole, not added to.
  mkdirSync(join(out, 'model'));
  writeFileSync(join(out, 'model', 'stale.lex.tex'), 'from an earlier build\n');
  const made = writeHoloAppModel({ holo, model, out });
  assert.deepEqual(walk(join(out, 'model')), [...FILES, 'project.json'].sort());
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'model', 'project.json'), 'utf8')), { schema: MODEL_LISTING_SCHEMA, files: FILES, entry: 'src/App.lex.tex', semanticId: ID });
  const record = { schema: HOLO_APP_SCHEMA, name: 'prism-calculator', holo: kappa(holo), bytes: holo.length, semanticId: ID };
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'app.holo.json'), 'utf8')), record);
  assert.deepEqual(made, { files: 3, entry: 'src/App.lex.tex', holo: record.holo, semanticId: ID, name: 'prism-calculator' });
  // The name the page gives is the record's, when it gives one.
  assert.equal(writeHoloAppModel({ holo, model, out, name: 'Calculator' }).name, 'Calculator');
  // It adds to a site that is already there: what else the site holds is left as it was.
  writeFileSync(join(out, 'index.html'), 'the page\n');
  writeHoloAppModel({ holo, model, out });
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), 'the page\n');
  // The record is the one a holo built by prism-code gets (model-site.mjs).
  assert.deepEqual(readFileSync(join(out, 'app.holo.json')), holoAppRecord(holo, { name: 'prism-calculator', semanticId: ID }));
});

test('nothing is written for a folder that is no LexLean project, or bytes that are no holo', () => {
  const out = scratch();
  const bare = project({ 'lexlean.toml': 'entrypoints = ["src/Missing.lex.tex"]\n' });
  assert.throws(() => writeHoloAppModel({ holo, model: bare, out }), (e) => e instanceof PrismCodeError && e.code === 'publish-model.model');
  assert.throws(() => writeHoloAppModel({ holo, model: join(bare, 'absent'), out }), (e) => e.code === 'publish-model.model');
  assert.throws(() => writeHoloAppModel({ holo: new TextEncoder().encode('not a holo'), model: project(MODEL), out }));
  assert.deepEqual(readdirSync(out), []);
});

test('the command writes the same, says what it wrote, and needs to be told where', () => {
  const model = project(MODEL);
  const out = scratch();
  const done = run(['publish-model', fixture, '--project', model, '--out', out]);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^wrote the model, 3 files, to .*model and its record to .*app\.holo\.json \(holo blake3:[0-9a-f]{12}, model be75c14a6c6a\)\n$/);
  assert.deepEqual(walk(join(out, 'model')), [...FILES, 'project.json'].sort());
  const json = run(['publish-model', fixture, '--project', model, '--out', out, '--json']);
  assert.deepEqual(JSON.parse(json.out), { files: 3, entry: 'src/App.lex.tex', holo: kappa(holo), semanticId: ID, name: 'prism-calculator' });

  const cwd = scratch();
  for (const [args, why] of [
    [['publish-model'], /publish-model takes one holo/],
    [['publish-model', fixture, '--project', model], /publish-model needs --out <dir>/],
    [['publish-model', fixture, '--out', out], /publish-model needs --project <dir>/],
  ]) {
    const refused = run(args, { cwd });
    assert.equal(refused.code, 64, args.join(' '));
    assert.match(refused.err, why);
  }
  assert.deepEqual(readdirSync(cwd), [], 'nothing was written to the working directory');
  // A folder that is no project is the caller's error, by its code, and leaves the site as it was.
  const empty = scratch();
  const bad = run(['publish-model', fixture, '--project', scratch(), '--out', empty]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /^publish-model\.model: /);
  assert.equal(existsSync(join(empty, 'app.holo.json')), false);
});
