/**
 * An app's guest with nothing compiled: the evaluator guest (`guest/evaluator`, one fixed Core-Wasm module built
 * once) and the app's program, attached to it as data.
 *
 * `encodeProgram` writes the program from the model's semantic snapshot: what the entry reaches, as a table of
 * four-word nodes the evaluator reads in place. `linkGuest` attaches it: one data segment at the module's
 * `__heap_base`, the memory grown to hold it, and every export but the contract's three removed. Both are pure
 * functions of their inputs, so the same model gives the same guest bytes on every machine.
 *
 * The guest is held to the reference evaluator (model-eval.mjs) by `guestAgrees`: the app's own vectors, and
 * requests made from them, answered by both. That is tested, not proved.
 *
 * This file imports only model-eval.mjs and the package's BLAKE3, so a browser and a worker run it as Node does.
 */
import { ModelEvalRefused, modelProgram } from './model-eval.mjs';
import { kappa } from '../blake3.mjs';

/**
 * The pinned evaluator guest, `guest/evaluator.wasm` beside this file: built from `guest/evaluator` (the package's
 * root) by `cargo build --release` with rustc 1.97.1, for `wasm32-unknown-unknown`. Two builds from different
 * folders on one machine gave these bytes; a build on another system has not been compared.
 */
export const EVALUATOR_GUEST = Object.freeze({
  file: 'guest/evaluator.wasm',
  kappa: 'blake3:1c7808481594cd3ed3966f6a6096a9ccc5a565c990b45365d3b8f43e276e30bc',
  bytes: 22709,
  rustc: '1.97.1',
});

/** The evaluator guest's bytes, admitted only when they have the pinned κ-label. Throws `guest.evaluator`. */
export function admitEvaluator(bytes, pin = EVALUATOR_GUEST) {
  const given = new Uint8Array(bytes);
  if (given.length !== pin.bytes || kappa(given) !== pin.kappa) throw new ModelEvalRefused('guest.evaluator', 'the evaluator guest is not the pinned one');
  return given;
}

export const PROGRAM_MAGIC = 0x31564550; // "PEV1", as the evaluator reads it
const KIND = Object.freeze({ var: 0, num: 1, bytes: 2, string: 3, bool: 4, unit: 5, constructor: 6, record: 7, project: 8, call: 9, if: 10, let: 11, match: 12, and: 13, or: 14, not: 15, add: 16, beq: 17, ble: 18, blt: 19, primitive: 20, first: 21, second: 22 });
const TAG = Object.freeze({ 'Option.none': 0, 'Option.some': 1, 'List.nil': 2, 'List.cons': 3, 'Nat.zero': 4, 'Nat.succ': 5, 'Bool.false': 6, 'Bool.true': 7, 'Ordering.lt': 8, 'Ordering.eq': 9, 'Ordering.gt': 10, 'Prod.mk': 11 });
const FIRST_OWN_TAG = 32;
/** The primitives the evaluator guest runs, and the result types its arithmetic is exact at. */
export const GUEST_PRIMITIVES = Object.freeze({ subtract: 0, multiply: 1, quotient: 2, remainder: 3, to_nat: 4, to_int: 5, equal: 6, append: 7, length: 8, index: 9, slice: 10, compare_bytes: 11, negate: 12, checked_add: 13, checked_subtract: 14, checked_multiply: 15, checked_negate: 16, checked_quotient: 17, checked_convert: 18, bit_and: 19, bit_or: 20, bit_xor: 21, bit_not: 22, shift_left: 23, shift_right: 24, utf8_encode: 25, utf8_decode: 26 });
/** The result types the guest computes at, as the program names them. */
const RESULT = Object.freeze({ nat: 0, int: 1, uint8: 2, uint16: 3, uint32: 4, uint64: 5, int8: 6, int16: 7, int32: 8, int64: 9 });
const FIXED_ONLY = new Set(['checked_add', 'checked_subtract', 'checked_multiply', 'checked_negate', 'checked_quotient', 'checked_convert', 'bit_and', 'bit_or', 'bit_xor', 'bit_not', 'shift_left', 'shift_right']);
const OPTIONAL = new Set(['checked_add', 'checked_subtract', 'checked_multiply', 'checked_negate', 'checked_quotient', 'checked_convert', 'shift_left', 'shift_right']);
/** The type a primitive computes at: its result, or what its optional result holds. Null when the guest has no such type for it. */
const resultKind = (t) => {
  const kind = (OPTIONAL.has(t.operation) ? (t.result.element ?? t.result.value ?? t.result.argument) : t.result)?.kind;
  if (FIXED_ONLY.has(t.operation)) return RESULT[kind] >= 2 ? kind : null;
  if (t.operation === 'quotient' || t.operation === 'remainder') return kind === 'nat' || kind === 'int' ? kind : null;
  if (t.operation === 'subtract' || t.operation === 'multiply' || t.operation === 'negate') return RESULT[kind] === undefined ? null : kind;
  return 'nat';
};
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;

