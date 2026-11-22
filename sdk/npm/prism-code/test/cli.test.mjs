import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkImageFromLock } from '../src/lock.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const closure = fileURLToPath(new URL('./fixtures/calculator-closure', import.meta.url));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';

test('vectors replays the fixture: 22 of 22', () => {
  const { code, out } = run(['vectors', fixture]);
  assert.equal(code, 0, out);
  assert.match(out, /^22 of 22 vectors passed \(holo, Calculator, identities verified\)/m);
});

test('inspect prints the human view, and the whole inspection with --json', () => {
  // Full coverage of the verb is in inspect.test.mjs.
  const human = run(['inspect', fixture]);
  assert.equal(human.code, 0, human.err);
  assert.match(human.out, /^Name: {6}Calculator$/m);
  const inspection = JSON.parse(run(['inspect', fixture, '--json']).out);
  assert.equal(inspection.schema, 'prismpm/holo-inspection/1');
  assert.equal(inspection.model.vectors, 22);
  assert.equal(inspection.sections.length, 8);
});

test('vectors on a closure needs the model for the numeric profile', () => {
  const without = run(['vectors', closure]);
  assert.equal(without.code, 2);
  assert.match(without.err, /closure\.model/);
});

test('usage errors exit 64 and name the problem', () => {
  assert.equal(run([]).code, 64);
  assert.equal(run(['frobnicate']).code, 64);
  assert.equal(run(['vectors']).code, 64);
  assert.match(run(['--help']).out, /Usage:/);
  assert.match(run(['--version']).out, /^\d+\.\d+\.\d+/);
});

test('a refused artifact exits 2 with the reader\'s code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-'));
  const bad = join(dir, 'bad.holo');
  writeFileSync(bad, Buffer.from('HOLX' + '\0'.repeat(60)));
  const { code, err } = run(['vectors', bad]);
  assert.equal(code, 2);
  assert.match(err, /^archive\.magic:/);
});

test('the lock admits only an immutable image reference', () => {
  assert.equal(sdkImageFromLock(JSON.stringify({ sdk_image: IMAGE })), IMAGE);
  assert.equal(sdkImageFromLock(`{"x":1,"sdk_image":"${IMAGE}"}`), IMAGE);
  for (const image of ['ghcr.io/uor-foundation/prismpm-sdk:latest', 'prismpm-sdk@sha256:abc', '']) {
    assert.throws(() => sdkImageFromLock(JSON.stringify({ sdk_image: image })), (e) => e.code === 'lock.image', image);
  }
  assert.throws(() => sdkImageFromLock('not json'), (e) => e.code === 'lock.image');
});

test('vectors refuses an altered holo, and with --allow-unverified runs it and still exits 1 (#583)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-583-'));
  const altered = new Uint8Array(readFileSync(fixture));
  altered[300] ^= 1;
  const path = join(dir, 'altered.holo');
  writeFileSync(path, altered);
  const refused = run(['vectors', path]);
  assert.notEqual(refused.code, 0, refused.out);
  assert.equal(refused.out, '');
  assert.match(refused.err, /the holo was altered/);
  const allowed = run(['vectors', path, '--allow-unverified']);
  assert.equal(allowed.code, 1, allowed.err);
  assert.match(allowed.out, /22 of 22 vectors passed \(holo, Calculator, identities NOT verified\)/);
});
