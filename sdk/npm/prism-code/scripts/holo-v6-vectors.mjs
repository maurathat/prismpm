/**
 * Writes `tests/data/holo-v6-container.json`: holo v6 container vectors (ADR-018) that both
 * `src/uorc.mjs` and `crates/prismpm/src/holo/v5.rs` are held to. Each case is a list of objects,
 * the archive they are written to, its seal and its κ-label. The lengths straddle BLAKE3's
 * 64-byte block and 1024-byte chunk, where a tree hash goes wrong first.
 *
 *   node scripts/holo-v6-vectors.mjs           write the file
 *   node scripts/holo-v6-vectors.mjs --check   fail if the file is not what this script writes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { labelOf, writeObjects } from '../src/uorc.mjs';

const target = new URL('../../../../tests/data/holo-v6-container.json', import.meta.url);
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const utf8 = (text) => new TextEncoder().encode(text);
const fill = (byte, length) => new Uint8Array(length).fill(byte);

const cases = [
  ['one object', [utf8('abc')]],
  ['four objects, one empty', [utf8('manifest'), new Uint8Array(0), utf8('\0asm'), fill(7, 300)]],
  ...[0, 1, 63, 64, 65, 1023, 1024, 1025, 2048, 3000].map((n) => [`one object of ${n} bytes`, [fill(0xa5, n)]]),
];

const document = {
  schema: 'prismpm/holo-v6-container-vectors/1',
  note: 'Holo v6 (ADR-018): UORC format 2 profile 2, sealed by plain BLAKE3 of every byte before the seal. Written by sdk/npm/prism-code/scripts/holo-v6-vectors.mjs.',
  cases: cases.map(([name, objects]) => {
    const archive = writeObjects(objects, 6);
    return { name, objects: objects.map(hex), archive: hex(archive), seal: hex(archive.subarray(archive.length - 32)), label: labelOf(6, archive) };
  }),
};
const text = `${JSON.stringify(document, null, 1)}\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) {
    console.error('tests/data/holo-v6-container.json is not what this script writes. Run: node scripts/holo-v6-vectors.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
  console.log(`wrote ${document.cases.length} cases`);
}
