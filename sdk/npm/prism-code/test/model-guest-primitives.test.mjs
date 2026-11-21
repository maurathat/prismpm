// Every primitive the evaluator guest runs, held to the reference evaluator (src/journey/model-eval.mjs) at the
// edges of every type. No committed model uses fixed-width arithmetic, bit operations or UTF-8, so the cases are made
// here: for each, the reference computes the answer, and a program asks the guest whether its own answer equals it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRIMITIVES, modelProgram } from '../src/journey/model-eval.mjs';
import { EVALUATOR_GUEST, GUEST_PRIMITIVES, admitEvaluator, encodeProgram, linkGuest } from '../src/journey/model-guest.mjs';
import { compileGuest, runGuest } from '../src/core.mjs';

const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const skip = !existsSync(fileURLToPath(new URL('loan-snapshot.json', models))) && 'no lean-prover package beside this one';
const base = () => JSON.parse(readFileSync(new URL('loan-snapshot.json', models), 'utf8'));
const evaluator = admitEvaluator(readFileSync(new URL(`../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url)));
const dec = new TextDecoder();

// ---- Terms, as a snapshot writes them.
const T = (kind) => ({ kind });
const option = (type) => ({ kind: 'option', value: type });
const number = (type, value) => (type.kind === 'nat' ? { kind: 'nat', value: String(value) } : { kind: 'integer', representation: type.kind, value: String(value) });
const bytes = (...b) => ({ kind: 'bytes', hex: b.map((x) => x.toString(16).padStart(2, '0')).join('') });
const text = (value) => ({ kind: 'string', value });
const natList = (...items) => items.reduceRight((tail, head) => ({ kind: 'cons', head: number(T('nat'), head), tail }), { kind: 'nil', element: T('nat') });
const prim = (operation, args, result) => ({ kind: 'primitive', operation, arguments: args, result });

/** A value the reference computed, written as the term that makes it, at the type the primitive answers with. */
function termOf(value, type) {
  if (typeof value === 'bigint') return number(type, value);
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (typeof value === 'string') return text(value);
  if (value instanceof Uint8Array) return bytes(...value);
  if (value.c === 'Option.none') return { kind: 'constructor', constructor: { name: 'Option.none' }, arguments: [] };
  if (value.c === 'Option.some') return { kind: 'constructor', constructor: { name: 'Option.some' }, arguments: [termOf(value.a[0], type.value ?? type)] };
  if (value.c === 'List.nil') return { kind: 'nil', element: T('nat') };
  if (value.c === 'List.cons') return { kind: 'cons', head: termOf(value.a[0], T('nat')), tail: termOf(value.a[1], type) };
  return { kind: 'constructor', constructor: { name: value.c }, arguments: [] };
}

/** The reference's value of a closed term. */
function valueOf(term) {
  switch (term.kind) {
    case 'nat': case 'integer': return BigInt(term.value);
    case 'bytes': return Uint8Array.from(term.hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    case 'string': return term.value;
    case 'bool': return term.value;
    case 'nil': return { c: 'List.nil', a: [] };
    case 'cons': return { c: 'List.cons', a: [valueOf(term.head), valueOf(term.tail)] };
    default: throw new Error(`no value for ${term.kind}`);
  }
}

/** One case: a primitive on closed arguments, and the term for what the reference answers. `wrong` plants another answer. */
function check(operation, args, result) {
  const expected = PRIMITIVES[operation](args.map(valueOf), result);
  return { kind: 'primitive', operation: 'equal', arguments: [prim(operation, args, result), termOf(expected, result)], result: T('bool') };
}

/** A model whose entry answers `y` when every case holds, `n` otherwise. */
function modelOf(cases) {
  const snapshot = base();
  const entry = snapshot.modules.find((m) => m.name === 'LoanApproval').semantic.declarations.find((d) => d.name === 'dispatch');
  const all = cases.reduce((left, right) => ({ kind: 'and', left, right }));
  entry.body = { kind: 'if', condition: all, then_value: bytes(0x79), else_value: bytes(0x6e) };
  return snapshot;
}

async function answers(cases) {
  const snapshot = modelOf(cases);
  const guest = await compileGuest(linkGuest(evaluator, encodeProgram(snapshot).bytes));
  return { guest: dec.decode(runGuest(guest, new Uint8Array())), reference: dec.decode(modelProgram(snapshot).dispatch(new Uint8Array())) };
}

const WIDTHS = [['uint8', 8n, false], ['uint16', 16n, false], ['uint32', 32n, false], ['uint64', 64n, false], ['int8', 8n, true], ['int16', 16n, true], ['int32', 32n, true], ['int64', 64n, true]];
const edges = (bits, signed) => {
  const least = signed ? -(1n << (bits - 1n)) : 0n;
  const greatest = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
  return [...new Set([least, least + 1n, -1n, 0n, 1n, 2n, 7n, greatest / 2n, greatest - 1n, greatest])].filter((v) => v >= least && v <= greatest);
};
let total = 0;

for (const [kind, bits, signed] of WIDTHS) {
  test(`${kind}: wrapping, checked and bitwise arithmetic and shifts are the reference's, at the type's edges`, { skip }, async () => {
    const type = T(kind);
    const values = edges(bits, signed);
    const cases = [];
    for (const a of values) {
      for (const b of values) {
        for (const operation of ['subtract', 'multiply', 'bit_and', 'bit_or', 'bit_xor']) cases.push(check(operation, [number(type, a), number(type, b)], type));
        for (const operation of ['checked_add', 'checked_subtract', 'checked_multiply', 'checked_quotient']) cases.push(check(operation, [number(type, a), number(type, b)], option(type)));
      }
      cases.push(check('negate', [number(type, a)], type), check('bit_not', [number(type, a)], type), check('checked_negate', [number(type, a)], option(type)));
      cases.push(check('to_int', [number(type, a)], T('int')));
      for (const amount of [0n, 1n, bits - 1n, bits, bits + 1n, 200n]) for (const operation of ['shift_left', 'shift_right']) cases.push(check(operation, [number(type, a), number(T('uint32'), amount)], option(type)));
    }
    for (const wide of [-(1n << 70n), -(1n << 63n) - 1n, -129n, -128n, -1n, 0n, 255n, 256n, 65535n, 65536n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, 1n << 64n]) cases.push(check('checked_convert', [number(T('int'), wide)], option(type)));
    total += cases.length;
    assert.deepEqual(await answers(cases), { guest: 'y', reference: 'y' }, `${cases.length} cases`);
  });
}

test('Nat and Int: subtraction, multiplication, negation, quotient and remainder are the reference\'s', { skip }, async () => {
  const cases = [];
  // Within 127 bits, which is what the guest holds: the test below covers what lies beyond.
  const nats = [0n, 1n, 2n, 7n, 10n, 255n, 1n << 40n, (1n << 62n) + 3n];
  const ints = [-(1n << 62n) - 3n, -7n, -2n, -1n, 0n, 1n, 2n, 7n, (1n << 62n) + 3n];
  for (const a of nats) for (const b of nats) {
    for (const operation of ['subtract', 'multiply']) cases.push(check(operation, [number(T('nat'), a), number(T('nat'), b)], T('nat')));
    for (const operation of ['quotient', 'remainder']) cases.push(check(operation, [number(T('nat'), a), number(T('nat'), b), number(T('nat'), 9)], T('nat')));
  }
  for (const a of ints) for (const b of ints) {
    for (const operation of ['subtract', 'multiply']) cases.push(check(operation, [number(T('int'), a), number(T('int'), b)], T('int')));
    for (const operation of ['quotient', 'remainder']) cases.push(check(operation, [number(T('int'), a), number(T('int'), b), number(T('int'), -9)], T('int')));
  }
  for (const a of ints) cases.push(check('negate', [number(T('int'), a)], T('int')));
  total += cases.length;
  assert.deepEqual(await answers(cases), { guest: 'y', reference: 'y' }, `${cases.length} cases`);
});

test('bytes, lists and text: append, length, index, slice, compare and UTF-8 are the reference\'s', { skip }, async () => {
  const cases = [];
  const blobs = [bytes(), bytes(0), bytes(1, 2, 3), bytes(1, 2, 4), bytes(0xff), bytes(0x68, 0x69), bytes(0xc3, 0xa9), bytes(0xc3), bytes(0xed, 0xa0, 0x80), bytes(0xf0, 0x9f, 0x98, 0x80)];
  const lists = [natList(), natList(5), natList(1, 2, 3), natList(9, 8, 7, 6)];
  const spans = [[0n, 0n], [0n, 1n], [1n, 2n], [3n, 0n], [2n, 2n], [0n, 4n], [4n, 1n], [1n << 40n, 1n]];
  for (const a of blobs) {
    cases.push(check('length', [a], T('nat')), check('utf8_decode', [a], option(T('string'))));
    for (const b of blobs) cases.push(check('append', [a, b], T('bytes')), check('compare_bytes', [a, b], T('ordering')), check('equal', [a, b], T('bool')));
    for (const i of [0n, 1n, 2n, 3n, 1n << 40n]) cases.push(check('index', [a, number(T('nat'), i)], option(T('uint8'))));
    for (const [start, count] of spans) cases.push(check('slice', [a, number(T('nat'), start), number(T('nat'), count)], option(T('bytes'))));
  }
  for (const a of lists) {
    cases.push(check('length', [a], T('nat')));
    for (const b of lists) cases.push(check('append', [a, b], { kind: 'list', element: T('nat') }), check('equal', [a, b], T('bool')));
    for (const i of [0n, 1n, 3n, 4n]) cases.push(check('index', [a, number(T('nat'), i)], option(T('nat'))));
    for (const [start, count] of spans) cases.push(check('slice', [a, number(T('nat'), start), number(T('nat'), count)], option({ kind: 'list', element: T('nat') })));
  }
  for (const s of ['', 'a', 'hé', 'a\u{1F600}b', '中文']) cases.push(check('length', [text(s)], T('nat')), check('utf8_encode', [text(s)], T('bytes')));
  total += cases.length;
  assert.deepEqual(await answers(cases), { guest: 'y', reference: 'y' }, `${cases.length} cases`);
});

test('a number past 127 bits is never a wrong answer: a literal is refused by name, and a result traps', { skip }, async () => {
  const big = number(T('nat'), 1n << 100n);
  // The product is 2^200: the reference holds it, the guest does not.
  const overflow = { kind: 'primitive', operation: 'equal', arguments: [prim('multiply', [big, big], T('nat')), number(T('nat'), 0)], result: T('bool') };
  const snapshot = modelOf([overflow, overflow]);
  assert.equal(dec.decode(modelProgram(snapshot).dispatch(new Uint8Array())), 'n');
  const guest = await compileGuest(linkGuest(evaluator, encodeProgram(snapshot).bytes));
  assert.throws(() => runGuest(guest, new Uint8Array()), /unreachable/);
  const literal = check('subtract', [number(T('nat'), 1n << 130n), number(T('nat'), 1)], T('nat'));
  assert.throws(() => encodeProgram(modelOf([literal, literal])), (e) => e.code === 'guest.uncovered' && /outside what the evaluator guest holds/.test(e.message));
});

test('planted defect: one case with another answer is seen by the guest and by the reference alike', { skip }, async () => {
  const right = check('checked_add', [number(T('uint8'), 250), number(T('uint8'), 5)], option(T('uint8')));
  const wrong = JSON.parse(JSON.stringify(right));
  wrong.arguments[1].arguments[0].value = '254';
  assert.deepEqual(await answers([right, right]), { guest: 'y', reference: 'y' });
  assert.deepEqual(await answers([right, wrong]), { guest: 'n', reference: 'n' });
});

test('the guest runs every primitive the reference evaluator runs, and the cases above reach each of them', { skip }, () => {
  assert.deepEqual(Object.keys(GUEST_PRIMITIVES).sort(), Object.keys(PRIMITIVES).sort());
  assert.ok(total > 3000, `${total} cases were compared`);
});
