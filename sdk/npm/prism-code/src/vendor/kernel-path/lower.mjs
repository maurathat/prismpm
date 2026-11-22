// LexLean's semantic snapshot (`lexlean snapshot`, lexlean/semantic-snapshot/2) lowered to Lean kernel declarations,
// with no Lean elaborator: each structure an inductive type with its constructor and projection functions, each
// inductive an inductive, each definition a definition, each theorem's statement a definition `LexStmt.<name> : Prop`.
//
// Non-recursive terms are written as Lean's elaborator writes the same model's generated Lean, instances included.
// Matches and structural recursion go through the recursor the kernel itself generates for each inductive type
// (`T.rec`), not through the elaborator's auxiliary `casesOn`/`brecOn`/`match_` definitions: the same functions, with
// less machinery, and nothing the kernel did not build. Nothing here is trusted: Lean's kernel checks every
// declaration, and a construct not covered yet is refused by name, never guessed.
//
// Only what the theorems' statements reach is lowered: that is what a proof needs.
//
//   lower(snapshot, emitter, { hash }) -> { theorems: [{ name, statement, axioms, proof, key }], declared: [names], recursive: [names] }
//
// With `hash` (a string to its BLAKE3 label), each theorem carries a Merkle key: the label of its own declaration and of
// the labels of everything it reaches, each declaration's label being that of its content and its dependencies' labels.
// Two theorems with one key are the same statement over the same definitions, so one verdict serves both: an edit
// changes the keys of the theorems that reach what was edited, and no other.
import { E, L, apps, abstract } from "./emit.mjs";

const z = L.zero, one = L.succ(L.zero);
const c0 = (n) => E.const(n, []);
const fail = (m) => { throw new Error("lower: " + m); };

