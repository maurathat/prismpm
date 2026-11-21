/**
 * The reference evaluator: a model's semantic snapshot (`lexlean snapshot`,
 * `lexlean/semantic-snapshot/2`) run as it stands, with no Lean, Rust or
 * WebAssembly compiled. It answers a request with the model's own `dispatch`
 * and replays the model's own acceptance vectors.
 *
 * It is the meaning a built guest is compared with, and what answers before
 * anything is built. It is tested, not proved: the terms are LexLean's, and
 * each primitive below follows the Lean definition LexLean's runtime gives it
 * (`LexLeanRuntime`, lexlean `language/runtime-1.2`), named beside it.
 *
 * A construct not covered here is refused by name before anything runs
 * (`uncovered`), never guessed. This file imports nothing, so a browser and a
 * worker run it as Node does.
 */

export const SNAPSHOT_SPEC = 'lexlean/semantic-snapshot/2';
/** The steps one request may take before it is refused: a model's recursion is bounded by its own fuel, this bounds a defect. */
export const STEP_LIMIT = 50_000_000;

/** A snapshot this evaluator does not run, or a request it stopped. `code` names why. */
export class ModelEvalRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelEvalRefused';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new ModelEvalRefused(code, message); };

// ---- Values. Nat and Int are BigInt; a fixed-width integer is a BigInt in its range; Bytes is a Uint8Array;
// ---- a String is a string; a Bool is a boolean; a record is { fields }; every constructor is { c, a }.

const none = Object.freeze({ c: 'Option.none', a: [] });
const some = (v) => ({ c: 'Option.some', a: [v] });
const NIL = Object.freeze({ c: 'List.nil', a: [] });
const cons = (h, t) => ({ c: 'List.cons', a: [h, t] });
const toArray = (list) => { const out = []; for (let l = list; l.c === 'List.cons'; l = l.a[1]) out.push(l.a[0]); return out; };
const fromArray = (items) => items.reduceRight((tail, head) => cons(head, tail), NIL);
const isBytes = (v) => v instanceof Uint8Array;
const isList = (v) => v !== null && typeof v === 'object' && (v.c === 'List.nil' || v.c === 'List.cons');

/** Structural equality: Lean's `==` on the types a model computes with. */
export function equal(a, b) {
  if (isBytes(a)) return isBytes(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object') return false;
    if (a.c !== undefined) return a.c === b.c && a.a.length === b.a.length && a.a.every((x, i) => equal(x, b.a[i]));
    const keys = Object.keys(a.fields);
    return b.fields !== undefined && keys.length === Object.keys(b.fields).length && keys.every((k) => equal(a.fields[k], b.fields[k]));
  }
  return a === b;
}

const FIXED = Object.freeze({
  uint8: [0n, 255n], uint16: [0n, 65535n], uint32: [0n, 4294967295n], uint64: [0n, 18446744073709551615n],
  int8: [-128n, 127n], int16: [-32768n, 32767n], int32: [-2147483648n, 2147483647n], int64: [-9223372036854775808n, 9223372036854775807n],
});
const bits = (kind) => BigInt(kind.replace(/\D/g, ''));
/** `Fixed.fromInt`: the value modulo the width, in the type's range. */
const wrap = (kind, value) => (kind.startsWith('u') ? BigInt.asUintN(Number(bits(kind)), value) : BigInt.asIntN(Number(bits(kind)), value));
/** `checkedFromInt`: the value when the type holds it. */
const checked = (kind, value) => (value >= FIXED[kind][0] && value <= FIXED[kind][1] ? some(value) : none);
const hexBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

// ---- The primitives. Each takes the evaluated arguments and the result type the snapshot states.

