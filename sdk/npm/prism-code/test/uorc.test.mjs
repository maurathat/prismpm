// Holo v5 is a raw UORC archive (ADR-017): this reader and the uorc CLI must see the same archive.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DigestMismatchError } from '../src/errors.mjs';
import { chain, formatOf, isLabel, kappa, labelOf, layout, readObjects, sealOf, writeObjects } from '../src/uorc.mjs';
import { blake3Hex } from '../src/blake3.mjs';

const root = new URL('../../../../', import.meta.url);
const oracle = JSON.parse(readFileSync(new URL('tests/data/holo-v5-uorc-oracle.json', root), 'utf8'));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('κ is the sha256 label', () => {
  assert.equal(kappa(new TextEncoder().encode('abc')), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('layout and seal agree with what uorc inspect reports for every fixture', () => {
  for (const archive of oracle.archives) {
    const bytes = new Uint8Array(readFileSync(new URL(archive.path, root)));
    const { objects, sealed, seal } = layout(bytes);
    assert.equal(sealed, archive.integrity_ok, archive.path);
    assert.equal(bytes.length, archive.archive_bytes, archive.path);
    assert.deepEqual(objects.map((o) => o.length), archive.object_lengths, archive.path);
    assert.equal(hex(seal), archive.digest, archive.path);
  }
});

test('objects round trip, the seal covers every tail length, and any changed byte is refused', () => {
  for (const length of [0, 1, 55, 63, 64, 65, 127, 128, 129]) {
    const object = new Uint8Array(length).fill(0xa5);
    const archive = writeObjects([object, new Uint8Array(0)]);
    assert.deepEqual(hex(chain(archive.subarray(0, archive.length - 32))), hex(archive.subarray(archive.length - 32)));
    assert.deepEqual(readObjects(archive).map(hex), [hex(object), '']);
  }
  const archive = writeObjects([new TextEncoder().encode('guest')]);
  for (let i = 6; i < archive.length; i += 1) {
    const bad = archive.slice();
    bad[i] ^= 1;
    assert.throws(() => readObjects(bad), DigestMismatchError, `byte ${i}`);
  }
});

// Holo v6 (ADR-018): profile 2, sealed and named by BLAKE3. The Rust twin is held to the same vectors.
const vectors = JSON.parse(readFileSync(new URL('tests/data/holo-v6-container.json', root), 'utf8'));
const unhex = (text) => Uint8Array.from(Buffer.from(text, 'hex'));

test('v6 archives are the recorded bytes, sealed by plain BLAKE3 of every byte before the seal', () => {
  assert.ok(vectors.cases.length >= 12);
  for (const vector of vectors.cases) {
    const objects = vector.objects.map(unhex);
    const archive = writeObjects(objects, 6);
    assert.equal(hex(archive), vector.archive, vector.name);
    assert.equal(hex(archive.subarray(0, 6)), '554f52430202', vector.name);
    assert.equal(vector.seal, blake3Hex(archive.subarray(0, archive.length - 32)), vector.name);
    assert.equal(labelOf(6, archive), vector.label, vector.name);
    assert.equal(vector.label, `blake3:${blake3Hex(archive)}`, vector.name);
    const read = layout(archive);
    assert.equal(read.format, 6, vector.name);
    assert.equal(read.sealed, true, vector.name);
    assert.deepEqual(readObjects(archive).map(hex), vector.objects, vector.name);
  }
});

test('v6 refuses any changed byte, and a v5 seal does not pass for v6 or the other way round', () => {
  const objects = [new TextEncoder().encode('guest'), new TextEncoder().encode('view')];
  const archive = writeObjects(objects, 6);
  for (let i = 6; i < archive.length; i += 1) {
    const bad = archive.slice();
    bad[i] ^= 1;
    assert.throws(() => readObjects(bad), DigestMismatchError, `byte ${i}`);
  }
  // The same preimage under the other profile byte: the seal of one format is never accepted for the other.
  const v5 = writeObjects(objects, 5);
  const relabelled = v5.slice();
  relabelled[5] = 2;
  assert.throws(() => readObjects(relabelled), DigestMismatchError);
  const back = archive.slice();
  back[5] = 1;
  assert.throws(() => readObjects(back), DigestMismatchError);
});

test('the profile byte names the format, and labels follow it', () => {
  const abc = new TextEncoder().encode('abc');
  assert.equal(formatOf(writeObjects([abc], 5)), 5);
  assert.equal(formatOf(writeObjects([abc], 6)), 6);
  const unknown = writeObjects([abc], 6);
  unknown[5] = 3;
  assert.equal(formatOf(unknown), null);
  assert.throws(() => layout(unknown), /profile 1 or 2/);
  assert.equal(labelOf(5, abc), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(labelOf(6, abc), 'blake3:6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
  assert.ok(isLabel(6, labelOf(6, abc)) && !isLabel(6, labelOf(5, abc)) && !isLabel(5, labelOf(6, abc)));
  assert.equal(hex(sealOf(6, abc)), '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
  assert.throws(() => writeObjects([abc], 7), /no holo format 7/);
});