const refuse = (code, message) => { throw new ModelEvalRefused(code, message); };

/**
 * The program of a model: the bytes the evaluator guest runs. Refuses (`guest.uncovered`), by name, a model that
 * uses what the guest does not run. Returns `{ bytes, functions, nodes }`.
 */
export function encodeProgram(snapshot) {
  const program = modelProgram(snapshot);
  if (program.uncovered.length) refuse('guest.uncovered', `the model uses ${program.uncovered.join(', ')}, which is not run yet`);
  const { declared, resolve, constructorName } = program.reach;

  // The definitions the entry reaches, the entry first, in the order they are first called.
  const order = [program.entry];
  const indexOf = new Map([[program.entry, 0]]);
  const uncovered = new Set();
  const visit = (t, here) => {
    if (Array.isArray(t)) { for (const x of t) visit(x, here); return; }
    if (t === null || typeof t !== 'object') return;
    if (t.kind === 'call') {
      const name = resolve(here, t.function);
      if (!indexOf.has(name)) { indexOf.set(name, order.length); order.push(name); }
    }
    if (t.kind === 'primitive') {
      if (GUEST_PRIMITIVES[t.operation] === undefined) uncovered.add(`primitive ${t.operation}`);
      else if (resultKind(t) === null) uncovered.add(`primitive ${t.operation} at ${t.result.kind}`);
    }
    for (const value of Object.values(t)) if (value && typeof value === 'object') visit(value, here);
  };
  for (let i = 0; i < order.length; i += 1) { const at = declared.get(order[i]); visit(at.d.body, at.module); }
  if (uncovered.size) refuse('guest.uncovered', `the model uses ${[...uncovered].sort().join(', ')}, which the evaluator guest does not run yet`);

  const HEADER = 8;
  const auxBase = HEADER + 3 * order.length;
  const aux = [];
  const nodes = [];
  const pool = [];
  const pooled = new Map();
  const fields = new Map();
  const tags = new Map();
  const fieldId = (name) => { if (!fields.has(name)) fields.set(name, fields.size); return fields.get(name); };
  const tagOf = (name) => {
    if (TAG[name] !== undefined) return TAG[name];
    if (!tags.has(name)) tags.set(name, FIRST_OWN_TAG + tags.size);
    return tags.get(name);
  };
  const keep = (bytes) => {
    const key = bytes.join(',');
    if (!pooled.has(key)) { pooled.set(key, pool.length); pool.push(...bytes); }
    return pooled.get(key);
  };
  const list = (words) => { const at = auxBase + aux.length; aux.push(...words); return at; };
  const emit = (kind, x = 0, y = 0, z = 0) => { nodes.push([kind, x, y, z]); return nodes.length - 1; };
  const number = (text) => {
    const value = BigInt(text);
    if (value < I128_MIN || value > I128_MAX) refuse('guest.uncovered', `the number ${text} is outside what the evaluator guest holds`);
    const raw = BigInt.asUintN(128, value);
    return emit(KIND.num, keep(Array.from({ length: 16 }, (_, i) => Number((raw >> BigInt(8 * i)) & 0xffn))));
  };

  const functions = order.map((name) => {
    const { d, module: here } = declared.get(name);
    let slots = d.parameters.length;
    const compile = (t, env) => {
      const go = (x) => compile(x, env);
      switch (t.kind) {
        case 'var': return env.has(t.name) ? emit(KIND.var, env.get(t.name)) : refuse('guest.program', `${name} uses ${t.name}, which it does not bind`);
        case 'nat': case 'integer': return number(t.value);
        case 'bytes': { const bytes = t.hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []; return emit(KIND.bytes, keep(bytes), bytes.length); }
        case 'string': { const bytes = [...new TextEncoder().encode(t.value)]; return emit(KIND.string, keep(bytes), bytes.length); }
        case 'bool': return emit(KIND.bool, t.value ? 1 : 0);
        case 'unit': return emit(KIND.unit);
        case 'nil': return emit(KIND.constructor, TAG['List.nil'], list([]), 0);
        case 'cons': { const parts = [go(t.head), go(t.tail)]; return emit(KIND.constructor, TAG['List.cons'], list(parts), 2); }
        case 'pair': { const parts = [go(t.left), go(t.right)]; return emit(KIND.constructor, TAG['Prod.mk'], list(parts), 2); }
        case 'first': return emit(KIND.first, go(t.value));
        case 'second': return emit(KIND.second, go(t.value));
        case 'constructor': { const parts = t.arguments.map(go); return emit(KIND.constructor, tagOf(constructorName(here, t.constructor)), list(parts), parts.length); }
        case 'record': { const pairs = t.fields.flatMap((f) => [fieldId(f.field), go(f.value)]); return emit(KIND.record, list(pairs), t.fields.length); }
        case 'project': return emit(KIND.project, fieldId(t.field), go(t.value));
        case 'call': { const parts = t.arguments.map(go); return emit(KIND.call, indexOf.get(resolve(here, t.function)), list(parts), parts.length); }
        case 'if': return emit(KIND.if, go(t.condition), go(t.then_value), go(t.else_value));
        case 'and': case 'or': case 'add': case 'beq': case 'ble': case 'blt': return emit(KIND[t.kind], go(t.left), go(t.right));
        case 'not': return emit(KIND.not, go(t.value));
        case 'let': { const value = go(t.value); const slot = slots; slots += 1; return emit(KIND.let, slot, value, compile(t.body, new Map(env).set(t.binder.name, slot))); }
        case 'match': {
          const scrutinee = go(t.scrutinee);
          const branches = t.branches.map((b) => {
            const scope = new Map(env);
            const taken = b.binders.map((binder) => { const slot = slots; slots += 1; scope.set(binder, slot); return slot; });
            return { tag: tagOf(constructorName(here, b.constructor)), taken, body: compile(b.body, scope) };
          });
          const slotLists = branches.map((b) => list(b.taken));
          return emit(KIND.match, scrutinee, list(branches.flatMap((b, i) => [b.tag, b.body, b.taken.length, slotLists[i]])), branches.length);
        }
        case 'primitive': { const parts = t.arguments.map(go); return emit(KIND.primitive, GUEST_PRIMITIVES[t.operation] | (RESULT[resultKind(t)] << 16), list(parts), parts.length); }
        default: return refuse('guest.uncovered', `term ${t.kind} is not run by the evaluator guest`);
      }
    };
    const body = compile(d.body, new Map(d.parameters.map((p, i) => [p.name, i])));
    return [d.parameters.length, slots, body];
  });

  const nodesAt = auxBase + aux.length;
  const poolAt = 4 * (nodesAt + 4 * nodes.length);
  const total = poolAt + pool.length;
  const words = [PROGRAM_MAGIC, order.length, 0, HEADER, nodesAt, auxBase, poolAt, total, ...functions.flat(), ...aux, ...nodes.flat()];
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint32(4 * i, w >>> 0, true));
  bytes.set(pool, poolAt);
  return { bytes, functions: order.length, nodes: nodes.length };
}