export function lower(snap, em, { hash = null } = {}) {
  if (snap.spec !== "lexlean/semantic-snapshot/2") fail(`not a lexlean/semantic-snapshot/2: ${snap.spec}`);
  const mods = new Map(snap.modules.map((m) => [m.name, m]));
  const full = (mod, name) => `${mods.get(mod).lean_module}.${name}`;
  // An unqualified name is the module's own, else the first module it reaches through its imports that declares it.
  const declares = new Map(snap.modules.map((m) => [m.name, new Set(m.semantic.declarations.flatMap((d) => [d.name, ...(d.constructors ?? []).map((c) => `${d.name}.${c.name}`)]))]));
  const ref = (here, member) => {
    if (member.abs) return member.name;
    if (member.module) return full(member.module, member.name);
    const seen = new Set(), queue = [here];
    while (queue.length) {
      const m = queue.shift();
      if (seen.has(m) || !mods.has(m)) continue;
      seen.add(m);
      if (declares.get(m).has(member.name)) return full(m, member.name);
      queue.push(...(mods.get(m).imports ?? []));
    }
    return fail(`${member.name} is not declared in ${here} or what it imports`);
  };
  const isBuiltin = (c) => !c.module && /^(List|Nat|Option|Bool)\./.test(c.name);
  const ctorName = (here, c) => c.module ? full(c.module, c.name) : ref(here, c);
  // Every declaration of the project by its Lean name, in module order then source order.
  const order = [], byName = new Map();
  for (const m of snap.modules) for (const d of m.semantic.declarations) {
    const n = full(m.name, d.name); order.push(n); byName.set(n, { mod: m.name, d });
  }
  const declOf = (n) => byName.get(n) ?? fail(`no declaration ${n}`);
  // Semantic types are made absolute when read, so a type carried from one module into another means the same thing.
  const absType = (here, t) => {
    if (!t || typeof t !== "object") return t;
    const o = { ...t };
    if (t.kind === "named") o.member = { name: ref(here, t.member), abs: true };
    for (const k of ["element", "value", "argument"]) if (t[k] && typeof t[k] === "object") o[k] = absType(here, t[k]);
    if (t.arguments) o.arguments = t.arguments.map((a) => absType(here, a));
    return o;
  };

  // ----- types -----
  const prim = { nat: "Nat", bool: "Bool", int: "Int", string: "String", bytes: "ByteArray", uint8: "UInt8", uint32: "UInt32", uint64: "UInt64", ordering: "Ordering" };
  const type = (here, t) => {
    if (prim[t.kind]) return c0(prim[t.kind]);
    switch (t.kind) {
      case "prop": return E.sort(z);
      case "named": return apps(c0(ref(here, t.member)), ...(t.arguments ?? []).map((a) => type(here, a)));
      case "option": return E.app(E.const("Option", [z]), type(here, t.element ?? t.value ?? t.argument));
      case "list": return E.app(E.const("List", [z]), type(here, t.element));
      default: return fail(`type ${t.kind} is not covered yet`);
    }
  };
  // The constructors of a type a match can take apart: each with its fields' semantic types and which are recursive.
  const shapeOf = (here, sem) => {
    switch (sem.kind) {
      case "list": return { rec: "List.rec", params: [type(here, sem.element)], levels: [one, z], ctors: [
        { name: "List.nil", fields: [] },
        { name: "List.cons", fields: [{ sem: sem.element }, { sem, recursive: true }] }] };
      case "nat": return { rec: "Nat.rec", params: [], levels: [one], ctors: [
        { name: "Nat.zero", fields: [] }, { name: "Nat.succ", fields: [{ sem, recursive: true }] }] };
      case "bool": return { rec: "Bool.rec", params: [], levels: [one], ctors: [{ name: "Bool.false", fields: [] }, { name: "Bool.true", fields: [] }] };
      case "option": { const v = sem.element ?? sem.value ?? sem.argument; return { rec: "Option.rec", params: [type(here, v)], levels: [one, z], ctors: [
        { name: "Option.none", fields: [] }, { name: "Option.some", fields: [{ sem: v }] }] }; }
      case "named": {
        const n = ref(here, sem.member), { mod, d } = declOf(n);
        if (d.kind !== "inductive") fail(`a match on the ${d.kind} ${n} is not covered yet`);
        return { rec: n + ".rec", params: [], levels: [one], user: true, ctors: d.constructors.map((c) => ({ name: `${n}.${c.name}`,
          fields: (c.fields ?? []).map((f) => { const fs = absType(mod, f.type ?? f); return { sem: fs, recursive: fs.kind === "named" && fs.member.name === n }; }) })) };
      }
      default: return fail(`a match on a ${sem.kind} is not covered yet`);
    }
  };
  const sameCtor = (here, shape, branch, c) => shape.user ? ctorName(here, branch.constructor) === c.name : branch.constructor.name === c.name;

  // The semantic type of a term, where the lowering needs it: a field's owner, an equation's type, a match's result.
  const bindSem = (ctx, name, sem) => new Map(ctx).set(name, { sem, fv: null });
  const typeOf = (here, ctx, t) => {
    switch (t.kind) {
      case "var": return (ctx.get(t.name) ?? fail(`unknown variable ${t.name}`)).sem;
      case "nat": case "add": return { kind: "nat" };
      case "string": return { kind: "string" };
      case "bytes": return { kind: "bytes" };
      case "integer": return { kind: t.representation };
      case "bool": case "and": case "or": case "not": case "beq": case "ble": case "blt": return { kind: "bool" };
      case "eq": case "le": case "lt": case "iff": case "prop_and": case "prop_or": return { kind: "prop" };
      case "if": return typeOf(here, ctx, t.then_value);
      case "let": return typeOf(here, bindSem(ctx, t.binder.name, absType(here, t.binder.type)), t.body);
      case "record": return { kind: "named", member: { name: ref(here, t.type), abs: true }, arguments: [] };
      case "primitive": return absType(here, t.result);
      case "nil": return { kind: "list", element: absType(here, t.element) };
      case "cons": return { kind: "list", element: typeOf(here, ctx, t.head) };
      case "constructor": {
        if (isBuiltin(t.constructor)) return { kind: "option", element: absType(here, t.type_arguments[0]) };
        const n = ctorName(here, t.constructor); return { kind: "named", member: { name: n.slice(0, n.lastIndexOf(".")), abs: true }, arguments: [] }; }
      case "call": { const n = ref(here, t.function), { mod, d } = declOf(n); return absType(mod, d.result ?? fail(`${t.function.name} has no result type`)); }
      case "project": {
        const s = typeOf(here, ctx, t.value);
        if (s.kind !== "named") fail(`a field of a ${s.kind}`);
        const { mod, d } = declOf(ref(here, s.member));
        return absType(mod, (d.fields.find((f) => f.name === t.field) ?? fail(`no field ${t.field}`)).type);
      }
      case "match": {
        const sem = typeOf(here, ctx, t.scrutinee), shape = shapeOf(here, sem), b = t.branches[0];
        const c = shape.ctors.find((c) => sameCtor(here, shape, b, c)) ?? fail(`no constructor ${b.constructor.name}`);
        let inner = ctx;
        b.binders.forEach((x, i) => { inner = bindSem(inner, x, c.fields[i].sem); });
        return typeOf(here, inner, b.body);
      }
      default: return fail(`the type of ${t.kind} is not covered yet`);
    }
  };
  const structOf = (here, sem) => sem.kind === "named" ? ref(here, sem.member) : fail(`a field of a ${sem.kind}`);

  // ----- terms -----
  const natLit = (v) => apps(E.const("OfNat.ofNat", [z]), c0("Nat"), E.nat(v), E.app(c0("instOfNatNat"), E.nat(v)));
  const eqAt = (ty, a, b) => apps(E.const("Eq", [one]), ty, a, b);
  // LexLeanRuntime's operations by operand type: the type arguments and instance Lean's elaborator passes.
  const N = c0("Nat"), BA = c0("ByteArray");
  const prims = {
    subtract: { nat: () => [N, c0("instSubNat")] },
    multiply: { nat: () => [N, c0("instMulNat")] },
    quotient: { nat: () => [N, c0("LexLeanRuntime.instQuotientNat")] },
    remainder: { nat: () => [N, c0("LexLeanRuntime.instQuotientNat")] },
    equal: Object.fromEntries(["string", "uint8", "uint32", "uint64"].map((k) => [k, () => [c0(prim[k]), apps(E.const("instBEqOfDecidableEq", [z]), c0(prim[k]), c0("instDecidableEq" + prim[k]))]])),
    length: { bytes: () => [BA, c0("LexLeanRuntime.instLengthableByteArray")] },
    index: { bytes: () => [BA, c0("UInt8"), c0("LexLeanRuntime.instIndexableByteArrayUInt8")] },
  };
  const listOf = (ty, xs) => xs.reduceRight((acc, x) => apps(E.const("List.cons", [z]), ty, x, acc), E.app(E.const("List.nil", [z]), ty));
  const lamOver = (fvs, body) => fvs.reduceRight((acc, fv) => E.lam(fv.name, fv.type, abstract(acc, fv)), body);
  const piOver = (fvs, body) => fvs.reduceRight((acc, fv) => E.pi(fv.name, fv.type, abstract(acc, fv)), body);
  // `rec` is the structural recursion being lowered, if any: { name, index, ih: Map(binder -> fvar) }.
  const term = (here, ctx, t, rec) => {
    const go = (x) => term(here, ctx, x, rec);
    switch (t.kind) {
      case "var": { const v = ctx.get(t.name) ?? fail(`unknown variable ${t.name}`); return v.fv ?? fail(`${t.name} is used where it has no value`); }
      case "nat": return natLit(t.value);
      case "bool": return c0(t.value ? "Bool.true" : "Bool.false");
      case "string": return E.str(t.value);
      case "integer": {
        const ty = prim[t.representation];
        if (!ty || ty === "Int" || ty === "Nat") fail(`integer ${t.representation} is not covered yet`);
        return apps(E.const("OfNat.ofNat", [z]), c0(ty), E.nat(t.value), E.app(c0(`${ty}.instOfNat`), E.nat(t.value)));
      }
      case "bytes": {
        const hex = t.hex ?? fail("bytes without hex");
        const xs = []; for (let i = 0; i < hex.length; i += 2) xs.push(E.app(c0("UInt8.ofNat"), E.nat(parseInt(hex.slice(i, i + 2), 16))));
        return E.app(c0("ByteArray.mk"), apps(E.const("List.toArray", [z]), c0("UInt8"), listOf(c0("UInt8"), xs)));
      }
      case "call": {
        const n = ref(here, t.function), args = t.arguments ?? [];
        if (rec && n === rec.name) {
          // A recursive call: on a field the current branch took apart, it is that field's induction hypothesis.
          const on = args[rec.index], ih = on && on.kind === "var" ? rec.ih.get(on.name) : null;
          if (!ih) fail(`${n}: a recursive call that is not on a structurally smaller argument`);
          return apps(ih, ...args.filter((_, i) => i !== rec.index).map(go));
        }
        return apps(c0(n), ...args.map(go));
      }
      case "constructor": {
        // Option's constructors take the element type, as Lean writes them: Option.some.{0} T x.
        if (isBuiltin(t.constructor)) {
          if (!/^Option\.(some|none)$/.test(t.constructor.name)) fail(`constructor ${t.constructor.name} is not covered yet`);
          return apps(E.const(t.constructor.name, [z]), type(here, absType(here, t.type_arguments[0])), ...(t.arguments ?? []).map(go));
        }
        return apps(c0(ctorName(here, t.constructor)), ...(t.arguments ?? []).map(go));
      }
      case "project": return E.app(c0(`${structOf(here, typeOf(here, ctx, t.value))}.${t.field}`), go(t.value));
      case "record": {
        // A record literal: the structure's constructor applied to its fields in declaration order.
        const n = ref(here, t.type), { d } = declOf(n);
        const given = new Map(t.fields.map((f) => [f.field, f.value]));
        return apps(c0(n + ".mk"), ...d.fields.map((f) => go(given.get(f.name) ?? fail(`${n}: field ${f.name} not given`))));
      }
      case "nil": return E.app(E.const("List.nil", [z]), type(here, absType(here, t.element)));
      case "cons": return apps(E.const("List.cons", [z]), type(here, typeOf(here, ctx, t.head)), go(t.head), go(t.tail));
      case "and": return apps(c0("Bool.and"), go(t.left), go(t.right));
      case "or": return apps(c0("Bool.or"), go(t.left), go(t.right));
      case "not": return E.app(c0("Bool.not"), go(t.value));
      case "beq": return apps(c0("Nat.beq"), go(t.left), go(t.right));
      case "ble": return apps(c0("Nat.ble"), go(t.left), go(t.right));
      case "blt": return apps(c0("Nat.blt"), go(t.left), go(t.right));
      case "add": return apps(E.const("HAdd.hAdd", [z, z, z]), c0("Nat"), c0("Nat"), c0("Nat"), apps(E.const("instHAdd", [z]), c0("Nat"), c0("instAddNat")), go(t.left), go(t.right));
      case "primitive": {
        // LexLean's runtime operations, as the generated Lean calls them: LexLeanRuntime.<op> with Nat's instance.
        const on = typeOf(here, ctx, t.arguments[0]).kind, inst = (prims[t.operation] ?? {})[on];
        if (!inst) fail(`primitive ${t.operation} over ${on} is not covered yet`);
        return apps(c0("LexLeanRuntime." + t.operation), ...inst(), ...t.arguments.map(go));
      }
      case "if": {
        // `if c then a else b` over a Boolean c: `ite (c = true) a b` with the Boolean equality's decision.
        const c = go(t.condition), ty = type(here, typeOf(here, ctx, t.then_value));
        return apps(E.const("ite", [one]), ty, eqAt(c0("Bool"), c, c0("Bool.true")), apps(c0("instDecidableEqBool"), c, c0("Bool.true")), go(t.then_value), go(t.else_value));
      }
      case "let": {
        if (!t.value) fail("a let without a value is not covered yet");
        const sem = absType(here, t.binder.type), ty = type(here, sem), fv = E.fvar(t.binder.name, ty);
        const body = term(here, new Map(ctx).set(t.binder.name, { fv, sem }), t.body, rec);
        return E.let(t.binder.name, ty, go(t.value), abstract(body, fv));
      }
      case "eq": return eqAt(type(here, typeOf(here, ctx, t.left)), go(t.left), go(t.right));
      case "iff": return apps(c0("Iff"), go(t.left), go(t.right));
      case "prop_and": return apps(c0("And"), go(t.left), go(t.right));
      case "prop_or": return apps(c0("Or"), go(t.left), go(t.right));
      case "le": case "lt": {
        const s = typeOf(here, ctx, t.left);
        if (s.kind !== "nat") fail(`${t.kind} over ${s.kind} is not covered yet`);
        return apps(E.const(t.kind === "le" ? "LE.le" : "LT.lt", [z]), c0("Nat"), c0(t.kind === "le" ? "instLENat" : "instLTNat"), go(t.left), go(t.right));
      }
      case "match": return match(here, ctx, t, rec);
      default: return fail(`${t.kind} is not covered yet`);
    }
  };
  // `match x with | C fields => body ...` as `T.rec params (fun _ => R) minors x`: each minor takes the constructor's
  // fields and, for each recursive field, an induction hypothesis it does not use.
  const match = (here, ctx, t, rec) => {
    const sem = typeOf(here, ctx, t.scrutinee), shape = shapeOf(here, sem), R = type(here, typeOf(here, ctx, t)), T = type(here, sem);
    const minors = shape.ctors.map((c) => {
      const b = t.branches.find((b) => sameCtor(here, shape, b, c)) ?? fail(`a match with no branch for ${c.name}`);
      const inner = new Map(ctx), fvs = c.fields.map((f, i) => E.fvar(b.binders[i] ?? `x${i}`, type(here, f.sem)));
      c.fields.forEach((f, i) => { if (b.binders[i]) inner.set(b.binders[i], { fv: fvs[i], sem: f.sem }); });
      const ihs = c.fields.filter((f) => f.recursive).map(() => E.fvar("ih", R));
      return lamOver([...fvs, ...ihs], term(here, inner, b.body, rec));
    });
    return apps(E.const(shape.rec, shape.levels), ...shape.params, E.lam("x", T, R), ...minors, term(here, ctx, t.scrutinee, rec));
  };
  // A structurally recursive definition f(p1..pn) on pk, whose body is a match on pk:
  //   f := fun p1..pn => T.rec params (fun _ => Π others, R) minors pk others
  // Each minor rebinds the other parameters, since a recursive call may change them, and turns a recursive call on a
  // field into that field's induction hypothesis applied to the call's other arguments.
  const recursive = (n, mod, d) => {
    const params = d.parameters ?? [], k = params.findIndex((p) => p.name === d.recursive_argument);
    if (k < 0) fail(`${n}: recursive argument ${d.recursive_argument} is not a parameter`);
    if (d.body.kind !== "match" || d.body.scrutinee.kind !== "var" || d.body.scrutinee.name !== d.recursive_argument) fail(`${n}: recursion whose body is not a match on its argument`);
    const sems = params.map((p) => absType(mod, p.type)), tys = sems.map((s) => type(mod, s));
    const outer = params.map((p, i) => E.fvar(p.name, tys[i]));
    const others = params.map((_, i) => i).filter((i) => i !== k);
    const R = type(mod, absType(mod, d.result));
    const motiveBody = piOver(others.map((i) => E.fvar(params[i].name, tys[i])), R);
    const shape = shapeOf(mod, sems[k]);
    const minors = shape.ctors.map((c) => {
      const b = d.body.branches.find((b) => sameCtor(mod, shape, b, c)) ?? fail(`${n}: no branch for ${c.name}`);
      const fvs = c.fields.map((f, i) => E.fvar(b.binders[i] ?? `x${i}`, type(mod, f.sem)));
      const ihs = [], ih = new Map();
      c.fields.forEach((f, i) => { if (f.recursive) { const h = E.fvar((b.binders[i] ?? "x") + "_ih", motiveBody); ihs.push(h); if (b.binders[i]) ih.set(b.binders[i], h); } });
      const inner = new Map(), mine = others.map((i) => E.fvar(params[i].name, tys[i]));
      others.forEach((i, j) => inner.set(params[i].name, { fv: mine[j], sem: sems[i] }));
      c.fields.forEach((f, i) => { if (b.binders[i]) inner.set(b.binders[i], { fv: fvs[i], sem: f.sem }); });
      return lamOver([...fvs, ...ihs], lamOver(mine, term(mod, inner, b.body, { name: n, index: k, ih })));
    });
    const value = apps(E.const(shape.rec, shape.levels), ...shape.params, E.lam(params[k].name, tys[k], motiveBody), ...minors, outer[k], ...others.map((i) => outer[i]));
    return { value: lamOver(outer, value), ty: piOver(outer, R) };
  };
  // Parameters as free variables, then closed over: λ for a value, Π for a type.
  const withParams = (here, params, body) => {
    const ctx = new Map(), fvs = [];
    for (const p of params) { const sem = absType(here, p.type), fv = E.fvar(p.name, type(here, sem)); fvs.push(fv); ctx.set(p.name, { fv, sem }); }
    return body(ctx, (e) => lamOver(fvs, e), (e) => piOver(fvs, e));
  };

  // ----- what a declaration names: types, functions, records, constructors, matched inductives -----
  const names = (here, t, into) => {
    if (!t || typeof t !== "object") return into;
    if (Array.isArray(t)) { t.forEach((x) => names(here, x, into)); return into; }
    const owner = (c) => { const n = ctorName(here, c); return n.slice(0, n.lastIndexOf(".")); };
    if (t.kind === "named" && t.member) into.add(ref(here, t.member));
    if (t.kind === "call" && t.function) into.add(ref(here, t.function));
    if (t.kind === "record" && t.type) into.add(ref(here, t.type));
    if (t.kind === "constructor" && !isBuiltin(t.constructor)) into.add(owner(t.constructor));
    if (t.kind === "match") for (const b of t.branches) if (!isBuiltin(b.constructor)) into.add(owner(b.constructor));
    for (const v of Object.values(t)) if (v && typeof v === "object") names(here, v, into);
    return into;
  };
  const deps = new Map();
  const depsOf = (n) => { if (!deps.has(n)) { const { mod, d } = declOf(n); const s = names(mod, d, new Set()); s.delete(n); deps.set(n, s); } return deps.get(n); };
  const needed = new Set();
  const reach = (n) => { if (needed.has(n)) return; needed.add(n); for (const m of depsOf(n)) reach(m); };
  for (const n of order) if (byName.get(n).d.kind === "theorem") for (const m of depsOf(n)) reach(m);

  // ----- the declarations, dependencies first: a declaration may only use what is written before it -----
  const declared = [], recursiveNames = [], done = new Set(), visiting = new Set();
  // A name the model declares is never one the base library already has. So the declarations mean the same under any
  // module prefix, and a verdict keyed without the prefix (below) is the verdict here too.
  const claim = (...names) => { for (const x of names) if (em.lib.decls.base?.has(x)) fail(`${x} is already a constant of the base library`); };
  const emit = (n) => {
    if (done.has(n)) return;
    if (visiting.has(n)) fail(`${n}: mutual recursion is not covered yet`);
    visiting.add(n);
    for (const m of depsOf(n)) emit(m);
    visiting.delete(n); done.add(n);
    const { mod, d } = declOf(n);
    if (d.kind === "structure") {
      if ((d.type_parameters ?? []).length || (d.parameters ?? []).length) fail(`${n}: a structure with parameters is not covered yet`);
      const T = c0(n), fields = d.fields.map((f) => ({ name: f.name, ty: type(mod, absType(mod, f.type)) }));
      claim(n, `${n}.mk`, `${n}.rec`, ...fields.map((f) => `${n}.${f.name}`));
      em.writeInductive({ name: n, type: E.sort(one), numParams: 0, ctors: [{ name: `${n}.mk`, type: fields.reduceRight((acc, f) => E.pi(f.name, f.ty, acc), T), numFields: fields.length }] });
      // Each field's projection function, as Lean declares it: `fun self => self.i`.
      fields.forEach((f, i) => em.writeDef({ name: `${n}.${f.name}`, type: E.pi("self", T, f.ty), value: E.lam("self", T, E.proj(n, i, E.bvar(0))) }));
    } else if (d.kind === "inductive") {
      if ((d.type_parameters ?? []).length || (d.parameters ?? []).length) fail(`${n}: an inductive with parameters is not covered yet`);
      const T = c0(n);
      let isRec = false;
      const ctors = d.constructors.map((c) => {
        const fs = (c.fields ?? []).map((f, i) => { const s = absType(mod, f.type ?? f), self = s.kind === "named" && s.member.name === n; isRec ||= self; return { name: f.name ?? `a${i}`, ty: self ? T : type(mod, s) }; });
        return { name: `${n}.${c.name}`, type: fs.reduceRight((acc, f) => E.pi(f.name, f.ty, acc), T), numFields: fs.length };
      });
      claim(n, `${n}.rec`, ...ctors.map((c) => c.name));
      em.writeInductive({ name: n, type: E.sort(one), numParams: 0, isRec, ctors });
    } else if (d.kind === "definition") {
      if (d.termination) fail(`${n}: well-founded recursion is not covered yet`);
      const { value, ty } = d.recursive_argument ? recursive(n, mod, d)
        : withParams(mod, d.parameters ?? [], (ctx, lam, pi) => ({ value: lam(term(mod, ctx, d.body)), ty: pi(type(mod, absType(mod, d.result))) }));
      if (d.recursive_argument) recursiveNames.push(n);
      claim(n);
      em.writeDef({ name: n, type: ty, value, hints: { regular: 1 } });
    } else fail(`${n}: a ${d.kind} is not covered yet`);
    declared.push(n);
  };
  for (const n of order) if (needed.has(n)) emit(n);
  // Merkle labels, by declaration. A declaration is named in them as LexLean names it (its module and its name), not by
  // its Lean name, which carries the project's module prefix: the same library modules in two projects get the same
  // labels, so a theorem judged in one is known in the other.
  const rel = (n) => { const { mod, d } = declOf(n); return `${mod}/${d.name}`; };
  const labels = new Map(), labelling = new Set();
  const labelOf = (n) => {
    if (labels.has(n)) return labels.get(n);
    if (labelling.has(n)) fail(`${n}: mutual recursion is not covered yet`);
    labelling.add(n);
    const { mod, d } = declOf(n);
    const l = hash(JSON.stringify(["lexlean-kernel-path/declaration/2", rel(n), mod, d, [...depsOf(n)].map((m) => [rel(m), labelOf(m)]).sort()]));
    labelling.delete(n); labels.set(n, l);
    return l;
  };
  const theorems = [];
  for (const n of order) {
    const { mod, d } = byName.get(n);
    if (d.kind !== "theorem") continue;
    const statement = withParams(mod, d.parameters ?? [], (ctx, lam, pi) => pi(term(mod, ctx, d.statement)));
    claim(n, "LexStmt." + n);
    em.writeDef({ name: "LexStmt." + n, type: E.sort(z), value: statement });
    const key = hash ? hash(JSON.stringify(["lexlean-kernel-path/theorem/2", rel(n), mod, d, [...depsOf(n)].map((m) => [rel(m), labelOf(m)]).sort()])) : null;
    // How much it reaches: a stand-in for how long the kernel takes, until a judged time is known.
    const seen = new Set(), stack = [...depsOf(n)];
    while (stack.length) { const m = stack.pop(); if (!seen.has(m)) { seen.add(m); stack.push(...depsOf(m)); } }
    theorems.push({ name: n, statement, axioms: d.axioms ?? [], proof: d.proof?.kind ?? null, parameters: (d.parameters ?? []).map((p) => p.name), key, weight: seen.size });
  }
  return { theorems, declared, recursive: recursiveNames };
}
