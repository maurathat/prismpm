// `pushHolo` (src/push-core.mjs): the push a page can make. It is `experimental_push`'s own steps, so what it puts
// in a registry is what `experimental_push` puts there; and nothing it loads is Node's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReferenceInvalidError, VerificationError } from '../src/errors.mjs';
import { parseReference } from '../src/oci-reference.mjs';
import { createRegistryClient } from '../src/oci-registry.mjs';
import { pushHolo, PUSH_SCHEMA } from '../src/push-core.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';
import { startRegistry } from './support/registry.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const plain = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const carrying = new Uint8Array(readFileSync(new URL('./fixtures/attestation/Calculator.v5.signed.holo', import.meta.url)));

/** Every module `entry` loads, by the names it imports and re-exports, followed to the end. */
function graphOf(entry) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      const name = m[1] ?? m[2];
      if (name.startsWith('.')) visit(resolve(dirname(file), name));
      else seen.set(`${file} -> ${name}`, null);
    }
  };
  visit(entry);
  return seen;
}

test('push-core loads nothing of Node, so a page can load it', () => {
  const graph = graphOf(resolve(src, 'push-core.mjs'));
  const outside = [...graph.keys()].filter((key) => key.includes(' -> '));
  assert.deepEqual(outside, [], 'push-core.mjs reaches a module that is not a file of this package');
  for (const [file, text] of graph) {
    assert.equal(/\bprocess\.(?:env|argv|cwd|platform)\b/.test(text), false, `${file} reads the process`);
    assert.equal(/\bimport\(\s*['"]node:/.test(text), false, `${file} imports a node: module while running`);
  }
  // The registry client a page pairs it with is as clean.
  assert.deepEqual([...graphOf(resolve(src, 'oci-registry.mjs')).keys()].filter((key) => key.includes(' -> ')), []);
});

test('pushHolo puts in a registry what experimental_push puts there', async (t) => {
  const first = await startRegistry();
  const second = await startRegistry();
  t.after(() => Promise.all([first.close(), second.close()]));

  const viaCommand = await experimental_push(carrying, `${first.host}/app:1`, { plainHttp: true });
  const reference = parseReference(`${second.host}/app:1`);
  const events = [];
  const viaCore = await pushHolo(carrying, createRegistryClient(reference, { plainHttp: true }), { reference, onProgress: (event) => events.push(event.action) });

  assert.equal(viaCore.schema, PUSH_SCHEMA);
  for (const field of ['digest', 'mediaType', 'size', 'fingerprint', 'sha256', 'blake3', 'tag', 'tags']) assert.deepEqual(viaCore[field], viaCommand[field], field);
  assert.deepEqual(viaCore.layer, viaCommand.layer);
  assert.deepEqual(viaCore.referrers, viaCommand.referrers);
  assert.equal(viaCore.referrers.length > 0, true, 'the holo carries attestations, and they went with it');
  assert.equal(events[0], 'Pushed');

  // What is there pulls back whole, judged by pull's own checks.
  const pulled = await experimental_pull(`${second.host}/app:1`, { plainHttp: true }).catch((error) => error);
  if (pulled instanceof Error) assert.fail(`the pushed holo did not pull back: ${pulled.message}`);
  assert.equal(pulled.digest, viaCore.digest);
});

test('pushHolo opens its endpoint only after the holo has been judged, and refuses what push refuses', async () => {
  const reference = parseReference('registry.example/app:1');
  let opened = 0;
  const never = () => { opened++; throw new Error('the endpoint was opened'); };
  const broken = plain.slice();
  broken[broken.length - 9] ^= 1;
  await assert.rejects(() => pushHolo(broken, never, { reference }), (error) => error instanceof VerificationError || /footer|label|holo/i.test(error.message));
  assert.equal(opened, 0, 'a holo that does not verify reaches no endpoint');
  await assert.rejects(() => pushHolo(plain, never, { reference: { ...reference, fingerprint: 'blake3:' + '0'.repeat(64) } }), ReferenceInvalidError);
  assert.equal(opened, 0);
});
