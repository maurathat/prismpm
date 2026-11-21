// An app's guest with nothing compiled (src/journey/model-guest.mjs): the pinned evaluator guest and the app's
// program, attached as data, held to the reference evaluator on the app's own vectors and requests made from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRIMITIVES, modelProgram } from '../src/journey/model-eval.mjs';
import { EVALUATOR_GUEST, admitEvaluator, encodeProgram, guestAgrees, linkGuest, requestsFrom } from '../src/journey/model-guest.mjs';
import { compileGuest, runGuest } from '../src/core.mjs';

const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const here = existsSync(fileURLToPath(new URL('loan-snapshot.json', models)));
const skip = !here && 'no lean-prover package beside this one';
const snapshot = (name) => JSON.parse(readFileSync(new URL(`${name}-snapshot.json`, models), 'utf8'));
const evaluator = () => admitEvaluator(readFileSync(new URL(`../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url)));
const guestOf = async (snap) => {
  const bytes = linkGuest(evaluator(), encodeProgram(snap).bytes);
  const module = await compileGuest(bytes);
  return { bytes, module, run: (request) => runGuest(module, request) };
};

test('the evaluator guest the package carries is the pinned one, and one changed byte is refused', () => {
  const bytes = evaluator();
  assert.equal(bytes.length, EVALUATOR_GUEST.bytes);
  const changed = bytes.slice();
  changed[changed.length - 1] ^= 1;
  assert.throws(() => admitEvaluator(changed), (e) => e.code === 'guest.evaluator');
  assert.throws(() => admitEvaluator(bytes.subarray(1)), (e) => e.code === 'guest.evaluator');
});

test('a linked guest is a Core-Wasm guest: no imports, and exactly memory, holo_alloc and holo_run', { skip }, async () => {
  const { bytes } = await guestOf(snapshot('loan'));
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.deepEqual(WebAssembly.Module.exports(module).map((e) => e.name).sort(), ['holo_alloc', 'holo_run', 'memory']);
});

for (const name of ['loan', 'seat']) {
  test(`${name}: the guest answers as the reference evaluator does, on its vectors and on requests made from them`, { skip }, async () => {
    const snap = snapshot(name);
    const { run } = await guestOf(snap);
    const result = await guestAgrees(snap, run);
    assert.ok(result.total > 500, `${result.total} requests`);
    assert.deepEqual(result.differ, []);
  });
}

test('the same model gives the same guest bytes, and another model other bytes', { skip }, async () => {
  const a = linkGuest(evaluator(), encodeProgram(snapshot('loan')).bytes);
  const b = linkGuest(evaluator(), encodeProgram(snapshot('loan')).bytes);
  const c = linkGuest(evaluator(), encodeProgram(snapshot('seat')).bytes);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('planted defect: one changed word of the program is seen', { skip }, async () => {
  const snap = snapshot('loan');
  const program = encodeProgram(snap).bytes;
  const view = new DataView(program.buffer);
  // The first constant the pool holds: every number of the model is read from there.
  const pool = view.getUint32(24, true);
  let seen = 0;
  for (let at = pool; at < program.length && seen === 0; at += 1) {
    const changed = program.slice();
    changed[at] ^= 0x01;
    const module = await compileGuest(linkGuest(evaluator(), changed));
    const result = await guestAgrees(snap, (request) => runGuest(module, request));
    seen += result.differ.length;
    if (at - pool > 64) break;
  }
  assert.ok(seen > 0, 'a changed constant changes an answer');
});

test('planted defect: a reference that answers otherwise is seen too, so the comparison is not vacuous', { skip }, async () => {
  const snap = snapshot('loan');
  const { run } = await guestOf(snap);
  const requests = requestsFrom(modelProgram(snap).application.acceptanceVectors);
  // The guest stands in for a wrong one: compare it with a reference whose subtraction is one short.
  const wrong = modelProgram(snap, { primitives: { ...PRIMITIVES, subtract: (a) => (a[0] > a[1] ? a[0] - a[1] - 1n : 0n) } });
  let differ = 0;
  for (const request of requests) {
    const got = run(request);
    const expected = wrong.dispatch(request);
    if (got.length !== expected.length || got.some((x, i) => x !== expected[i])) differ += 1;
  }
  assert.ok(differ > 0);
});

test('a model that uses what the guest does not run is refused by name, before any guest exists', { skip }, () => {
  const changed = JSON.parse(JSON.stringify(snapshot('loan')));
  const entry = changed.modules.find((m) => m.name === 'LoanApproval').semantic.declarations.find((d) => d.name === 'dispatch');
  entry.body = { kind: 'if', condition: { kind: 'bool', value: true }, then_value: entry.body, else_value: { kind: 'primitive', operation: 'map_lookup', arguments: [], result: { kind: 'bytes' } } };
  assert.throws(() => encodeProgram(changed), (e) => e.code === 'guest.uncovered' && /map_lookup/.test(e.message));
});

test('the linker refuses what is not the evaluator guest', { skip }, async () => {
  const program = encodeProgram(snapshot('loan')).bytes;
  assert.throws(() => linkGuest(new Uint8Array([1, 2, 3]), program), (e) => e.code === 'guest.evaluator');
  // A linked guest no longer says where its heap begins, so it cannot be linked again.
  assert.throws(() => linkGuest(linkGuest(evaluator(), program), program), (e) => e.code === 'guest.evaluator' && /__heap_base/.test(e.message));
});

test('the encoder and linker import nothing of Node, so a browser runs them', () => {
  const text = readFileSync(new URL('../src/journey/model-guest.mjs', import.meta.url), 'utf8');
  assert.ok(!/from 'node:/.test(text) && !/\brequire\(/.test(text) && !/\bprocess\./.test(text) && !/\bBuffer\b/.test(text));
});