const optionOf = (result) => result.element ?? result.value ?? result.argument;
const arithmetic = (name, exact) => (a, result) => {
  if (result.kind === 'nat') return name === 'subtract' ? (a[0] > a[1] ? a[0] - a[1] : 0n) : exact(a); // Nat.sub truncates at zero
  if (result.kind === 'int') return exact(a);
  if (FIXED[result.kind]) return wrap(result.kind, exact(a)); // `-` and `*` on a fixed width wrap
  return refuse('eval.uncovered', `primitive ${name} at ${result.kind} is not covered`);
};
const checkedOp = (name, exact) => (a, result) => {
  const kind = optionOf(result)?.kind;
  if (!FIXED[kind]) return refuse('eval.uncovered', `primitive ${name} at ${kind} is not covered`);
  const value = exact(a, kind);
  return value === null ? none : checked(kind, value);
};
/** `Int.tdiv`: rounds toward zero, as BigInt division does. */
const divide = (a, result, op) => {
  if (result.kind !== 'nat' && result.kind !== 'int') return refuse('eval.uncovered', `primitive quotient at ${result.kind} is not covered`);
  return a[1] === 0n ? a[2] : op(a[0], a[1]); // a zero divisor answers the stated zero case
};
const bitwise = (name, op) => (a, result) => (FIXED[result.kind] ? wrap(result.kind, op(a)) : refuse('eval.uncovered', `primitive ${name} at ${result.kind} is not covered`));
const shift = (name, op) => (a, result) => {
  const kind = optionOf(result)?.kind;
  if (!FIXED[kind]) return refuse('eval.uncovered', `primitive ${name} at ${kind} is not covered`);
  return a[1] < bits(kind) ? some(wrap(kind, op(a[0], a[1]))) : none; // a shift of the width or more is refused
};

export const PRIMITIVES = Object.freeze({
  subtract: arithmetic('subtract', (a) => a[0] - a[1]),
  multiply: arithmetic('multiply', (a) => a[0] * a[1]),
  negate: arithmetic('negate', (a) => -a[0]),
  quotient: (a, result) => divide(a, result, (x, y) => x / y),
  remainder: (a, result) => divide(a, result, (x, y) => x % y),
  checked_add: checkedOp('checked_add', (a) => a[0] + a[1]),
  checked_subtract: checkedOp('checked_subtract', (a) => a[0] - a[1]),
  checked_multiply: checkedOp('checked_multiply', (a) => a[0] * a[1]),
  checked_negate: checkedOp('checked_negate', (a) => -a[0]),
  checked_quotient: checkedOp('checked_quotient', (a) => (a[1] === 0n ? null : a[0] / a[1])),
  checked_convert: checkedOp('checked_convert', (a) => a[0]),
  bit_and: bitwise('bit_and', (a) => a[0] & a[1]),
  bit_or: bitwise('bit_or', (a) => a[0] | a[1]),
  bit_xor: bitwise('bit_xor', (a) => a[0] ^ a[1]),
  bit_not: bitwise('bit_not', (a) => ~a[0]),
  shift_left: shift('shift_left', (x, n) => x << n),
  shift_right: shift('shift_right', (x, n) => x >> n),
  to_nat: (a) => a[0],
  to_int: (a) => a[0],
  equal: (a) => equal(a[0], a[1]),
  append: (a) => {
    if (isBytes(a[0])) { const out = new Uint8Array(a[0].length + a[1].length); out.set(a[0]); out.set(a[1], a[0].length); return out; }
    if (isList(a[0])) return fromArray([...toArray(a[0]), ...toArray(a[1])]);
    return refuse('eval.uncovered', 'primitive append on this type is not covered');
  },
  length: (a) => {
    if (isBytes(a[0])) return BigInt(a[0].length);
    if (isList(a[0])) return BigInt(toArray(a[0]).length);
    if (typeof a[0] === 'string') return BigInt([...a[0]].length); // String.length counts characters
    return refuse('eval.uncovered', 'primitive length on this type is not covered');
  },
  index: (a) => {
    const items = isBytes(a[0]) ? a[0] : isList(a[0]) ? toArray(a[0]) : refuse('eval.uncovered', 'primitive index on this type is not covered');
    if (a[1] >= BigInt(items.length)) return none;
    const item = items[Number(a[1])];
    return some(isBytes(a[0]) ? BigInt(item) : item);
  },
  slice: (a) => {
    const items = isBytes(a[0]) ? a[0] : isList(a[0]) ? toArray(a[0]) : refuse('eval.uncovered', 'primitive slice on this type is not covered');
    if (a[1] + a[2] > BigInt(items.length)) return none; // start + count <= size, else none
    const part = items.slice(Number(a[1]), Number(a[1] + a[2]));
    return some(isBytes(a[0]) ? part : fromArray(part));
  },
  compare_bytes: (a) => { // `compare left.toList right.toList`: the first byte that differs, then the shorter first
    const n = Math.min(a[0].length, a[1].length);
    for (let i = 0; i < n; i += 1) if (a[0][i] !== a[1][i]) return { c: a[0][i] < a[1][i] ? 'Ordering.lt' : 'Ordering.gt', a: [] };
    return { c: a[0].length === a[1].length ? 'Ordering.eq' : a[0].length < a[1].length ? 'Ordering.lt' : 'Ordering.gt', a: [] };
  },
  utf8_encode: (a) => new TextEncoder().encode(a[0]),
  utf8_decode: (a) => { try { return some(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(a[0])); } catch { return none; } },
});

