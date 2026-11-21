// The reference evaluator (src/journey/model-eval.mjs): a model's semantic snapshot run as it stands. The snapshots
// are the ones the lean-prover package keeps for the kernel path: a decision app (loan) and a stateful app (seat).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ModelEvalRefused, PRIMITIVES, modelProgram } from '../src/journey/model-eval.mjs';

const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const here = existsSync(fileURLToPath(new URL('loan-snapshot.json', models)));
const skip = !here && 'no lean-prover package beside this one';
const snapshot = (name) => JSON.parse(readFileSync(new URL(`${name}-snapshot.json`, models), 'utf8'));
const enc = new TextEncoder();
const dec = new TextDecoder();
const option = (kind) => ({ kind: 'option', value: { kind } });
const some = (v) => ({ c: 'Option.some', a: [v] });
const none = { c: 'Option.none', a: [] };

test('a decision app answers every one of its own acceptance vectors from its snapshot', { skip }, () => {
  const program = modelProgram(snapshot('loan'));
  assert.deepEqual(program.uncovered, []);
  assert.equal(program.entry, 'LoanApproval::dispatch');
  assert.equal(program.application.coreContract, 'hologram:guest/core-wasm@1');
  const result = program.acceptance();
  assert.equal(result.total, 27);
  assert.deepEqual(result.failed, []);
});

test('a stateful app does too, a thousand-byte session included', { skip }, () => {
  const program = modelProgram(snapshot('seat'));
  assert.deepEqual(program.uncovered, []);
  const result = program.acceptance();
  assert.equal(result.total, 37);
  assert.deepEqual(result.failed, []);
  assert.ok(program.application.acceptanceVectors.some((v) => v.request.length >= 1000), 'the long session is among the vectors');
});

test('bytes that are no request are answered as the model answers them, not thrown', { skip }, () => {
  const program = modelProgram(snapshot('loan'));
  for (const request of [new Uint8Array(), Uint8Array.of(0xff), enc.encode('x'.repeat(500))]) assert.equal(dec.decode(program.dispatch(request)), 'invalid');
});

test('planted defect: a primitive that answers otherwise fails the vectors', { skip }, () => {
  // Nat subtraction that is one short: the field parser's lengths go wrong.
  const wrong = { ...PRIMITIVES, subtract: (a) => (a[0] > a[1] ? a[0] - a[1] - 1n : 0n) };
  const result = modelProgram(snapshot('loan'), { primitives: wrong }).acceptance();
  assert.ok(result.failed.length > 0, 'a wrong primitive is seen by the vectors');
});

test('planted defect: a changed constant in the snapshot fails the vectors', { skip }, () => {
  const changed = JSON.parse(JSON.stringify(snapshot('loan')));
  const app = changed.modules.find((m) => m.name === 'LoanApproval');
  const constant = app.semantic.declarations.find((d) => d.kind === 'definition' && d.parameters.length === 0 && d.body.kind === 'nat' && d.name.startsWith('answer'));
  constant.body.value = String(BigInt(constant.body.value) + 1n);
  assert.ok(modelProgram(changed).acceptance().failed.length > 0);
});

test('a construct not covered is refused by name before anything runs', { skip }, () => {
  const changed = JSON.parse(JSON.stringify(snapshot('loan')));
  const entry = changed.modules.find((m) => m.name === 'LoanApproval').semantic.declarations.find((d) => d.name === 'dispatch');
  entry.body = { kind: 'if', condition: { kind: 'bool', value: false }, then_value: { kind: 'primitive', operation: 'map_lookup', arguments: [], result: { kind: 'bytes' } }, else_value: entry.body };
  const program = modelProgram(changed);
  assert.deepEqual(program.uncovered, ['primitive map_lookup']);
  assert.throws(() => program.dispatch(new Uint8Array()), (e) => e instanceof ModelEvalRefused && e.code === 'eval.uncovered' && /map_lookup/.test(e.message));
  assert.throws(() => program.acceptance(), (e) => e.code === 'eval.uncovered');
});