// ---- The linker: a WebAssembly module's sections, read and written as bytes.

const uleb = (n) => { const out = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); return out; };
function reader(bytes, at = 0) {
  const r = {
    at,
    byte: () => bytes[r.at++],
    u32: () => { let v = 0, shift = 0, b; do { b = bytes[r.at++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return v >>> 0; },
    i32: () => { let v = 0, shift = 0, b; do { b = bytes[r.at++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); if (shift < 32 && (b & 0x40)) v |= -1 << shift; return v; },
    take: (n) => { const out = bytes.subarray(r.at, r.at + n); r.at += n; return out; },
    name: () => new TextDecoder().decode(r.take(r.u32())),
  };
  return r;
}
const sleb = (n) => { const out = []; let v = n | 0; for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { out.push(b); return out; } out.push(b | 0x80); } };
const GUEST_EXPORTS = Object.freeze(['memory', 'holo_alloc', 'holo_run']);
const PAGE = 65536;

/**
 * The app's guest: `evaluator` with `program` attached. Throws `guest.evaluator` for a module that is not the
 * evaluator guest's shape: no `__heap_base`, an import, or a memory it does not define.
 */
export function linkGuest(evaluator, program) {
  const wrong = (why) => refuse('guest.evaluator', `the evaluator guest ${why}`);
  const module = new Uint8Array(evaluator);
  if (module.length < 8 || module[0] !== 0 || module[1] !== 0x61 || module[2] !== 0x73 || module[3] !== 0x6d) wrong('is not a WebAssembly module');
  const sections = [];
  for (const r = reader(module, 8); r.at < module.length;) { const id = r.byte(); const size = r.u32(); sections.push({ id, body: r.take(size) }); }
  const section = (id) => sections.find((s) => s.id === id);
  if (section(2)) wrong('imports something, and a guest imports nothing');
  if (!section(5) || !section(6) || !section(7)) wrong('has no memory, globals or exports of its own');

  // Globals: each a type, a mutability, and a constant initialiser. Only `i32.const n; end` is read.
  const globals = [];
  { const r = reader(section(6).body); const n = r.u32(); for (let i = 0; i < n; i += 1) { r.byte(); r.byte(); const op = r.byte(); globals.push(op === 0x41 ? r.i32() : null); if (op !== 0x41) wrong('has a global this linker does not read'); if (r.byte() !== 0x0b) wrong('has a global this linker does not read'); } }

  // Exports: keep the contract's three, and read where the heap begins from the one this linker needs.
  let heapBase = null;
  const kept = [];
  { const r = reader(section(7).body); const n = r.u32(); for (let i = 0; i < n; i += 1) { const start = r.at; const name = r.name(); const kind = r.byte(); const index = r.u32(); if (name === '__heap_base' && kind === 3) heapBase = globals[index]; if (GUEST_EXPORTS.includes(name)) kept.push(section(7).body.subarray(start, r.at)); } }
  if (heapBase === null || heapBase === undefined) wrong('does not export __heap_base');
  if (kept.length !== GUEST_EXPORTS.length) wrong('does not export memory, holo_alloc and holo_run');
  section(7).body = Uint8Array.from([...uleb(kept.length), ...kept.flatMap((e) => [...e])]);

  // Memory: at least enough pages for the program, which is initialised when the module is instantiated.
  { const r = reader(section(5).body); if (r.u32() !== 1) wrong('does not define exactly one memory'); const flags = r.byte(); const minimum = r.u32(); const maximum = flags & 1 ? r.u32() : null; const needed = Math.max(minimum, Math.ceil((heapBase + program.length) / PAGE)); if (maximum !== null && needed > maximum) refuse('guest.program', 'the program does not fit the memory the evaluator guest may have'); section(5).body = Uint8Array.from([1, flags, ...uleb(needed), ...(maximum === null ? [] : uleb(maximum))]); }

  // Data: one more active segment, the program, at the heap's first byte.
  const segment = [0, 0x41, ...sleb(heapBase), 0x0b, ...uleb(program.length)];
  const data = section(11);
  if (data) { const r = reader(data.body); const n = r.u32(); const rest = data.body.subarray(r.at); const body = new Uint8Array(uleb(n + 1).length + rest.length + segment.length + program.length); let at = 0; for (const part of [uleb(n + 1), rest, segment, program]) { body.set(part, at); at += part.length; } data.body = body; } else {
    const body = Uint8Array.from([1, ...segment, ...program]);
    const after = sections.findIndex((s) => s.id === 0 && sections.indexOf(s) > sections.findIndex((x) => x.id === 10));
    sections.splice(after < 0 ? sections.length : after, 0, { id: 11, body });
  }
  const count = section(12);
  if (count) count.body = Uint8Array.from(uleb(reader(count.body).u32() + 1));

  const out = [module.subarray(0, 8)];
  for (const s of sections) out.push(Uint8Array.from([s.id, ...uleb(s.body.length)]), s.body);
  const linked = new Uint8Array(out.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of out) { linked.set(part, at); at += part.length; }
  return linked;
}

/** Requests made from the app's own vectors: each one, each cut short, each with a byte changed, and each with a byte more. */
export function requestsFrom(vectors, { each = 16 } = {}) {
  const out = [];
  for (const v of vectors) {
    const r = v.request;
    out.push(r);
    const step = Math.max(1, Math.floor(r.length / each));
    for (let i = 0; i < r.length; i += step) {
      out.push(r.slice(0, i));
      const changed = r.slice(); changed[i] ^= 0x01; out.push(changed);
      const other = r.slice(); other[i] = 0x20; out.push(other);
    }
    const longer = new Uint8Array(r.length + 1); longer.set(r); longer[r.length] = 0x30; out.push(longer);
  }
  return out;
}

/**
 * Whether the guest answers as the reference evaluator does: every vector, and every request made from them.
 * `run` answers one request from the guest (bytes in, bytes out; a throw is a trap). Returns
 * `{ total, agreed, differ }`, each difference with its request.
 */
export async function guestAgrees(snapshot, run, { requests = null } = {}) {
  const program = modelProgram(snapshot);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const asked = requests ?? requestsFrom(program.application.acceptanceVectors);
  const differ = [];
  for (const request of asked) {
    const expected = program.dispatch(request);
    let got;
    try {
      got = await run(request);
    } catch (error) {
      differ.push({ request, expected, trap: error.message });
      continue;
    }
    if (!same(got, expected)) differ.push({ request, expected, got });
  }
  return { total: asked.length, agreed: asked.length - differ.length, differ };
}