/** The term kinds this evaluator runs. A proposition (`eq`, `le`, `forall`, ...) states, it does not compute. */
export const TERMS = Object.freeze(['var', 'nat', 'integer', 'string', 'bytes', 'bool', 'unit', 'nil', 'cons', 'record', 'constructor', 'project', 'call', 'if', 'match', 'add', 'beq', 'ble', 'blt', 'and', 'or', 'not', 'let', 'pair', 'first', 'second', 'primitive']);
const BUILTIN = /^(List|Nat|Option|Bool|Ordering)\./;
const CHILDREN = ['arguments', 'fields', 'branches'];
const SINGLE = ['head', 'tail', 'value', 'condition', 'then_value', 'else_value', 'scrutinee', 'left', 'right', 'body'];

/**
 * Read a snapshot as a program. Returns `{ semanticId, application, entry, uncovered, dispatch, acceptance, reach }`.
 * `application` is the model's `TextApplication` record as plain values. `uncovered` lists, by name, what the
 * entry reaches that is not run here; `dispatch` and `acceptance` refuse (`eval.uncovered`) while it is not empty.
 * `primitives` replaces the table above: a test plants a defect with it.
 */
export function modelProgram(snapshot, { primitives = PRIMITIVES, stepLimit = STEP_LIMIT } = {}) {
  if (snapshot?.spec !== SNAPSHOT_SPEC) refuse('eval.snapshot', `not a ${SNAPSHOT_SPEC}: ${snapshot?.spec}`);
  const modules = new Map(snapshot.modules.map((m) => [m.name, m]));
  const declared = new Map();
  for (const m of snapshot.modules) {
    for (const d of m.semantic.declarations) {
      declared.set(`${m.name}::${d.name}`, { d, module: m.name });
      for (const c of d.constructors ?? []) declared.set(`${m.name}::${d.name}.${c.name}`, { constructor: c, module: m.name });
    }
  }
  // An unqualified name is the module's own, else the first module its imports reach that declares it: lower.mjs reads names the same way.
  const resolve = (here, member) => {
    if (member.module) return `${member.module}::${member.name}`;
    const seen = new Set();
    const queue = [here];
    while (queue.length) {
      const m = queue.shift();
      if (seen.has(m) || !modules.has(m)) continue;
      seen.add(m);
      if (declared.has(`${m}::${member.name}`)) return `${m}::${member.name}`;
      queue.push(...(modules.get(m).imports ?? []));
    }
    return refuse('eval.snapshot', `${member.name} is not declared in ${here} or what it imports`);
  };
  const constructorName = (here, member) => (!member.module && BUILTIN.test(member.name) ? member.name : resolve(here, member));

  // The machine: a loop over an explicit stack, so a model's recursion depth is bounded by memory, not by the
  // host's call stack (a 1,024-byte session recurses a thousand deep, and a browser's stack is smaller than Node's).
  // STRICT terms evaluate their parts left to right, then `finish`; the rest decide which part runs after the first.
  const STRICT = {
    cons: (t) => [t.head, t.tail], pair: (t) => [t.left, t.right], first: (t) => [t.value], second: (t) => [t.value],
    record: (t) => t.fields.map((x) => x.value), project: (t) => [t.value], constructor: (t) => t.arguments,
    add: (t) => [t.left, t.right], beq: (t) => [t.left, t.right], ble: (t) => [t.left, t.right], blt: (t) => [t.left, t.right],
    not: (t) => [t.value], primitive: (t) => t.arguments, call: (t) => t.arguments,
  };
  const finish = (t, v, here) => {
    switch (t.kind) {
      case 'cons': return cons(v[0], v[1]);
      case 'pair': return { c: 'Prod.mk', a: v };
      case 'first': return v[0].a[0];
      case 'second': return v[0].a[1];
      case 'record': return { fields: Object.fromEntries(t.fields.map((x, i) => [x.field, v[i]])) };
      case 'project': return v[0].fields[t.field];
      case 'constructor': return { c: constructorName(here, t.constructor), a: v };
      case 'add': return v[0] + v[1];
      case 'beq': return equal(v[0], v[1]);
      case 'ble': return v[0] <= v[1];
      case 'blt': return v[0] < v[1];
      case 'not': return !v[0];
      default: return primitives[t.operation](v, t.result); // primitive
    }
  };
  const branchOf = (t, value, env, here) => {
    for (const branch of t.branches) {
      const name = constructorName(here, branch.constructor);
      const bind = (values) => branch.binders.reduce((scope, binder, i) => scope.set(binder, values[i]), new Map(env));
      if (typeof value === 'bigint') {
        if (name === 'Nat.zero' && value === 0n) return [branch.body, env];
        if (name === 'Nat.succ' && value > 0n) return [branch.body, bind([value - 1n])];
      } else if (typeof value === 'boolean') {
        if (name === (value ? 'Bool.true' : 'Bool.false')) return [branch.body, env];
      } else if (value.c === name) return [branch.body, bind(value.a)];
    }
    return refuse('eval.match', `no branch of a match in ${here} takes the value`);
  };

  let steps = 0;
  function run(term, environment, module) {
    const stack = [];
    let t = term, env = environment, here = module, value, down = true;
    for (;;) {
      if (down) {
        steps += 1;
        if (steps > stepLimit) refuse('eval.steps', `the request took more than ${stepLimit} steps`);
        down = false;
        switch (t.kind) {
          case 'var': value = env.get(t.name); break;
          case 'nat': case 'integer': value = BigInt(t.value); break;
          case 'string': value = t.value; break;
          case 'bytes': value = hexBytes(t.hex); break;
          case 'bool': value = t.value; break;
          case 'unit': value = null; break;
          case 'nil': value = NIL; break;
          case 'and': case 'or': stack.push({ t, env, here }); t = t.left; down = true; break;
          case 'if': stack.push({ t, env, here }); t = t.condition; down = true; break;
          case 'let': stack.push({ t, env, here }); t = t.value; down = true; break;
          case 'match': stack.push({ t, env, here }); t = t.scrutinee; down = true; break;
          default: {
            const parts = STRICT[t.kind] ? STRICT[t.kind](t) : refuse('eval.uncovered', `term ${t.kind} is not covered`);
            if (parts.length > 0) { stack.push({ t, env, here, parts, values: [] }); t = parts[0]; down = true; break; }
            // Nothing to evaluate first: a call of no arguments runs its body, anything else is finished as it stands.
            if (t.kind !== 'call') { value = finish(t, [], here); break; }
            const target = declared.get(resolve(here, t.function));
            t = target.d.body; env = new Map(); here = target.module; down = true;
          }
        }
        if (down) continue;
      }
      if (stack.length === 0) return value;
      const frame = stack[stack.length - 1];
      if (frame.parts) {
        frame.values.push(value);
        if (frame.values.length < frame.parts.length) { t = frame.parts[frame.values.length]; env = frame.env; here = frame.here; down = true; continue; }
        stack.pop();
        if (frame.t.kind === 'call') {
          // A call runs the definition's body in its own scope; nothing of the caller's is kept on the stack.
          const target = declared.get(resolve(frame.here, frame.t.function));
          t = target.d.body; env = new Map(target.d.parameters.map((p, i) => [p.name, frame.values[i]])); here = target.module; down = true;
          continue;
        }
        value = finish(frame.t, frame.values, frame.here);
        continue;
      }
      stack.pop();
      env = frame.env; here = frame.here; down = true;
      switch (frame.t.kind) {
        case 'and': if (value) t = frame.t.right; else down = false; break;
        case 'or': if (value) down = false; else t = frame.t.right; break;
        case 'if': t = value ? frame.t.then_value : frame.t.else_value; break;
        case 'let': env = new Map(frame.env).set(frame.t.binder.name, value); t = frame.t.body; break;
        default: [t, env] = branchOf(frame.t, value, frame.env, frame.here); // match
      }
    }
  }

  // What a definition reaches that is not run here, by name. Walked once, before any request.
  function uncoveredFrom(root) {
    const found = new Set();
    const seen = new Set();
    const walk = (t, here) => {
      if (Array.isArray(t)) { for (const x of t) walk(x, here); return; }
      if (t === null || typeof t !== 'object') return;
      if (typeof t.kind === 'string' && 'kind' in t) {
        if (t.kind === 'primitive') { if (!primitives[t.operation]) found.add(`primitive ${t.operation}`); } else if (!TERMS.includes(t.kind)) found.add(`term ${t.kind}`);
        if (t.kind === 'call') visit(resolve(here, t.function));
      }
      for (const key of CHILDREN) if (t[key]) walk(t[key], here);
      for (const key of SINGLE) if (t[key] && typeof t[key] === 'object') walk(t[key], here);
    };
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const target = declared.get(name);
      if (!target?.d || target.d.kind !== 'definition') { found.add(`${name} is not a definition`); return; }
      walk(target.d.body, target.module);
    };
    visit(root);
    return [...found].sort();
  }

  const guarded = (work) => {
    steps = 0;
    return work();
  };

  // The application: the one definition whose result is the text profile's record.
  const applications = [...declared].filter(([, v]) => v.d?.kind === 'definition' && v.d.result?.kind === 'named' && v.d.result.member.name === 'TextApplication');
  if (applications.length !== 1) refuse('eval.application', `the model declares ${applications.length} text applications, and one is run`);
  const [applicationName, applicationAt] = applications[0];
  const described = uncoveredFrom(applicationName);
  if (described.length) refuse('eval.uncovered', `the application record uses ${described.join(', ')}`);
  const record = guarded(() => run(applicationAt.d.body, new Map(), applicationAt.module)).fields;
  const application = { ...record, libraryRoots: toArray(record.libraryRoots), acceptanceVectors: toArray(record.acceptanceVectors).map((v) => ({ request: v.fields.request, response: v.fields.response })), view: record.view?.fields ?? null };

  // `entryRoot` is the entry's Lean name: a module's Lean name, a dot, the definition's name.
  // A project's Lean prefix is its own to choose, and a starter's record may state another than its lock does, so
  // when no module's Lean name leads the entry, the one module whose own name ends it is taken.
  const longest = (found, size) => found.sort((a, b) => size(b) - size(a))[0];
  const byLean = longest(snapshot.modules.filter((m) => application.entryRoot.startsWith(`${m.lean_module}.`)), (m) => m.lean_module.length);
  const bySource = snapshot.modules.filter((m) => { const at = application.entryRoot.lastIndexOf(`.${m.name}.`); return at >= 0 && declared.has(`${m.name}::${application.entryRoot.slice(at + m.name.length + 2)}`); });
  const entry = byLean ? `${byLean.name}::${application.entryRoot.slice(byLean.lean_module.length + 1)}`
    : bySource.length === 1 ? `${bySource[0].name}::${application.entryRoot.slice(application.entryRoot.lastIndexOf(`.${bySource[0].name}.`) + bySource[0].name.length + 2)}` : null;
  const target = entry ? declared.get(entry) : null;
  if (!target?.d || target.d.kind !== 'definition' || target.d.parameters.length !== 1) refuse('eval.application', `the entry ${application.entryRoot} is not a definition of one argument in this model`);
  const uncovered = uncoveredFrom(entry);

  /** Bytes in, bytes out: the model's entry on one request. */
  function dispatch(request) {
    if (uncovered.length) refuse('eval.uncovered', `the model uses ${uncovered.join(', ')}, which the reference evaluator does not run yet`);
    const out = guarded(() => run(target.d.body, new Map([[target.d.parameters[0].name, new Uint8Array(request)]]), target.module));
    if (!isBytes(out)) refuse('eval.application', 'the entry did not answer with bytes');
    return out;
  }

  /** Replay the model's own acceptance vectors. A fault is a failure, with its reason. */
  function acceptance() {
    const failed = [];
    application.acceptanceVectors.forEach((v, index) => {
      let got;
      try {
        got = dispatch(v.request);
      } catch (error) {
        if (error.code === 'eval.uncovered') throw error;
        failed.push({ index, fault: error.message });
        return;
      }
      if (!equal(got, v.response)) failed.push({ index, got, expected: v.response });
    });
    return { total: application.acceptanceVectors.length, passed: application.acceptanceVectors.length - failed.length, failed };
  }

  // `reach` is how this program reads names, for the one other reader of a snapshot's terms: the guest's encoder (model-guest.mjs).
  return { semanticId: snapshot.semantic_id ?? null, application, entry, uncovered, dispatch, acceptance, reach: { declared, resolve, constructorName } };
}