test('a request that takes too many steps is stopped, and anything but a snapshot is refused', { skip }, () => {
  // Enough steps to read the application record, too few for the thousand-byte session.
  const program = modelProgram(snapshot('seat'), { stepLimit: 5000 });
  const long = program.application.acceptanceVectors.find((v) => v.request.length >= 1000);
  assert.throws(() => program.dispatch(long.request), (e) => e.code === 'eval.steps');
  assert.throws(() => modelProgram({ spec: 'lexlean/semantic-snapshot/1', modules: [] }), (e) => e.code === 'eval.snapshot');
});

test('each primitive follows the Lean definition the runtime gives it', () => {
  const P = PRIMITIVES;
  const bytes = (...b) => Uint8Array.from(b);
  // Nat.sub stops at zero; Int does not; a fixed width wraps.
  assert.equal(P.subtract([3n, 5n], { kind: 'nat' }), 0n);
  assert.equal(P.subtract([3n, 5n], { kind: 'int' }), -2n);
  assert.equal(P.subtract([3n, 5n], { kind: 'uint8' }), 254n);
  assert.equal(P.multiply([200n, 2n], { kind: 'uint8' }), 144n);
  assert.equal(P.negate([-128n], { kind: 'int8' }), -128n);
  // quotient and remainder: the stated zero case on a zero divisor; Int rounds toward zero.
  assert.equal(P.quotient([7n, 0n, 9n], { kind: 'nat' }), 9n);
  assert.equal(P.quotient([-7n, 2n, 0n], { kind: 'int' }), -3n);
  assert.equal(P.remainder([-7n, 2n, 0n], { kind: 'int' }), -1n);
  // Checked arithmetic answers none outside the type.
  assert.deepEqual(P.checked_add([250n, 5n], option('uint8')), some(255n));
  assert.deepEqual(P.checked_add([250n, 6n], option('uint8')), none);
  assert.deepEqual(P.checked_negate([-128n], option('int8')), none);
  assert.deepEqual(P.checked_quotient([1n, 0n], option('int64')), none);
  assert.deepEqual(P.checked_convert([300n], option('uint8')), none);
  // Shifts refuse the width or more.
  assert.deepEqual(P.shift_left([1n, 7n], option('uint8')), some(128n));
  assert.deepEqual(P.shift_left([1n, 8n], option('uint8')), none);
  assert.equal(P.bit_not([0n], { kind: 'uint8' }), 255n);
  // Bytes: index past the end is none; a slice needs start + count <= size.
  assert.deepEqual(P.index([bytes(7, 8), 1n]), some(8n));
  assert.deepEqual(P.index([bytes(7, 8), 2n]), none);
  assert.deepEqual(P.slice([bytes(1, 2, 3), 1n, 2n]), some(bytes(2, 3)));
  assert.deepEqual(P.slice([bytes(1, 2, 3), 3n, 0n]), some(bytes()));
  assert.deepEqual(P.slice([bytes(1, 2, 3), 2n, 2n]), none);
  assert.deepEqual(P.append([bytes(1), bytes(2)]), bytes(1, 2));
  assert.equal(P.length([bytes(1, 2, 3)]), 3n);
  assert.equal(P.length(['a\u{1F600}']), 2n);
  // compare: the first byte that differs, then the shorter first.
  assert.equal(P.compare_bytes([bytes(1, 2), bytes(1, 3)]).c, 'Ordering.lt');
  assert.equal(P.compare_bytes([bytes(1, 2), bytes(1)]).c, 'Ordering.gt');
  assert.equal(P.compare_bytes([bytes(), bytes()]).c, 'Ordering.eq');
  assert.deepEqual(P.utf8_decode([bytes(0xff)]), none);
  assert.deepEqual(P.utf8_decode([bytes(0x68, 0x69)]), some('hi'));
  assert.equal(P.equal([bytes(1), bytes(1)]), true);
});

test('the evaluator imports nothing, so a browser runs it', () => {
  const text = readFileSync(new URL('../src/journey/model-eval.mjs', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(text) && !/\brequire\(/.test(text) && !/\bprocess\./.test(text));
});
