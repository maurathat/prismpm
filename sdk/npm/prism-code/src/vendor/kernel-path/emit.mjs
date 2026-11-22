// Term emitter prototype: writes Lean kernel proof terms for a generated LexLean module with no Lean in the loop.
// Input: the pruned library export (constant types only are read) and the module's generated Lean text.
// Output: export-format lines that continue the library's file, one `thm` per theorem.
// Proof forms covered: rfl, exact, constructor (And), rw, and linear arithmetic by reflection.
// Anything else throws "unsupported".

// ---------- levels ----------
const L = {
  zero: { k: "zero", key: "z" },
  succ: (l) => ({ k: "succ", l, key: `s(${l.key})` }),
  max: (a, b) => ({ k: "max", a, b, key: `m(${a.key},${b.key})` }),
  imax: (a, b) => ({ k: "imax", a, b, key: `i(${a.key},${b.key})` }),
  param: (name) => ({ k: "param", name, key: `p(${name})` }),
};
let fresh = 0;
const lmvar = () => { const id = ++fresh; return { k: "lmvar", id, key: `?l${id}` }; };

// ---------- expressions, hash-consed so equal terms are the same object ----------
const table = new Map();
let uids = 0;
function mk(node) { const hit = table.get(node.key); if (hit) return hit; node.uid = ++uids; table.set(node.key, node); return node; }
const E = {
  bvar: (i) => mk({ k: "bvar", i, key: `b${i}` }),
  sort: (l) => mk({ k: "sort", l, key: `S(${l.key})` }),
  const: (name, us) => mk({ k: "const", name, us, key: `C(${name};${us.map((u) => u.key).join(",")})` }),
  app: (fn, arg) => mk({ k: "app", fn, arg, key: `A${fn.uid},${arg.uid}` }),
  lam: (name, type, body, bi = "default") => mk({ k: "lam", name, type, body, bi, key: `L${name};${bi};${type.uid};${body.uid}` }),
  pi: (name, type, body, bi = "default") => mk({ k: "pi", name, type, body, bi, key: `P${name};${bi};${type.uid};${body.uid}` }),
  nat: (n) => mk({ k: "nat", n: String(n), key: `N${n}` }),
  str: (s) => mk({ k: "str", s, key: "Z" + JSON.stringify(s) }),
  fvar: (name, type) => { const id = ++fresh; return mk({ k: "fvar", name, type, id, key: `F${id}` }); },
  mvar: (type) => { const id = ++fresh; return mk({ k: "mvar", type, id, key: `?${id}` }); },
  let: (name, type, value, body) => mk({ k: "let", name, type, value, body, key: `T${name};${type.uid};${value.uid};${body.uid}` }),
  proj: (typeName, idx, struct) => mk({ k: "proj", typeName, idx, struct, key: `J${typeName};${idx};${struct.uid}` }),
  opaque: (ie) => mk({ k: "opaque", key: `O${ie}` }),
};
const Prop = () => E.sort(L.zero);
const apps = (f, ...args) => args.reduce((acc, a) => E.app(acc, a), f);
// A debugging switch from the environment. A browser worker has no `process`: there every switch is off, as in Node
// with the variable unset, so the same model gets the same proofs in a page as in Node.
const envFlag = (name) => globalThis.process?.env?.[name];

// ---------- the library: names, levels, expressions, constant types ----------
export function loadLibrary(text) {
  const lib = { names: [""], nameIx: new Map([["", 0]]), levels: [L.zero], levelIx: new Map([[L.zero.key, 0]]), exprs: [], exprIx: new Map(), decls: new Map(), ctors: new Map(), groups: new Map(), ctorsOf: (n) => lib.ctors.get(n), maxIn: 0, maxIl: 0, maxIe: -1 };
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if ("name" in o && "type" in o && "levelParams" in o) lib.decls.set(lib.names[o.name], { levelParams: o.levelParams.map((n) => lib.names[n]), type: lib.exprs[o.type], value: "value" in o ? lib.exprs[o.value] : null });
      if ("name" in o && Array.isArray(o.ctors) && o.ctors.every((c) => typeof c === "number")) lib.ctors.set(lib.names[o.name], o.ctors.map((c) => lib.names[c]));
      // An inductive group (mutual types share `all`), and how many parameters its types take.
      if ("name" in o && Array.isArray(o.all) && Array.isArray(o.ctors) && "numParams" in o) lib.groups.set(lib.names[o.name], { all: o.all.map((n) => lib.names[n]), params: o.numParams });
      Object.values(o).forEach(walk);
    }
  };
  for (const line of text.split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line);
    if ("in" in o) {
      const pre = lib.names[(o.str || o.num).pre];
      const part = o.str ? o.str.str : String(o.num.i);
      const full = pre ? `${pre}.${part}` : part;
      lib.names[o.in] = full; lib.nameIx.set(full, o.in); lib.maxIn = Math.max(lib.maxIn, o.in);
    } else if ("il" in o) {
      const g = (i) => lib.levels[i];
      const l = "succ" in o ? L.succ(g(o.succ)) : "max" in o ? L.max(g(o.max[0]), g(o.max[1])) : "imax" in o ? L.imax(g(o.imax[0]), g(o.imax[1])) : L.param(lib.names[o.param]);
      lib.levels[o.il] = l; lib.levelIx.set(l.key, o.il); lib.maxIl = Math.max(lib.maxIl, o.il);
    } else if ("ie" in o) {
      const g = (i) => lib.exprs[i];
      let e;
      if ("bvar" in o) e = E.bvar(o.bvar);
      else if ("sort" in o) e = E.sort(lib.levels[o.sort]);
      else if ("const" in o) e = E.const(lib.names[o.const.name], o.const.us.map((u) => lib.levels[u]));
      else if ("app" in o) e = E.app(g(o.app.fn), g(o.app.arg));
      else if ("lam" in o) e = E.lam(lib.names[o.lam.name], g(o.lam.type), g(o.lam.body), o.lam.binderInfo);
      else if ("forallE" in o) e = E.pi(lib.names[o.forallE.name], g(o.forallE.type), g(o.forallE.body), o.forallE.binderInfo);
      else if ("natVal" in o) e = E.nat(o.natVal);
      else if ("strVal" in o) e = E.str(o.strVal);
      else if ("proj" in o) e = E.proj(lib.names[o.proj.typeName], o.proj.idx, g(o.proj.struct));
      else if ("letE" in o) e = E.let(lib.names[o.letE.name], g(o.letE.type), g(o.letE.value), g(o.letE.body));
      else e = E.opaque(o.ie); // letE, proj, strVal, mdata: carried, never rebuilt
      lib.exprs[o.ie] = e; if (!lib.exprIx.has(e.key)) lib.exprIx.set(e.key, o.ie); lib.maxIe = Math.max(lib.maxIe, o.ie);
    } else walk(o);
  }
  return lib;
}

// ---------- term operations ----------
const lassign = new Map(), eassign = new Map();
function instL(l) {
  switch (l.k) {
    case "lmvar": return lassign.has(l.id) ? instL(lassign.get(l.id)) : l;
    case "succ": return L.succ(instL(l.l));
    case "max": return L.max(instL(l.a), instL(l.b));
    case "imax": return L.imax(instL(l.a), instL(l.b));
    default: return l;
  }
}
function map(e, f, depth = 0, memo = new Map()) { // rebuilds e; f(node, depth) may return a replacement
  const r = f(e, depth); if (r) return r;
  if (e.k !== "app" && e.k !== "lam" && e.k !== "pi" && e.k !== "let" && e.k !== "proj") return e;
  const mkey = e.uid * 4096 + depth, hit = memo.get(mkey); if (hit) return hit;
  const out = mapNode(e, f, depth, memo); memo.set(mkey, out); return out;
}
function mapNode(e, f, depth, memo) {
  switch (e.k) {
    case "app": return E.app(map(e.fn, f, depth, memo), map(e.arg, f, depth, memo));
    case "lam": return E.lam(e.name, map(e.type, f, depth, memo), map(e.body, f, depth + 1, memo), e.bi);
    case "pi": return E.pi(e.name, map(e.type, f, depth, memo), map(e.body, f, depth + 1, memo), e.bi);
    case "proj": return E.proj(e.typeName, e.idx, map(e.struct, f, depth, memo));
    case "let": return E.let(e.name, map(e.type, f, depth, memo), map(e.value, f, depth, memo), map(e.body, f, depth + 1, memo));
    default: return e;
  }
}
const inst = (e) => map(e, (n) => n.k === "mvar" && eassign.has(n.id) ? inst(eassign.get(n.id)) : n.k === "const" ? E.const(n.name, n.us.map(instL)) : n.k === "sort" ? E.sort(instL(n.l)) : null);
const instantiate = (body, v) => map(body, (n, d) => n.k === "bvar" ? (n.i === d ? v : n) : null);
const abstract = (e, target) => map(e, (n, d) => n === target ? E.bvar(d) : null);
const substLevels = (e, m) => {
  const sl = (l) => l.k === "param" ? (m.get(l.name) || l) : l.k === "succ" ? L.succ(sl(l.l)) : l.k === "max" ? L.max(sl(l.a), sl(l.b)) : l.k === "imax" ? L.imax(sl(l.a), sl(l.b)) : l;
  return map(e, (n) => n.k === "const" ? E.const(n.name, n.us.map(sl)) : n.k === "sort" ? E.sort(sl(n.l)) : null);
};
function beta(e) { // head beta only
  const args = []; let h = e;
  while (h.k === "app") { args.unshift(h.arg); h = h.fn; }
  if (h.k !== "lam" || !args.length) return e;
  while (h.k === "lam" && args.length) h = instantiate(h.body, args.shift());
  return beta(apps(h, ...args));
}
const fail = (m) => { throw new Error(m); };

// The constants an emitter knows: the parsed library's, read-only and shared by every emitter, under this emitter's
// own. So a library is parsed once per process, however many models are written over it.
class Layered {
  constructor(base) { this.base = base; this.own = new Map(); }
  get(k) { return this.own.has(k) ? this.own.get(k) : this.base.get(k); }
  has(k) { return this.own.has(k) || this.base.has(k); }
  set(k, v) { this.own.set(k, v); return this; }
}

// A term as text, for traces.
function show(e, depth = 0) {
  if (depth > 12) return "…";
  switch (e.k) {
    case "const": return e.name.split(".").slice(-2).join(".");
    case "app": { const xs = []; let h = e; while (h.k === "app") { xs.unshift(h.arg); h = h.fn; } return "(" + [show(h, depth + 1), ...xs.map((x) => show(x, depth + 1))].join(" ") + ")"; }
    case "fvar": return e.name;
    case "nat": return e.n;
    case "bvar": return "#" + e.i;
    default: return e.k;
  }
}
export function emitter(base) {
  const lib = { ...base, decls: new Layered(base.decls) };
  const decl = (name) => lib.decls.get(name) || fail(`unknown constant ${name}`);
  // A recursor of an inductive group, mutual or nested, at a constructor, as the kernel reduces it. The family is
  // found as the kernel builds it: the group's types, then each nested occurrence a constructor's field makes of them
  // inside another type (`List T`), in the order the fields first name it. `T.rec` eliminates the group's type T and
  // `First.rec_j` the j-th nested occurrence; each takes the parameters, a motive per member, a minor per constructor
  // of every member, and the major.
  function familyIota(h, a, again) {
    const m = /^(.*)\.rec(?:_(\d+))?$/.exec(h.name);
    if (!m) return null;
    const g = lib.groups.get(m[1]);
    if (!g || (g.all.length === 1 && !m[2] && !nestedIn(g, m[1]))) return null;
    const np = g.params, params = a.slice(0, np);
    const ms = g.all.map((n) => ({ ty: apps(E.const(n, []), ...params), ctors: (lib.ctorsOf(n) || []).map((cn) => ({ cn, ps: params, us: [] })) }));
    const declared = ms.length, names = new Set(g.all);
    const mentions = (t) => { let f = false; map(t, (x) => { if (x.k === "const" && names.has(x.name)) f = true; return null; }); return f; };
    const ctorTy = (c) => { const d = lib.decls.get(c.cn); let t = substLevels(d.type, new Map(d.levelParams.map((p, i) => [p, c.us[i] ?? L.zero]))); for (const p of c.ps) t = instantiate(t.body, p); return t; };
    for (let i = 0; i < ms.length; i++) for (const c of ms[i].ctors) {
      for (let t = ctorTy(c); t.k === "pi"; t = instantiate(t.body, E.fvar("f", t.type))) {
        if (ms.some((x) => x.ty === t.type) || !mentions(t.type)) continue;
        const [H, hp] = spine(t.type);
        if (H.k !== "const" || !lib.ctorsOf(H.name)) return null;
        ms.push({ ty: t.type, ctors: lib.ctorsOf(H.name).map((cn) => ({ cn, ps: hp, us: H.us })) });
      }
    }
    const k = m[2] ? declared + Number(m[2]) - 1 : g.all.indexOf(m[1]);
    if (k < 0 || k >= ms.length) return null;
    const nm = ms.length, nminors = ms.reduce((s, x) => s + x.ctors.length, 0), majorAt = np + nm + nminors;
    if (a.length <= majorAt) return null;
    const major = again(a[majorAt]), [ch, ca] = spine(major);
    const i = ch.k === "const" ? ms[k].ctors.findIndex((c) => c.cn === ch.name) : -1;
    if (i < 0) return null;
    const offset = ms.slice(0, k).reduce((s, x) => s + x.ctors.length, 0), c = ms[k].ctors[i];
    const motives = a.slice(np, np + nm), minors = a.slice(np + nm, majorAt), fields = ca.slice(c.ps.length);
    const recName = (j) => (j < declared ? `${g.all[j]}.rec` : `${g.all[0]}.rec_${j - declared + 1}`);
    const recs = [];
    let t = ctorTy(c);
    for (const f of fields) {
      if (t.k !== "pi") return null;
      const j = ms.findIndex((x) => x.ty === t.type);
      if (j >= 0) recs.push(apps(E.const(recName(j), h.us), ...params, ...motives, ...minors, f));
      t = instantiate(t.body, f);
    }
    return apps(minors[offset + i], ...fields, ...recs, ...a.slice(majorAt + 1));
  }
  // Whether a single type's constructors hold it inside another type: its recursor then has nested motives too.
  function nestedIn(g, T) {
    const names = new Set(g.all);
    for (const cn of lib.ctorsOf(T) || []) {
      for (let t = lib.decls.get(cn).type; t.k === "pi"; t = t.body) {
        const [H] = spine(t.type);
        if (H.k === "const" && !names.has(H.name)) { let f = false; map(t.type, (x) => { if (x.k === "const" && names.has(x.name)) f = true; return null; }); if (f) return true; }
      }
    }
    return false;
  }
  const constant = (name) => { const d = decl(name); const us = d.levelParams.map(() => lmvar()); return [E.const(name, us), substLevels(d.type, new Map(d.levelParams.map((p, i) => [p, us[i]])))]; };

  function infer(e) {
    switch (e.k) {
      case "const": { const d = decl(e.name); return substLevels(d.type, new Map(d.levelParams.map((p, i) => [p, e.us[i]]))); }
      case "app": { const ft = beta(inst(infer(e.fn))); return ft.k === "pi" ? instantiate(ft.body, e.arg) : fail("unsupported: function type is not a syntactic pi"); }
      case "fvar": case "mvar": return e.type;
      case "sort": return E.sort(L.succ(e.l));
      case "nat": return E.const("Nat", []);
      case "str": return E.const("String", []);
      case "lam": { const x = E.fvar(e.name, e.type); return E.pi(e.name, e.type, abstract(infer(instantiate(e.body, x)), x), e.bi); }
      default: return fail(`unsupported: infer ${e.k}`);
    }
  }
  function unifyL(a, b) {
    a = instL(a); b = instL(b);
    if (a.key === b.key) return;
    if (a.k === "lmvar") return void lassign.set(a.id, b);
    if (b.k === "lmvar") return void lassign.set(b.id, a);
    if (a.k === "succ" && b.k === "succ") return unifyL(a.l, b.l);
    fail(`level mismatch ${a.key} / ${b.key}`);
  }
  function unify(a, b) {
    a = beta(inst(a)); b = beta(inst(b));
    if (a === b) return;
    if (a.k === "mvar") { eassign.set(a.id, b); return unify(a.type, infer(b)); }
    if (b.k === "mvar") { eassign.set(b.id, a); return unify(b.type, infer(a)); }
    if (a.k !== b.k) fail(`mismatch ${a.k} / ${b.k}`);
    switch (a.k) {
      case "sort": return unifyL(a.l, b.l);
      case "const": if (a.name !== b.name) fail(`mismatch ${a.name} / ${b.name}`); return a.us.forEach((u, i) => unifyL(u, b.us[i]));
      case "app": unify(a.fn, b.fn); return unify(a.arg, b.arg);
      case "lam": case "pi": unify(a.type, b.type); return unify(a.body, b.body);
      default: fail(`mismatch at ${a.k}`);
    }
  }
  // A constant applied to every argument, explicit or not; null stands for an argument to infer.
  function full(name, args) {
    let [f, t] = constant(name);
    for (const given of args) {
      t = beta(inst(t)); if (t.k !== "pi") fail(`${name}: too many arguments`);
      const a = given || E.mvar(t.type);
      if (given) unify(t.type, infer(a));
      f = E.app(f, a); t = instantiate(t.body, a);
    }
    return f;
  }
  const numeral = (n) => apps(E.const("OfNat.ofNat", [L.zero]), E.const("Nat", []), E.nat(n), E.app(E.const("instOfNatNat", []), E.nat(n)));

  // Surface terms of the generated Lean: prefix application, numerals, parentheses.
  function elab(s, locals) {
    if (typeof s === "string") s = [s];
    const [head, ...args] = s;
    let f, t;
    if (Array.isArray(head)) { f = elab(head, locals); t = infer(f); }
    else if (/^\d+$/.test(head)) { f = numeral(head); t = infer(f); }
    else if (locals.has(head)) { f = locals.get(head); t = f.type; }
    else [f, t] = constant(head);
    const rest = [...args];
    for (;;) {
      t = beta(inst(t));
      if (t.k !== "pi") { if (rest.length) fail(`${head}: too many arguments`); break; }
      if (t.bi === "instImplicit") fail("unsupported: instance argument");
      let a;
      if (t.bi !== "default") a = E.mvar(t.type);
      else if (rest.length) { a = elab(rest.shift(), locals); unify(t.type, infer(a)); }
      else break;
      f = E.app(f, a); t = instantiate(t.body, a);
    }
    return f;
  }
  const asEq = (g) => { // @Eq T a b
    const b = g.arg, a = g.fn && g.fn.arg, T = g.fn && g.fn.fn && g.fn.fn.arg, c = g.fn && g.fn.fn && g.fn.fn.fn;
    return c && c.k === "const" && c.name === "Eq" ? { T, a, b } : null;
  };

  // ---------- arithmetic: bridging lemmas around a reflective core ----------
  // The trusted part is small: LexReflect.soundT, whose checker reads integer inequalities with conditionals.
  // Everything else here is untrusted compilation. Each statement form (a Boolean comparison, an equality, a
  // conjunction, division, a natural number, a byte) is turned into integer inequalities by a lemma proved once,
  // and the search only proposes certificates. The kernel judges the whole term.
  const c0 = (n) => E.const(n, []), Int = () => c0("Int"), u1 = L.succ(L.zero), RX = "LexReflect.";
  const binop = (H, inst, base) => (a, b) => apps(E.const(H, [L.zero, L.zero, L.zero]), Int(), Int(), Int(), apps(E.const(inst, [L.zero]), Int(), c0(base)), a, b);
  const T = { add: binop("HAdd.hAdd", "instHAdd", "Int.instAdd"), sub: binop("HSub.hSub", "instHSub", "Int.instSub"), mul: binop("HMul.hMul", "instHMul", "Int.instMul"),
    lit: (n) => apps(E.const("OfNat.ofNat", [L.zero]), Int(), E.nat(n), E.app(c0("instOfNat"), E.nat(n))),
    le: (a, b) => apps(E.const("LE.le", [L.zero]), Int(), c0("Int.instLEInt"), a, b), lt: (a, b) => apps(E.const("LT.lt", [L.zero]), Int(), c0("Int.instLTInt"), a, b) };
  const list = (ty, xs) => xs.reduceRight((tail, x) => apps(E.const("List.cons", [L.zero]), ty, x, tail), E.app(E.const("List.nil", [L.zero]), ty));
  const X = (c) => c0(RX + "Expr." + c), ExprT = () => c0(RX + "Expr"), NatT = () => c0("Nat");
  const spine = (t) => { const args = []; while (t.k === "app") { args.unshift(t.arg); t = t.fn; } return [t, args]; };
  const hasFVar = (t) => { let found = false; map(t, (n) => { if (n.k === "fvar") found = true; return null; }); return found; };

  // The statement as written, for the integer fragment: implications, <=, <, +, -, literal *, (n : Int), f (x).
  function parseInfix(src) {
    const toks = src.match(/->|<=|[()<+\-*:]|[A-Za-z_][\w'.]*|\d+/g) || []; let i = 0;
    if (toks.join("") !== src.replace(/\s+/g, "")) fail("unsupported: statement syntax");
    const eat = (t) => toks[i] === t ? (i++, true) : false;
    const need = (t) => eat(t) || fail("unsupported: statement syntax");
    const atom = () => {
      if (eat("(")) { if (/^\d+$/.test(toks[i]) && toks[i + 1] === ":") { const n = toks[i]; i += 2; need("Int"); need(")"); return { op: "lit", n: BigInt(n) }; } const e = imp(); need(")"); return e; }
      const name = toks[i++];
      if (!name || !/^[A-Za-z_]/.test(name)) fail("unsupported: statement syntax");
      if (toks[i] === "(") { i++; const arg = imp(); need(")"); return { op: "call", name, arg }; }
      return { op: "var", name };
    };
    const prod = () => { let a = atom(); while (eat("*")) a = { op: "mul", a, b: atom() }; return a; };
    const sum = () => { let a = prod(); for (;;) { if (eat("+")) a = { op: "add", a, b: prod() }; else if (eat("-")) a = { op: "sub", a, b: prod() }; else return a; } };
    const cmp = () => { const a = sum(); return eat("<=") ? { op: "le", a, b: sum() } : eat("<") ? { op: "lt", a, b: sum() } : a; };
    const imp = () => { const a = cmp(); return eat("->") ? { op: "imp", a, b: imp() } : a; };
    const e = imp(); if (i !== toks.length) fail("unsupported: statement syntax"); return e;
  }
  function statementFromText(th) {
    for (const [, ty] of th.binders) if (ty.length !== 1 || ty[0] !== "Int") fail("unsupported: statement syntax");
    const ns = th.name.slice(0, th.name.lastIndexOf(".") + 1);
    const locals = new Map(th.binders.map(([x]) => [x, E.fvar(x, Int())]));
    const local = (x) => locals.get(x) || fail(`unknown variable ${x}`);
    const fn = (f) => lib.decls.has(ns + f) ? c0(ns + f) : lib.decls.has(f) ? c0(f) : fail(`unsupported: ${f}`);
    const stmt = (e) => e.op === "imp" ? E.pi("a._@._internal._hyg.0", stmt(e.a), stmt(e.b)) : e.op === "var" ? local(e.name) : e.op === "lit" ? T.lit(e.n)
      : e.op === "call" ? E.app(fn(e.name), stmt(e.arg)) : T[e.op](stmt(e.a), stmt(e.b));
    return closeOver(th, locals, stmt(parseInfix(th.raw)), c0("Int")).type;
  }

  // Reflected terms, on the search side. Mirrors LexReflect.Expr and its functions exactly.
  const R = { v: (i) => ({ op: "var", i }), k: (n) => ({ op: "lit", n }), add: (a, b) => ({ op: "add", a, b }), sub: (a, b) => ({ op: "sub", a, b }), neg: (a) => ({ op: "neg", a }),
    mul: (k, b) => ({ op: "mul", k, b }), mulr: (a, k) => ({ op: "mulr", a, k }), ite: (a, b, t, e) => ({ op: "ite", a, b, t, e }) };
  const inner = (e) => e.op === "mul" ? "b" : (e.op === "neg" || e.op === "mulr") ? "a" : null;
  const firstIte = (e) => e.op === "ite" ? [e.a, e.b] : e.op === "add" || e.op === "sub" ? (firstIte(e.a) || firstIte(e.b)) : inner(e) ? firstIte(e[inner(e)]) : null;
  const resolve = (bit, e) => e.op === "ite" ? (bit ? e.t : e.e) : e.op === "add" || e.op === "sub" ? (firstIte(e.a) ? { ...e, a: resolve(bit, e.a) } : { ...e, b: resolve(bit, e.b) })
    : inner(e) ? { ...e, [inner(e)]: resolve(bit, e[inner(e)]) } : e;
  const pairFirst = (g) => firstIte(g[0]) || firstIte(g[1]);
  const pairResolve = (bit, g) => firstIte(g[0]) ? [resolve(bit, g[0]), g[1]] : [g[0], resolve(bit, g[1])];
  const intLit = (n) => n >= 0n ? E.app(c0("Int.ofNat"), E.nat(n)) : E.app(c0("Int.negSucc"), E.nat(-n - 1n));
  const quote = (e) => e.op === "var" ? E.app(X("var"), E.nat(e.i)) : e.op === "lit" ? E.app(X("const"), intLit(e.n)) : e.op === "mul" ? apps(X("mulc"), intLit(e.k), quote(e.b))
    : e.op === "mulr" ? apps(X("mulr"), quote(e.a), intLit(e.k)) : e.op === "neg" ? E.app(X("neg"), quote(e.a))
    : e.op === "ite" ? apps(X("ite"), quote(e.a), quote(e.b), quote(e.t), quote(e.e)) : apps(X(e.op), quote(e.a), quote(e.b));
  const quotePair = (p) => apps(E.const("Prod.mk", [L.zero, L.zero]), ExprT(), ExprT(), quote(p[0]), quote(p[1]));
  const abs = (x) => x < 0n ? -x : x, gcd = (a, b) => b ? gcd(b, a % b) : a, floorDiv = (a, g) => (a - ((a % g) + g) % g) / g;

  function compile(th, S) {
    const ns = th.name.slice(0, th.name.lastIndexOf(".") + 1);
    // Open the binders: values of a known type are variables, everything else is a hypothesis.
    const fvs = []; let body = S;
    const dataType = (t) => t.k === "const" && ["Int", "Nat", "UInt8", "Int8"].includes(t.name) ? t.name : null;
    const project = th.name.split(".")[0] + ".", z0 = L.zero, NatC = () => c0("Nat");
    const foldl = (acc, elem, f, z, xs) => apps(E.const("List.foldl", [z0, z0]), acc, elem, f, z, xs);
    const asFold = (t) => { const [h, a] = spine(t); return h.k === "const" && h.name === "List.foldl" && a.length === 5 ? { acc: a[0], elem: a[1], f: a[2], z: a[3], xs: a[4] } : null; };
    const pairOf = (t) => { const [h, a] = spine(t); return h.k === "const" && h.name === "Prod" && a.length === 2 ? a : null; };
    const part = (which, ty, p) => norm(apps(E.const(which, [z0, z0]), ty[0], ty[1], p)), eqAt = (ty, a, b) => apps(E.const("Eq", [u1]), ty, a, b);
    const listOf = (t) => { const [h, a] = spine(t); return h.k === "const" && h.name === "List" && a.length === 1 ? a[0] : null; };
    const natLit = (n) => apps(E.const("OfNat.ofNat", [z0]), NatC(), E.nat(n), E.app(c0("instOfNatNat"), E.nat(n)));
    const natAdd = (a, b) => apps(E.const("HAdd.hAdd", [z0, z0, z0]), NatC(), NatC(), NatC(), apps(E.const("instHAdd", [z0]), NatC(), c0("instAddNat")), a, b);
    // The form the kernel reaches by itself: this project's definitions unfolded, LexLean's folds as List.foldl, a
    // fold over a list that starts with an element taken one step. Nothing is done under a binder.
    function norm(t) {
      t = beta(t);
      if (t.k === "let") return norm(instantiate(t.body, t.value));
      if (t.k === "proj" && t.typeName === "Prod") { // the primitive form of p.1 and p.2
        const p = norm(t.struct), [ph, pa] = spine(p);
        if (ph.k === "const" && ph.name === "Prod.mk" && pa.length === 4) return norm(pa[2 + t.idx]);
        const ty = p.k === "fvar" ? pairOf(p.type) : null;
        return ty ? apps(E.const(t.idx === 0 ? "Prod.fst" : "Prod.snd", [z0, z0]), ty[0], ty[1], p) : E.proj(t.typeName, t.idx, p);
      }
      if (t.k === "proj") { // a field of a record the term itself builds, as the kernel reduces it
        const p = norm(t.struct), [ph, pa] = spine(p), decl = lib.decls.get(t.typeName);
        if (decl && ph.k === "const" && ph.name === t.typeName + ".mk") {
          let params = 0; for (let x = decl.type; x.k === "pi"; x = x.body) params++;
          if (pa.length > params + t.idx) return norm(pa[params + t.idx]);
        }
        return E.proj(t.typeName, t.idx, p);
      }
      if (t.k !== "app" && t.k !== "const") return t;
      const [h, a] = spine(t);
      if (h.k === "const") {
        if ((h.name === "Prod.fst" || h.name === "Prod.snd") && a.length === 3) {
          const p = norm(a[2]), [ph, pa] = spine(p);
          if (ph.k === "const" && ph.name === "Prod.mk" && pa.length === 4) return norm(pa[h.name === "Prod.fst" ? 2 : 3]);
          return apps(h, a[0], a[1], p);
        }
        // `T.casesOn params motive x minors` (LexLean's own, defined from `T.rec`): at a constructor, its minor at the
        // fields; a minor that only selects a field, at anything else, is that field's projection, as Lean writes it.
        if (h.name.endsWith(".casesOn") && h.name.startsWith(project)) {
          const T = h.name.slice(0, -8), ctors = lib.ctorsOf(T), decl = lib.decls.get(T);
          if (ctors && decl) {
            let np = 0; for (let x = decl.type; x.k === "pi"; x = x.body) np++;
            if (a.length >= np + 2 + ctors.length) {
              const major = norm(a[np + 1]), [ch, ca] = spine(major), i = ch.k === "const" ? ctors.indexOf(ch.name) : -1;
              const rest = a.slice(np + 2 + ctors.length);
              if (i >= 0) return norm(apps(a[np + 2 + i], ...ca.slice(np), ...rest));
              if (ctors.length === 1 && rest.length === 0) {
                let m = a[np + 2], k = 0; while (m.k === "lam") { m = m.body; k++; }
                if (m.k === "bvar" && m.i < k) return E.proj(T, k - 1 - m.i, major);
              }
              return apps(h, ...a.slice(0, np + 1).map(norm), major, ...a.slice(np + 2).map(norm));
            }
          }
        }
        const d = lib.decls.get(h.name);
        if (d && d.value && h.name.startsWith(project) && d.levelParams.length === 0) return norm(apps(d.value, ...a));
        if (/\.rec(_\d+)?$/.test(h.name) && h.name.startsWith(project)) { const r = familyIota(h, a, norm); if (r) return norm(r); }
        // A recursor at a constructor, as the kernel reduces it: the constructor's minor at its fields and, for each
        // field of the type itself, the recursor at that field. (A model's own types: no parameters, no indices.)
        if (h.name.endsWith(".rec") && h.name.startsWith(project)) {
          const T = h.name.slice(0, -4), ctors = lib.ctorsOf(T);
          if (ctors && a.length >= ctors.length + 2) {
            const major = norm(a[ctors.length + 1]), [ch, ca] = spine(major), i = ch.k === "const" ? ctors.indexOf(ch.name) : -1;
            if (i >= 0) {
              const recs = []; let cty = lib.decls.get(ch.name).type;
              for (const f of ca) { const [fh] = spine(cty.type); if (fh.k === "const" && fh.name === T) recs.push(apps(h, a[0], ...a.slice(1, ctors.length + 1), f)); cty = instantiate(cty.body, f); }
              return norm(apps(a[1 + i], ...ca, ...recs, ...a.slice(ctors.length + 2)));
            }
          }
        }
        if ((h.name === "LexLeanCollections.listFold" || h.name === "LexLeanCollections.setFold") && a.length === 5) return norm(foldl(a[1], a[0], a[2], a[3], a[4]));
        if (h.name === "LexLeanCollections.mapFold" && a.length === 6) {
          const pair = apps(E.const("Prod", [z0, z0]), a[0], a[1]), proj = (p) => apps(E.const(p, [z0, z0]), a[0], a[1], E.bvar(0));
          return norm(foldl(a[2], pair, E.lam("s", a[2], E.lam("e", pair, apps(a[3], E.bvar(1), proj("Prod.fst"), proj("Prod.snd")))), a[4], a[5]));
        }
        if (h.name === "LexLeanRuntime.append" && a.length === 4 && listOf(a[0])) return norm(apps(E.const("List.append", [z0]), listOf(a[0]), a[2], a[3]));
        if (h.name === "LexLeanRuntime.length" && a.length === 3 && listOf(a[0])) return norm(apps(E.const("List.length", [z0]), listOf(a[0]), a[2]));
        if (h.name === "List.foldl" && a.length === 5) {
          const xs = norm(a[4]), [lh, la] = spine(xs);
          if (lh.k === "const" && lh.name === "List.cons" && la.length === 3) return norm(foldl(a[0], a[1], a[2], apps(a[2], a[3], la[1]), la[2]));
          if (lh.k === "const" && lh.name === "List.nil") return norm(a[3]);
          return foldl(a[0], a[1], a[2], norm(a[3]), xs);
        }
      }
      return apps(h, ...a.map(norm));
    }
    while (body.k === "pi") { const fv = E.fvar(body.name, norm(body.type)); fvs.push(fv); body = instantiate(body.body, fv); }
    body = norm(body);
    const pos = new Map(fvs.map((fv, i) => [fv, i]));
    const under = (e, count) => map(e, (n, d) => n.k === "fvar" && pos.has(n) && pos.get(n) < count ? E.bvar(d + count - 1 - pos.get(n)) : null);
    // An obligation that stands on its own: closed over everything in scope, compiled separately, applied back.
    const forall = (vars, prop) => vars.reduceRight((b, v) => E.pi(v.name, v.type, abstract(b, v)), prop);
    const lift1 = (t) => map(t, (n, d) => n.k === "bvar" && n.i >= d ? E.bvar(n.i + 1) : null); // under one more binder
    const lambda = (vars, term) => vars.reduceRight((b, v) => E.lam(v.name, v.type, abstract(b, v)), term);
    const depth = th.depth || 0;
    const sub = (prop) => {
      if (depth > 3) fail("obligations nested too deep");
      let closed = under(prop, fvs.length); for (let i = fvs.length - 1; i >= 0; i--) closed = E.pi(fvs[i].name, under(fvs[i].type, i), closed);
      return apps(compile({ name: th.name, depth: depth + 1, sub: true }, closed).value, ...fvs);
    };

    // Atoms: integer-valued terms the checker treats as unknowns. Facts: inequalities known about them, each with
    // its proof. Sites: divisions by a constant, whose dividend's sign may have to be taken both ways.
    const atoms = [], atomIx = new Map(), facts = [], sites = new Map(), ranged = new Set();
    const atom = (t) => { if (!atomIx.has(t)) { atomIx.set(t, atoms.length); atoms.push(t); } return R.v(atomIx.get(t)); };
    const fact = (a, b, proof) => facts.push({ pair: [a, b], proof });
    const lemma = (name, ...args) => apps(c0(RX + name), ...args);
    // Booleans and natural-number comparisons, as Lean writes them.
    const BoolT = () => c0("Bool");
    const eqB = (x, v) => apps(E.const("Eq", [u1]), BoolT(), x, c0(v ? "Bool.true" : "Bool.false"));
    const ltN = (x, y) => apps(E.const("LT.lt", [L.zero]), NatC(), c0("instLTNat"), x, y), leN = (x, y) => apps(E.const("LE.le", [L.zero]), NatC(), c0("instLENat"), x, y);
    const eqN = (x, y) => apps(E.const("Eq", [u1]), NatC(), x, y);
    // Case splits a fact needs, taken only if the search fails without them: `or` proves P ∨ N, and `also(h)` lists
    // what else each side gives, as [proposition, proof] pairs.
    const splits = [];
    const split = (or, P, N, alsoP = () => [], alsoN = () => []) => splits.push({ kind: "or", or, P, N, alsoP, alsoN });
    // What an unknown is known to satisfy by itself (a natural is non-negative, a byte is in range, an `if` may be
    // split) holds on every branch of a case split, wherever it was first met: kept here, given to every search.
    const intrinsic = [], intrinsicSplits = [];
    const factI = (a, b, proof) => { const f = { pair: [a, b], proof }; facts.push(f); intrinsic.push(f); };
    const splitI = (...args) => { split(...args); intrinsicSplits.push(splits[splits.length - 1]); };
    const yes = () => apps(E.const("Eq.refl", [u1]), c0("Bool"), c0("Bool.true")), no = () => apps(E.const("Eq.refl", [u1]), c0("Bool"), c0("Bool.false"));
    const litOf = (t, ty) => { const [h, a] = spine(t); return h.k === "const" && h.name === "OfNat.ofNat" && a.length === 3 && a[0] === c0(ty) && a[1].k === "nat" ? BigInt(a[1].n) : null; };
    const negLitOf = (t, ty) => { const [h, a] = spine(t); return h.k === "const" && h.name === "Neg.neg" && a.length === 3 && a[0] === c0(ty) && litOf(a[2], ty) !== null ? -litOf(a[2], ty) : null; };
    const isType = (t, name) => t === c0(name);
    const ranges = { UInt8: ["u8_lo", 0n, "u8_hi", 255n], Int8: ["i8_lo", -128n, "i8_hi", 127n] };

    // Any integer term, including the integer readings of naturals and bytes.
    function intR(t) {
      t = beta(t);
      if (t.k === "let") return intR(instantiate(t.body, t.value));
      if (atomIx.has(t)) return R.v(atomIx.get(t));
      const [h, a] = spine(t);
      if (h.k === "const") {
        if (litOf(t, "Int") !== null) return R.k(litOf(t, "Int"));
        if (negLitOf(t, "Int") !== null) return R.k(negLitOf(t, "Int"));
        if (h.name === "Int.ofNat" && a.length === 1) { const [g, b] = spine(a[0]); return g.k === "const" && g.name === "UInt8.toNat" && b.length === 1 ? byteR(t, b[0], "UInt8") : natR(t, a[0]); }
        if (h.name === "Int8.toInt" && a.length === 1) return byteR(t, a[0], "Int8");
        const two = (n) => a.length === n + 2 && isType(a[0], "Int");
        if ((h.name === "HAdd.hAdd" && a.length === 6 && isType(a[0], "Int")) ) return R.add(intR(a[4]), intR(a[5]));
        if ((h.name === "HSub.hSub" && a.length === 6 && isType(a[0], "Int")) || (h.name === "LexLeanRuntime.subtract" && two(2))) return R.sub(intR(a[a.length - 2]), intR(a[a.length - 1]));
        if ((h.name === "Neg.neg" && a.length === 3 && isType(a[0], "Int")) || (h.name === "LexLeanRuntime.negate" && two(1))) return R.neg(intR(a[a.length - 1]));
        if ((h.name === "HMul.hMul" && a.length === 6 && isType(a[0], "Int")) || (h.name === "LexLeanRuntime.multiply" && two(2))) {
          const l = intR(a[a.length - 2]), r = intR(a[a.length - 1]);
          if (l.op === "lit") return R.mul(l.n, r); if (r.op === "lit") return R.mulr(l, r.n);
          return atom(t);
        }
        if ((h.name === "LexLeanRuntime.quotient" || h.name === "LexLeanRuntime.remainder") && two(3)) {
          const k = intR(a[3]);
          if (k.op !== "lit") return atom(t);
          if (k.n === 0n) return intR(a[4]); // division by zero returns the fallback; the kernel evaluates that
          const s = site(a[2], a[3], k.n);
          return h.name === "LexLeanRuntime.quotient" ? s.q : s.r;
        }
        if (h.name === "ite" && a.length === 5 && isType(a[0], "Int")) {
          const [eq, ea] = spine(a[1]), [lt, la] = ea.length === 3 ? spine(ea[1]) : [{}, []];
          if (eq.name === "Eq" && ea[2] === c0("Bool.true") && lt.name === "LexLeanCollections.lessThan" && la.length === 4 && isType(la[0], "Int"))
            return R.ite(intR(la[2]), intR(la[3]), intR(a[3]), intR(a[4]));
        }
        const d = lib.decls.get(h.name);
        if (d && d.value && h.name.startsWith(ns) && d.levelParams.length === 0) return intR(apps(d.value, ...a));
        const fo = asFold(t);
        if (fo && isType(fo.acc, "Int") && !atomIx.has(t)) { const v = atom(t); foldFacts(t, fo, "Int"); return v; }
      }
      return atom(t);
    }
    // e = k * q + r with q = e.tdiv k and r = e.tmod k, and r smaller than k in magnitude.
    function site(e, kTerm, k) {
      const id = e.uid + ":" + kTerm.uid;
      if (sites.has(id)) return sites.get(id);
      const qT = apps(c0("Int.tdiv"), e, kTerm), rT = apps(c0("Int.tmod"), e, kTerm);
      const s = { e, kTerm, k, q: atom(qT), r: atom(rT), E: null }; sites.set(id, s);
      s.E = intR(e);
      const kq = R.add(R.mul(k, s.q), s.r), m = abs(k) - 1n;
      fact(s.E, kq, lemma("div_le", e, kTerm)); fact(kq, s.E, lemma("div_ge", e, kTerm));
      fact(R.k(-m), s.r, lemma("rem_lo", e, kTerm, no())); fact(s.r, R.k(m), lemma("rem_hi", e, kTerm, no()));
      return s;
    }
    // A fold used as a number is an unknown, but two things are known about it. Over xs ++ ys it is the fold over ys
    // started from the fold over xs. And if each step only adds to the accumulator, a fold started from z is z plus
    // the fold started from zero; that one is itself proved by fusion, and is dropped if its obligations fail.
    function foldFacts(term, fo, ty) {
      const [lh, la] = spine(fo.xs), eq = (a, b) => apps(E.const("Eq", [u1]), fo.acc, a, b);
      if (lh.k === "const" && lh.name === "List.append" && la.length === 3) {
        const two = norm(foldl(fo.acc, fo.elem, fo.f, foldl(fo.acc, fo.elem, fo.f, fo.z, la[1]), la[2]));
        hypothesis(eq(term, two), lemma("fold_append", fo.elem, fo.acc, fo.f, fo.z, la[1], la[2]));
      }
      const zero = ty === "Nat" ? natLit(0n) : T.lit(0n), isZero = fo.z.k === "nat" ? BigInt(fo.z.n) === 0n : litOf(fo.z, ty) === 0n;
      if (!isZero && depth < 2) {
        const plus = (a, b) => ty === "Nat" ? natAdd(a, b) : T.add(a, b);
        const a = E.fvar("a", fo.acc), b = E.fvar("b", fo.acc), x = E.fvar("x", fo.elem), rel = (p, q) => eq(p, plus(fo.z, q));
        let proof = null;
        try {
          const step = sub(forall([a, b, x], E.pi("h", rel(a, b), rel(apps(fo.f, a, x), apps(fo.f, b, x)))));
          const init = sub(rel(fo.z, zero));
          proof = lemma("fold_rel2", fo.elem, fo.acc, fo.acc, fo.f, fo.f, lambda([a, b], rel(a, b)), step, fo.xs, fo.z, zero, init);
        } catch { /* not an additive fold: nothing is claimed */ }
        if (proof) hypothesis(eq(term, plus(fo.z, foldl(fo.acc, fo.elem, fo.f, zero, fo.xs))), proof);
      }
    }
    // A natural number n, read as Int.ofNat n. `view` is that integer term.
    function natR(view, n) {
      const lit = n.k === "nat" ? BigInt(n.n) : litOf(n, "Nat");
      if (lit !== null) return R.k(lit);
      const [h, a] = spine(n);
      const ofNat = (x) => E.app(c0("Int.ofNat"), x);
      if (h.k === "const" && h.name === "HAdd.hAdd" && a.length === 6 && isType(a[0], "Nat")) return R.add(intR(ofNat(a[4])), intR(ofNat(a[5])));
      if (h.k === "const" && ((h.name === "HMul.hMul" && a.length === 6) || (h.name === "LexLeanRuntime.multiply" && a.length === 4)) && isType(a[0], "Nat")) {
        const l = intR(ofNat(a[a.length - 2])), r = intR(ofNat(a[a.length - 1]));
        if (l.op === "lit") return R.mul(l.n, r); if (r.op === "lit") return R.mulr(l, r.n);
      }
      const fo = asFold(n);
      if (fo && isType(fo.acc, "Nat") && !atomIx.has(view)) { const v = atom(view); factI(R.k(0n), v, lemma("nat_nonneg", n)); foldFacts(n, fo, "Nat"); return v; }
      const isDiv = h.k === "const" && ((h.name === "LexLeanRuntime.quotient" && a.length === 5) || (h.name === "HDiv.hDiv" && a.length === 6)), isMod = h.k === "const" && ((h.name === "LexLeanRuntime.remainder" && a.length === 5) || (h.name === "HMod.hMod" && a.length === 6));
      if ((isDiv || isMod) && isType(a[0], "Nat")) {
        const runtime = a.length === 5, l = runtime ? a[2] : a[4], kT = runtime ? a[3] : a[5], k = intR(ofNat(kT));
        if (k.op === "lit" && k.n === 0n && runtime) return intR(ofNat(a[4]));
        if (k.op === "lit" && k.n > 0n) {
          const id = "N" + l.uid + ":" + kT.uid;
          if (!sites.has(id)) {
            const dT = apps(c0("Nat.div"), l, kT), mT = apps(c0("Nat.mod"), l, kT), q = atom(ofNat(dT)), m = atom(ofNat(mT));
            sites.set(id, { nat: true, q, m });
            const L = intR(ofNat(l)), kq = R.add(R.mul(k.n, q), m);
            factI(R.k(0n), q, lemma("nat_nonneg", dT)); factI(R.k(0n), m, lemma("nat_nonneg", mT));
            fact(L, kq, lemma("nat_divmod_le", l, kT)); fact(kq, L, lemma("nat_divmod_ge", l, kT));
            fact(m, R.k(k.n - 1n), lemma("nat_mod_hi", l, kT, yes()));
          }
          return isDiv ? sites.get(id).q : sites.get(id).m;
        }
      }
      // `if c = true then t else e` with c a Boolean: an unknown, and c is taken both ways when the search needs it.
      if (h.k === "const" && h.name === "ite" && a.length === 5 && isType(a[0], "Nat") && !atomIx.has(view)) {
        const [eq, ea] = spine(a[1]);
        if (eq.k === "const" && eq.name === "Eq" && ea.length === 3 && isType(ea[0], "Bool") && ea[2] === c0("Bool.true")) {
          const v = atom(view), c = ea[1];
          factI(R.k(0n), v, lemma("nat_nonneg", n));
          splitI(lemma("bool_cases", c), eqB(c, true), eqB(c, false),
            (hc) => [[eqN(n, a[3]), lemma("ite_t", NatC(), c, a[3], a[4], hc)]],
            (hc) => [[eqN(n, a[4]), lemma("ite_f", NatC(), c, a[3], a[4], hc)]]);
          return v;
        }
      }
      // x - y on naturals (the runtime's subtract, or `-` itself), which stops at zero: an unknown, and y <= x taken
      // both ways when the search needs it, giving x - y or 0.
      const isSub = h.k === "const" && ((h.name === "LexLeanRuntime.subtract" && a.length === 4) || (h.name === "HSub.hSub" && a.length === 6)) && isType(a[0], "Nat");
      if (isSub && !atomIx.has(view)) {
        const x = a[a.length - 2], y = a[a.length - 1], c = apps(c0("Nat.ble"), y, x), v = atom(view);
        factI(R.k(0n), v, lemma("nat_nonneg", n));
        const ofNat = (t) => E.app(c0("Int.ofNat"), t), eqI = (p, q) => apps(E.const("Eq", [u1]), Int(), p, q);
        splitI(lemma("bool_cases", c), eqB(c, true), eqB(c, false),
          (hc) => [[eqI(ofNat(n), T.sub(ofNat(x), ofNat(y))), lemma("nat_sub_t", x, y, hc)]],
          (hc) => [[eqN(n, natLit(0n)), lemma("nat_sub_f", x, y, hc)]]);
        return v;
      }
      if (!atomIx.has(view)) { const v = atom(view); factI(R.k(0n), v, lemma("nat_nonneg", n)); return v; }
      return atom(view);
    }
    // A byte x, read as an integer: its range is known.
    function byteR(view, x, ty) {
      const [lo, min, hi, max] = ranges[ty];
      let lit = litOf(x, ty); if (lit === null) lit = negLitOf(x, ty);
      if (lit !== null) return lit >= min && lit <= max ? R.k(lit) : fail("unsupported: a literal out of range");
      if (!atomIx.has(view)) { const v = atom(view); factI(R.k(min), v, lemma(lo, x)); factI(v, R.k(max), lemma(hi, x)); return v; }
      return atom(view);
    }
    const views = { Int: (t) => t, Nat: (t) => E.app(c0("Int.ofNat"), t), UInt8: (t) => E.app(c0("Int.ofNat"), E.app(c0("UInt8.toNat"), t)), Int8: (t) => E.app(c0("Int8.toInt"), t) };
    const prefix = { Nat: "nat", UInt8: "u8", Int8: "i8" };
    // A comparison, as the inequality a' <= b' over integers, with the lemma names that carry it there and back.
    function comparison(P) {
      const [h, a] = spine(P);
      if (h.k !== "const") return null;
      if ((h.name === "LE.le" || h.name === "LT.lt") && a.length === 4 && dataType(a[0])) {
        const ty = a[0].name, lt = h.name === "LT.lt", A = intR(views[ty](a[2])), B = intR(views[ty](a[3]));
        const pair = lt ? [R.add(A, R.k(1n)), B] : [A, B];
        return ty === "Int" ? { pair, args: [] } : { pair, args: [a[2], a[3]], mp: `${prefix[ty]}_${lt ? "lt" : "le"}_mp`, mpr: `${prefix[ty]}_${lt ? "lt" : "le"}_mpr` };
      }
      if (h.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && (a[2] === c0("Bool.true") || a[2] === c0("Bool.false"))) {
        const [g, b] = spine(a[1]), truth = a[2] === c0("Bool.true");
        if (g.k === "const" && g.name === "LexLeanCollections.lessThan" && b.length === 4 && (isType(b[0], "Int") || isType(b[0], "Int8"))) {
          const ty = b[0].name, A = intR(views[ty](b[2])), B = intR(views[ty](b[3])), p = ty === "Int" ? "int" : "i8";
          return { pair: truth ? [R.add(A, R.k(1n)), B] : [B, A], args: [b[2], b[3]], mp: `${p}_ltb_${truth}_mp`, mpr: `${p}_ltb_${truth}_mpr` };
        }
      }
      return null;
    }
    // A proposition headed by one of this model's own predicates, unfolded once: the kernel takes a proof of either for
    // the other, since they are the same proposition by definition.
    function unfoldHead(P) {
      const [g, a] = spine(P);
      if (g.k !== "const" || !g.name.startsWith(project)) return null;
      const d = lib.decls.get(g.name);
      return d && d.value && d.levelParams.length === 0 ? beta(apps(d.value, ...a)) : null;
    }
    function hypothesis(P, h) {
      P = norm(P); // one form for each quantity, whichever way it was reached
      const unfolded = unfoldHead(P);
      if (unfolded) return hypothesis(unfolded, h);
      {
        const [g, a] = spine(P);
        // A conjunction gives both sides; a disjunction is a case split, taken only if the search needs it.
        if (g.k === "const" && g.name === "And" && a.length === 2) {
          hypothesis(a[0], apps(c0("And.left"), a[0], a[1], h));
          return hypothesis(a[1], apps(c0("And.right"), a[0], a[1], h));
        }
        if (g.k === "const" && g.name === "Or" && a.length === 2) return split(h, a[0], a[1]);
        // What the checker cannot read (a negation, an implication, an equivalence) says nothing it can use: left out.
        if (g.k === "const" && (g.name === "Not" || g.name === "Iff" || g.name === "True")) return;
        // An implication whose premise is decidable: the premise is taken both ways when the search needs it, and
        // where it holds the conclusion is a fact too.
        if (P.k === "pi") {
          // (A ∧ B) → C is A → B → C: each premise is then decided in turn.
          let A = P.type; for (let u = unfoldHead(A); u; u = unfoldHead(A)) A = u;
          const [ga, aa] = spine(A);
          let dep = false; map(P.body, (n, d) => { if (n.k === "bvar" && n.i === d) dep = true; return null; });
          if (!dep && ga.k === "const" && ga.name === "And" && aa.length === 2) {
            const C = P.body, curried = E.pi("a", aa[0], E.pi("b", lift1(aa[1]), lift1(lift1(C))));
            const x = E.fvar("a", aa[0]), y = E.fvar("b", aa[1]);
            return hypothesis(curried, lambda([x, y], E.app(h, apps(c0("And.intro"), aa[0], aa[1], x, y))));
          }
          const g2 = guard(P, h); if (g2) split(...g2); return;
        }
      }
      {
        // `some x = some y` gives `x = y`: `Option.getD` with x as default reads both sides, and the kernel reduces it.
        const [g, a] = spine(P), opt = a.length === 3 ? spine(a[0]) : [null, []];
        if (g.k === "const" && g.name === "Eq" && opt[0]?.k === "const" && opt[0].name === "Option" && opt[1].length === 1) {
          const T = opt[1][0], [sx, xa] = spine(a[1]), [sy, ya] = spine(a[2]);
          if (sx.k === "const" && sx.name === "Option.some" && sy.k === "const" && sy.name === "Option.some" && xa.length === 2 && ya.length === 2) {
            const f = E.lam("o", a[0], apps(E.const("Option.getD", opt[0].us), T, E.bvar(0), xa[1]));
            return hypothesis(eqAt(T, xa[1], ya[1]), apps(E.const("congrArg", [u1, u1]), a[0], T, a[1], a[2], f, h));
          }
        }
      }
      const c = comparison(P);
      if (c) return fact(c.pair[0], c.pair[1], c.mp ? lemma(c.mp, ...c.args, h) : h);
      const [g, a] = spine(P);
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && (isType(a[0], "Int") || isType(a[0], "Nat"))) {
        const ty = a[0].name, A = intR(views[ty](a[1])), B = intR(views[ty](a[2]));
        // Kept as it is too: a goal it states is closed by it, with no lemma and so no axiom of its own.
        eqs.set(P, h);
        fact(A, B, lemma(ty === "Int" ? "le_of_eq'" : "nat_eq_le", a[1], a[2], h)); return fact(B, A, lemma(ty === "Int" ? "ge_of_eq'" : "nat_eq_ge", a[1], a[2], h));
      }
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && a[2] === c0("Bool.true")) {
        const [e, b] = spine(a[1]);
        if (e.k === "const" && e.name === "LexLeanRuntime.equal" && b.length === 4 && isType(b[0], "UInt8")) {
          const A = intR(views.UInt8(b[2])), B = intR(views.UInt8(b[3]));
          fact(A, B, lemma("u8_eqb_le", b[2], b[3], h)); return fact(B, A, lemma("u8_eqb_ge", b[2], b[3], h));
        }
      }
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && pairOf(a[0])) {
        const ty = pairOf(a[0]);
        hypothesis(eqAt(ty[0], part("Prod.fst", ty, a[1]), part("Prod.fst", ty, a[2])), lemma("pair_fst", ty[0], ty[1], a[1], a[2], h));
        return hypothesis(eqAt(ty[1], part("Prod.snd", ty, a[1]), part("Prod.snd", ty, a[2])), lemma("pair_snd", ty[0], ty[1], a[1], a[2], h));
      }
      // A Boolean fact: `&&` and `!` taken apart, natural-number comparisons read as inequalities, a disequality or a
      // false `&&` split. Any other Boolean fact says nothing the checker can use, and is kept out.
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && (a[2] === c0("Bool.true") || a[2] === c0("Bool.false"))) {
        const truth = a[2] === c0("Bool.true"), [e, b] = spine(a[1]);
        if (e.k !== "const") return;
        if (e.name === "Bool.and" && b.length === 2) {
          if (truth) { hypothesis(eqB(b[0], true), lemma("band_l", b[0], b[1], h)); return hypothesis(eqB(b[1], true), lemma("band_r", b[0], b[1], h)); }
          return split(lemma("band_f", b[0], b[1], h), eqB(b[0], false), eqB(b[1], false));
        }
        if (e.name === "Bool.not" && b.length === 1) return hypothesis(eqB(b[0], !truth), lemma(truth ? "bnot_t" : "bnot_f", b[0], h));
        if (e.name === "Bool.or" && b.length === 2) {
          const A = eqB(b[0], truth), B = eqB(b[1], truth);
          if (truth) return split(apps(E.const("Eq.mp", [L.zero]), P, apps(c0("Or"), A, B), apps(c0("Bool.or_eq_true"), b[0], b[1]), h), A, B);
          const both = apps(c0("And"), A, B);
          return hypothesis(both, apps(c0("Iff.mp"), P, both, apps(c0("Bool.or_eq_false_iff"), b[0], b[1]), h));
        }
        if (e.name === "Nat.blt" && b.length === 2) return hypothesis(truth ? ltN(b[0], b[1]) : leN(b[1], b[0]), lemma(truth ? "nat_blt_t" : "nat_blt_f", b[0], b[1], h));
        if (e.name === "Nat.ble" && b.length === 2) return hypothesis(truth ? leN(b[0], b[1]) : ltN(b[1], b[0]), lemma(truth ? "nat_ble_t" : "nat_ble_f", b[0], b[1], h));
        if (e.name === "Nat.beq" && b.length === 2) {
          if (truth) return hypothesis(eqN(b[0], b[1]), apps(c0("Nat.eq_of_beq_eq_true"), b[0], b[1], h));
          return split(lemma("nat_beq_f", b[0], b[1], h), ltN(b[0], b[1]), ltN(b[1], b[0]));
        }
        return;
      }
      fail("unsupported: this form of hypothesis");
    }
    // `A → B` with A decidable, as a case split: [proof of D ∨ ¬D-ish, side P, side N, what P gives, what N gives].
    // A natural comparison or equality is decided by its Boolean test, whose true side gives A back.
    function guard(P, h) {
      let dep = false; map(P.body, (n, d) => { if (n.k === "bvar" && n.i === d) dep = true; return null; });
      if (dep) return null;
      let A = P.type; const B = P.body;
      for (let u = unfoldHead(A); u; u = unfoldHead(A)) A = u;
      const [g, a] = spine(A), gives = (pf) => (hc) => [[B, E.app(h, pf(hc))]], none = () => [];
      if (g.k !== "const") return null;
      if (g.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && (a[2] === c0("Bool.true") || a[2] === c0("Bool.false"))) {
        const t = a[2] === c0("Bool.true");
        return [lemma("bool_cases", a[1]), eqB(a[1], true), eqB(a[1], false), t ? gives((x) => x) : none, t ? none : gives((x) => x)];
      }
      const test = g.name === "LT.lt" && a.length === 4 && isType(a[0], "Nat") ? ["Nat.blt", "nat_blt_t"]
        : g.name === "LE.le" && a.length === 4 && isType(a[0], "Nat") ? ["Nat.ble", "nat_ble_t"]
        : g.name === "Eq" && a.length === 3 && isType(a[0], "Nat") ? ["Nat.beq", "nat_beq_t"] : null;
      if (!test) return null;
      const [x, y] = a.length === 4 ? [a[2], a[3]] : [a[1], a[2]], c = apps(c0(test[0]), x, y);
      return [lemma("bool_cases", c), eqB(c, true), eqB(c, false), gives((hc) => lemma(test[1], x, y, hc)), none];
    }
    // What the goal needs, before any searching: its inequalities are reified so that every atom is known.
    const plan = (P) => { try { return Object.assign(plan0(P), { P }); } catch (e) { return { deferred: e, P }; } };
    function plan0(P) {
      P = norm(P);
      const held = hyps.find((h) => h.type === P); // the goal is a hypothesis
      if (held) return { closed: held };
      if (eqs.has(P)) return { closed: eqs.get(P) }; // an equation a hypothesis gives
      {
        const [g, a] = spine(P), flipped = g.k === "const" && g.name === "Eq" && a.length === 3 ? norm(apps(g, a[0], a[2], a[1])) : null;
        if (flipped && eqs.has(flipped)) return { closed: apps(E.const("Eq.symm", g.us), a[0], a[2], a[1], eqs.get(flipped)) };
      }
      const unfolded = unfoldHead(P);
      if (unfolded) return plan0(unfolded); // a proof of the unfolded goal is a proof of the goal
      const [g, a] = spine(P);
      if (g.k === "const" && g.name === "True") return { closed: c0("True.intro") };
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && a[1] === a[2]) return { closed: apps(E.const("Eq.refl", g.us), a[0], a[1]) }; // the same term
      if (g.k === "const" && g.name === "And" && a.length === 2) return { and: [plan(a[0]), plan(a[1])], args: a };
      const c = comparison(P);
      if (c) return { cores: [c.pair], wrap: (p) => c.mpr ? lemma(c.mpr, ...c.args, p[0]) : p[0] };
      // A closed equation of other data: the kernel evaluates both sides. Numbers go to the search, which also
      // proves a false one from contradictory hypotheses.
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && g.us.length === 1 && g.us[0].key === u1.key && !hasFVar(P) && !isType(a[0], "Int") && !isType(a[0], "Nat"))
        return { closed: apps(E.const("Eq.refl", [u1]), a[0], a[2]) };
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && (isType(a[0], "Int") || isType(a[0], "Nat"))) {
        const ty = a[0].name, A = intR(views[ty](a[1])), B = intR(views[ty](a[2]));
        return { cores: [[A, B], [B, A]], wrap: (p) => lemma(ty === "Int" ? "eq_of_le_le" : "nat_eq_of", a[1], a[2], p[0], p[1]) };
      }
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && pairOf(a[0])) {
        const ty = pairOf(a[0]);
        return { parts: [plan(eqAt(ty[0], part("Prod.fst", ty, a[1]), part("Prod.fst", ty, a[2]))), plan(eqAt(ty[1], part("Prod.snd", ty, a[1]), part("Prod.snd", ty, a[2])))], join: (x, y) => lemma("pair_ext", ty[0], ty[1], a[1], a[2], x, y) };
      }
      // `b = true` for a Boolean test: the proposition it tests, carried back by its reflection lemma.
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && a[2] === c0("Bool.true")) {
        const [e, b] = spine(a[1]);
        if (e.k === "const" && e.name === "Nat.ble" && b.length === 2) return { map: plan(leN(b[0], b[1])), f: (p) => apps(c0("Nat.ble_eq_true_of_le"), b[0], b[1], p) };
        if (e.k === "const" && e.name === "Nat.blt" && b.length === 2) return { map: plan(ltN(b[0], b[1])), f: (p) => apps(c0("Nat.ble_eq_true_of_le"), natAdd(b[0], natLit(1n)), b[1], p) };
        if (e.k === "const" && e.name === "Nat.beq" && b.length === 2) {
          // From x = y: `Nat.beq x x = true`, carried along the equation by Eq.rec.
          const z = E.fvar("z", NatC()), motive = lambda([z], E.lam("h", eqN(b[0], z), lift1(eqB(apps(c0("Nat.beq"), b[0], z), true))));
          return { map: plan(eqN(b[0], b[1])), f: (p) => apps(E.const("Eq.rec", [L.zero, u1]), NatC(), b[0], motive, apps(c0("Nat.beq_refl"), b[0]), b[1], p) };
        }
        if (e.k === "const" && e.name === "Bool.or" && b.length === 2) {
          // By cases on the left side: if it holds, the left; if not, the right, proved knowing the left is false.
          const A = eqB(b[0], true), N = eqB(b[0], false), B = eqB(b[1], true), or = apps(c0("Or"), A, B), viaOr = (q) => apps(E.const("Eq.mpr", [L.zero]), P, or, apps(c0("Bool.or_eq_true"), b[0], b[1]), q);
          return { closed: apps(c0("Or.elim"), A, N, P, lemma("bool_cases", b[0]),
            E.lam("h", A, viaOr(apps(c0("Or.inl"), A, B, E.bvar(0)))),
            E.lam("h", N, viaOr(apps(c0("Or.inr"), A, B, E.app(lift1(sub(E.pi("h", N, B))), E.bvar(0)))))) };
        }
        if (e.k === "const" && e.name === "Bool.not" && b.length === 1) {
          // From x = false: `!false = true` by evaluation, carried along x = false reversed.
          const z = E.fvar("z", BoolT()), motive = lambda([z], E.lam("h", apps(E.const("Eq", [u1]), BoolT(), c0("Bool.false"), z), lift1(eqB(apps(c0("Bool.not"), z), true))));
          return { map: plan(eqB(b[0], false)), f: (p) => apps(E.const("Eq.rec", [L.zero, u1]), BoolT(), c0("Bool.false"), motive, yes(), b[0], apps(E.const("Eq.symm", [u1]), BoolT(), b[0], c0("Bool.false"), p)) };
        }
        if (e.k === "const" && e.name === "Bool.and" && b.length === 2) {
          const A = eqB(b[0], true), B = eqB(b[1], true), both = apps(c0("And"), A, B);
          return { parts: [plan(A), plan(B)], join: (x, y) => apps(E.const("Eq.mpr", [L.zero]), P, both, apps(c0("Bool.and_eq_true"), b[0], b[1]), apps(c0("And.intro"), A, B, x, y)) };
        }
      }
      // `b = false`, for a Boolean b: refuted from b = true.
      if (g.k === "const" && g.name === "Eq" && a.length === 3 && isType(a[0], "Bool") && a[2] === c0("Bool.false")) return { boolFalse: a[1] };
      fail("unsupported: this form of goal");
    }
    const hyps = [];
    // The integer and natural equations the hypotheses give, by their normal form, each with its proof.
    const eqs = new Map();
    const propHeads = ["Eq", "LE.le", "LT.lt", "And", "Or", "Not", "Iff"];
    for (const fv of fvs) if (!dataType(fv.type)) {
      const head = spine(fv.type)[0];
      if (!(head.k === "const" && (propHeads.includes(head.name) || unfoldHead(fv.type)))) continue;
      hyps.push(fv); hypothesis(fv.type, fv);
    }
    const goalPlan = plan(body);
    const signSites = [...sites.values()].filter((s) => !s.nat);

    // ----- search: conditionals taken both ways; a goal without one refuted over the integers -----
    const addTo = (m, k, x) => { const y = (m.get(k) || 0n) + x; if (y === 0n) m.delete(k); else m.set(k, y); };
    const lin = (e, scale = 1n, into = new Map()) => {
      if (e.op === "var") addTo(into, e.i, scale); else if (e.op === "lit") addTo(into, -1, scale * e.n);
      else if (e.op === "ite") fail("unsupported: a conditional inside a hypothesis");
      else if (e.op === "mul") lin(e.b, scale * e.k, into); else if (e.op === "mulr") lin(e.a, scale * e.k, into); else if (e.op === "neg") lin(e.a, -scale, into);
      else { lin(e.a, scale, into); lin(e.b, e.op === "add" ? scale : -scale, into); }
      return into; };
    const gap = ([a, b]) => lin(a, -1n, lin(b));
    const combine = (p, a, q, b) => { const m = new Map(); for (const [k, x] of p) addTo(m, k, a * x); for (const [k, x] of q) addTo(m, k, b * x); return m; };
    // Rows read 0 <= row. Row 0 denies the goal; rows 1..H are the hypotheses. Fourier-Motzkin with each new row
    // divided by the gcd of its coefficients and its constant rounded down: that rounding is what makes it integer.
    function leaf(hs, g) {
      if (th.cert) return th.cert; // a control: a certificate given from outside, right or wrong
      const H = hs.length, steps = [];
      const tighten = (row) => {
        let d = 0n; for (const [x, c] of row.v) if (x >= 0) d = gcd(d, abs(c));
        if (d <= 1n) return row;
        const v = new Map(); for (const [x, c] of row.v) { const y = x >= 0 ? c / d : floorDiv(c, d); if (y !== 0n) v.set(x, y); }
        steps.push({ mult: row.mult, g: d });
        return { v, mult: new Map([[H + steps.length, 1n]]) };
      };
      const deny = combine(gap(g), -1n, new Map(), 0n); addTo(deny, -1, -1n);
      let rows = [{ v: deny, mult: new Map([[0, 1n]]) }, ...hs.map((h, i) => ({ v: gap(h), mult: new Map([[i + 1, 1n]]) }))].map(tighten);
      const refuted = (r) => [...r.v.keys()].every((x) => x < 0) && (r.v.get(-1) || 0n) < 0n;
      const hasVar = (r) => [...r.v.keys()].some((x) => x >= 0);
      // Equalities first. An equality is two opposite rows; where one of its variables has coefficient 1 or -1, that
      // variable is substituted away exactly. Projecting it out instead would forget that the others are integers.
      const sig = (v, sign) => [...v].map(([x, c]) => x + ":" + (sign * c)).sort().join(",");
      for (let again = true; again; ) {
        again = false;
        const seen = new Map(rows.map((r, i) => [sig(r.v, 1n), i]));
        for (let i = 0; i < rows.length && !again; i++) {
          const j = seen.get(sig(rows[i].v, -1n));
          if (j === undefined || j === i) continue;
          const unit = [...rows[i].v].find(([x, c]) => x >= 0 && abs(c) === 1n);
          if (!unit) continue;
          const [x, c] = unit, plus = c === 1n ? rows[i] : rows[j], minus = c === 1n ? rows[j] : rows[i]; // plus has +x
          rows = rows.filter((r, n) => n !== i && n !== j).map((r) => { const d = r.v.get(x) || 0n;
            return d === 0n ? r : tighten({ v: combine(r.v, 1n, d > 0n ? minus.v : plus.v, abs(d)), mult: combine(r.mult, 1n, d > 0n ? minus.mult : plus.mult, abs(d)) }); });
          again = true;
        }
      }
      let hit = rows.find(refuted);
      rows = rows.filter(hasVar);
      while (!hit) {
        const count = new Map();
        for (const r of rows) for (const [x, c] of r.v) if (x >= 0) { const e = count.get(x) || [0, 0, true, true]; e[c > 0n ? 0 : 1]++; if (c > 1n) e[2] = false; if (c < -1n) e[3] = false; count.set(x, e); }
        if (!count.size) break;
        let x = -1, best = Infinity;
        for (const [y, [p, q, unitUp, unitDown]] of count) { const cost = p * q - p - q + (unitUp || unitDown ? 0 : 1e6); if (cost < best) { best = cost; x = y; } }
        const pos = [], neg = [], next = [];
        for (const r of rows) { const c = r.v.get(x) || 0n; (c > 0n ? pos : c < 0n ? neg : next).push(r); }
        for (const p of pos) for (const q of neg) { const a = p.v.get(x), b = -q.v.get(x);
          const row = tighten({ v: combine(p.v, b, q.v, a), mult: combine(p.mult, b, q.mult, a) });
          if (refuted(row)) hit = hit || row; else if ([...row.v.keys()].some((y) => y >= 0)) next.push(row); }
        rows = next;
        if (rows.length > 20000) fail("the search grew too large");
      }
      if (!hit && envFlag("TRACE")) console.error("TRACE no certificate:", th.name, "facts", hs.length, "goal", JSON.stringify(g, (k, v) => typeof v === "bigint" ? String(v) : v).slice(0, 200), "atoms", atoms.map((t) => show(t)).join(" | ").slice(0, 1500));
      if (!hit) fail("no certificate found");
      // Keep only the cuts the refutation uses, and write multipliers in the order the checker holds its rows:
      // newest cut first, then the denied goal, then the hypotheses.
      const used = new Set(), mark = (mult) => { for (const id of mult.keys()) if (id > H && !used.has(id)) { used.add(id); mark(steps[id - H - 1].mult); } };
      mark(hit.mult);
      const kept = steps.map((s, j) => ({ ...s, id: H + 1 + j })).filter((s) => used.has(s.id)), rank = new Map(kept.map((s, j) => [s.id, j]));
      const dense = (mult, t) => { const out = []; for (const [id, k] of mult) { const pos = id > H ? t - 1 - rank.get(id) : t + id; while (out.length <= pos) out.push(0n); out[pos] = k; } return out; };
      const usedRows = new Set(); for (const m of [hit.mult, ...kept.map((s) => s.mult)]) for (const id of m.keys()) if (id >= 1 && id <= H) usedRows.add(hs[id - 1]);
      return { steps: kept.map((s, j) => ({ ks: dense(s.mult, j), g: s.g })), fin: dense(hit.mult, kept.length), usedRows };
    }
    function search(hs, g) {
      const c = pairFirst(g);
      if (!c) return { leaf: leaf(hs, g) };
      return { t: search([[R.add(c[0], R.k(1n)), c[1]], ...hs], pairResolve(true, g)), f: search([[c[1], c[0]], ...hs], pairResolve(false, g)) };
    }

    // ----- terms -----
    const pairT = apps(E.const("Prod", [L.zero, L.zero]), ExprT(), ExprT()), natList = E.app(E.const("List", [L.zero]), NatT()), stepT = apps(E.const("Prod", [L.zero, L.zero]), natList, NatT());
    const nats = (ks) => list(NatT(), ks.map((k) => E.nat(k)));
    const quoteCert = (c) => c.leaf
      ? apps(c0(RX + "Cert.leaf"), list(stepT, c.leaf.steps.map((s) => apps(E.const("Prod.mk", [L.zero, L.zero]), natList, NatT(), nats(s.ks), E.nat(s.g)))), nats(c.leaf.fin))
      : apps(c0(RX + "Cert.split"), quoteCert(c.t), quoteCert(c.f));
    const tree = (xs) => { if (!xs.length) return c0(RX + "Env.leaf"); const rest = xs.slice(1); return apps(c0(RX + "Env.node"), tree(rest.filter((_, i) => i % 2 === 0)), xs[0], tree(rest.filter((_, i) => i % 2 === 1))); };
    // The environment is written once all atoms are known: a case split may meet new ones. Until then it is a
    // placeholder, replaced at the end; an atom keeps its index, so every leaf reads the same values.
    const rho = E.fvar("ρ", c0(RX + "Env"));
    const denote = (e) => apps(c0(RX + "Expr.denote"), rho, quote(e));
    // One inequality from the facts in hand. If no certificate is found, the sign of a dividend is taken both ways.
    function core(pair, known, unsplit, taken = new Set()) {
      known = [...known, ...intrinsic.filter((f) => !known.includes(f))];
      let cert;
      try {
        cert = search(known.map((f) => f.pair), pair);
        if (!th.cert) { // keep only the facts some leaf used, then search once more over those
          const used = new Set(), walk = (c) => c.leaf ? c.leaf.usedRows.forEach((p) => used.add(p)) : (walk(c.t), walk(c.f)); walk(cert);
          const fewer = known.filter((f) => used.has(f.pair));
          if (fewer.length < known.length) { known = fewer; cert = search(known.map((f) => f.pair), pair); }
        }
      }
      catch (e) {
        if (!unsplit.length || th.cert) throw e;
        if (unsplit[0].kind === "or") {
          // A Boolean case split: each side adds its own facts, and may need further splits of its own.
          const [s, ...rest] = unsplit, hp = E.fvar("h", s.P), hn = E.fvar("h", s.N);
          const side = (P, hv, also) => {
            const f0 = facts.length, s0 = splits.length;
            hypothesis(P, hv);
            for (const [Q, q] of also(hv)) hypothesis(Q, q);
            const more = facts.splice(f0), next = splits.splice(s0), path = new Set([...taken, s]);
            const queue = [...next, ...rest];
            for (const t of intrinsicSplits) if (!path.has(t) && !queue.includes(t)) queue.push(t);
            return core(pair, [...known, ...more], queue, path);
          };
          const pos = side(s.P, hp, s.alsoP), neg = side(s.N, hn, s.alsoN);
          return apps(c0("Or.elim"), s.P, s.N, T.le(denote(pair[0]), denote(pair[1])), s.or, E.lam("h", s.P, abstract(pos, hp)), E.lam("h", s.N, abstract(neg, hn)));
        }
        const [s, ...rest] = unsplit, zero = T.lit(0n), P = T.le(zero, s.e), N = T.le(s.e, zero), hp = E.fvar("h", P), hn = E.fvar("h", N);
        const pos = core(pair, [...known, { pair: [R.k(0n), s.E], proof: hp }, { pair: [R.k(0n), s.r], proof: lemma("rem_nonneg", s.e, s.kTerm, hp) }], rest);
        const neg = core(pair, [...known, { pair: [s.E, R.k(0n)], proof: hn }, { pair: [s.r, R.k(0n)], proof: lemma("rem_nonpos", s.e, s.kTerm, hn) }], rest);
        return apps(c0("Or.elim"), P, N, T.le(denote(pair[0]), denote(pair[1])), lemma("sign_cases", s.e), E.lam("h", P, abstract(pos, hp)), E.lam("h", N, abstract(neg, hn)));
      }
      return apps(c0(RX + "soundT"), quoteCert(cert), list(pairT, known.map((f) => quotePair(f.pair))), quotePair(pair), rho, yes(), ...known.map((f) => f.proof));
    }
    function fusion(P, why) {
      const found = new Map(), lens = new Map(); // list variable -> its fold terms, its length terms
      map(P, (n, d) => {
        if (d > 0 || n.k !== "app") return null;
        const fo = asFold(n);
        if (fo && fo.xs.k === "fvar") { if (!found.has(fo.xs)) found.set(fo.xs, new Map()); found.get(fo.xs).set(n, fo); return n; } // not inside it
        const [h, a] = spine(n);
        if (h.k === "const" && h.name === "List.length" && a.length === 2 && a[1].k === "fvar") { lens.set(a[1], n); return n; }
        return null;
      });
      const best = [...found].sort((x, y) => y[1].size - x[1].size)[0];
      if (!best) throw why;
      const [list, sitesHere] = best, terms = [...sitesHere.keys()], fos = [...sitesHere.values()], len = lens.get(list), n = terms.length;
      const name = { "1": "fold_rel1", "2": "fold_rel2", "3": "fold_rel3", "1n": "fold_rel1_len", "2n": "fold_rel2_len" }[n + (len ? "n" : "")];
      if (!name) throw why;
      const svs = fos.map((fo, i) => E.fvar("s" + (i + 1), fo.acc)), nv = E.fvar("n", NatC()), x = E.fvar("x", fos[0].elem);
      const put = (accs, count) => map(P, (node, d) => { if (d > 0) return null; const i = terms.indexOf(node); return i >= 0 ? accs[i] : len && node === len ? count : null; });
      const vars = len ? [...svs, nv] : svs;
      const step = sub(forall([...vars, x], E.pi("h", put(svs, nv), put(fos.map((fo, i) => apps(fo.f, svs[i], x)), natAdd(nv, natLit(1n))))));
      const init = sub(put(fos.map((fo) => fo.z), natLit(0n)));
      return lemma(name, fos[0].elem, ...fos.map((fo) => fo.acc), ...fos.map((fo) => fo.f), lambda(vars, put(svs, nv)), step, list, ...fos.map((fo) => fo.z), init);
    }
    const build = (p) => {
      if (p.closed) return p.closed;
      if (p.boolFalse) {
        // From b = true, the facts it gives refute 1 <= 0.
        const P = eqB(p.boolFalse, true), hv = E.fvar("h", P);
        const f0 = facts.length, s0 = splits.length;
        hypothesis(P, hv);
        const mine = facts.splice(f0), more = splits.splice(s0);
        const absurd = lemma("one_le_zero_false", core([R.k(1n), R.k(0n)], [...facts, ...mine], [...more, ...splits, ...signSites]));
        return lemma("bfalse_of", p.boolFalse, E.lam("h", P, abstract(absurd, hv)));
      }
      if (p.map) return p.f(build(p.map));
      if (p.and) return apps(c0("And.intro"), p.args[0], p.args[1], build(p.and[0]), build(p.and[1]));
      if (p.deferred) return fusion(p.P, p.deferred);
      if (p.parts) return p.join(build(p.parts[0]), build(p.parts[1]));
      try { return p.wrap(p.cores.map((c) => core(c, facts, envFlag("NOSPLIT") ? signSites : [...splits, ...signSites]))); } catch (e) { if (th.cert) throw e; return fusion(p.P, e); }
    };
    const proof = map(build(goalPlan), (n) => (n === rho ? tree(atoms) : null));
    let value = under(proof, fvs.length);
    for (let i = fvs.length - 1; i >= 0; i--) value = E.lam(fvs[i].name, under(fvs[i].type, i), value);
    if (!th.sub) lib.decls.set(th.name, { levelParams: [], type: S });
    return { name: th.name, type: S, value };
  }
  // The statement is LexLean's to state. Where the library carries it (as `LexStmt.<name>`, the statement Lean
  // elaborated), it is taken from there; otherwise it is written here from the text, for the integer fragment.
  // A goal that is a conjunction or an equivalence, once the model's own predicates are unfolded, is proved part by
  // part under the same parameters: `A ∧ B` by `And.intro`, `A ↔ B` by `Iff.intro` of its two implications. Each part
  // is a goal of its own, so an implication inside a conjunction becomes a goal whose premise is a hypothesis.
  function decompose(th, S) {
    const project = th.name.split(".")[0] + ".";
    let body = S; const fvs = [];
    for (;;) {
      while (body.k === "pi") { const fv = E.fvar(body.name, body.type); fvs.push(fv); body = instantiate(body.body, fv); }
      const [g, a] = spine(body);
      const d = g.k === "const" && g.name.startsWith(project) ? lib.decls.get(g.name) : null;
      if (d && d.value && d.levelParams.length === 0) { body = beta(apps(d.value, ...a)); continue; }
      break;
    }
    const [g, a] = spine(body);
    const isAnd = g.k === "const" && g.name === "And" && a.length === 2, isIff = g.k === "const" && g.name === "Iff" && a.length === 2;
    if (!isAnd && !isIff) return null;
    const close = (e) => fvs.reduceRight((acc, fv) => E.pi(fv.name, fv.type, abstract(acc, fv)), e);
    const lamOver = (e) => fvs.reduceRight((acc, fv) => E.lam(fv.name, fv.type, abstract(acc, fv)), e);
    const part = (P, tag) => {
      const sub = { ...th, name: `${th.name}.${tag}`, sub: true }, S2 = close(P);
      // Each part is a theorem of its own, written before the whole: smaller terms, and a refusal names the part.
      const r = decompose(sub, S2) ?? compile(sub, S2);
      write({ name: sub.name, type: S2, value: r.value }); lib.decls.set(sub.name, { levelParams: [], type: S2 });
      return apps(c0(sub.name), ...fvs);
    };
    const arrow = (p, q) => E.pi("h", p, q); // p and q hold no loose bound variables: the parameters are free here
    const value = isAnd
      ? lamOver(apps(c0("And.intro"), a[0], a[1], part(a[0], "left"), part(a[1], "right")))
      : lamOver(apps(c0("Iff.intro"), a[0], a[1], part(arrow(a[0], a[1]), "mp"), part(arrow(a[1], a[0]), "mpr")));
    if (!th.sub) lib.decls.set(th.name, { levelParams: [], type: S });
    return { name: th.name, type: S, value };
  }
  function linear(th) {
    const given = lib.decls.get("LexStmt." + th.name);
    const S = given && given.value ? given.value : statementFromText(th);
    // A closed equation, such as a check over an app's own catalogs `= true`: the kernel evaluates both sides, so
    // the proof is `Eq.refl`. Nothing is unfolded here, where a large catalog would be expensive.
    const [g, a] = spine(S);
    if (g.k === "const" && g.name === "Eq" && a.length === 3 && !hasFVar(S)) {
      lib.decls.set(th.name, { levelParams: [], type: S });
      return { name: th.name, type: S, value: apps(E.const("Eq.refl", g.us), a[0], a[2]) };
    }
    // `rfl` under parameters, for an equation or an equivalence whose two sides are equal by definition: the kernel
    // decides that, once the parameters are bound.
    if (th.script && th.script.length === 1 && th.script[0].kind === "rfl") {
      let body = S; const fvs = [];
      while (body.k === "pi") { const fv = E.fvar(body.name, body.type); fvs.push(fv); body = instantiate(body.body, fv); }
      const [h, xs] = spine(body);
      const proof = h.k === "const" && h.name === "Eq" && xs.length === 3 ? apps(E.const("Eq.refl", h.us), xs[0], xs[1])
        : h.k === "const" && h.name === "Iff" && xs.length === 2 ? apps(c0("Iff.refl"), xs[0]) : null;
      if (proof) {
        const value = fvs.reduceRight((v, fv) => E.lam(fv.name, fv.type, abstract(v, fv)), proof);
        lib.decls.set(th.name, { levelParams: [], type: S });
        return { name: th.name, type: S, value };
      }
    }
    { const r = substitute(th.name, S); if (r) { lib.decls.set(th.name, { levelParams: [], type: S }); return { name: th.name, type: S, value: r.value }; } }
    { const parts = decompose(th, S); if (parts) return parts; }
    return compile(th, S);
  }

  function closeOver(th, locals, type, value) {
    // Binder i becomes de Bruijn index (count - 1 - i) at the body, one pass for all of them.
    const fvs = th.binders.map(([x]) => locals.get(x)), pos = new Map(fvs.map((fv, i) => [fv, i]));
    const under = (e, count) => map(e, (n, d) => n.k === "fvar" && pos.has(n) && pos.get(n) < count ? E.bvar(d + count - 1 - pos.get(n)) : null);
    type = under(type, fvs.length); value = under(value, fvs.length);
    for (let i = fvs.length - 1; i >= 0; i--) {
      const ty = under(fvs[i].type, i);
      type = E.pi(fvs[i].name, ty, type); value = E.lam(fvs[i].name, ty, value);
    }
    lib.decls.set(th.name, { levelParams: [], type });
    return { name: th.name, type, value };
  }

  function theorem(th) {
    // LexLean lowers its linear_arithmetic form to a fixed script that ends in `all_goals omega`.
    const last = th.script[th.script.length - 1];
    if (lib.decls.has("LexStmt." + th.name) || (last && (last.kind === "linear_arithmetic" || last.kind === "all_goals" || last.kind === "decide"))) return linear(th);
    const locals = new Map();
    for (const [x, ty] of th.binders) locals.set(x, E.fvar(x, inst(elab(ty, locals))));
    const statement = inst(elab(th.type, locals));
    const root = E.mvar(statement);
    const goals = [root];
    const close = (g, proof) => eassign.set(g.id, proof);
    for (const tac of th.script) {
      const g = goals.shift() || fail("no goal left");
      const G = inst(g.type);
      if (tac.kind === "rfl") {
        const eq = asEq(G) || fail("rfl: the goal is not an equation");
        close(g, full("Eq.refl", [eq.T, eq.a]));
      } else if (tac.kind === "exact") {
        const p = elab(tac.term, locals);
        try { unify(infer(p), G); } catch { /* the kernel decides */ }
        close(g, p);
      } else if (tac.kind === "constructor") {
        const A = G.fn && G.fn.arg, B = G.arg, c = G.fn && G.fn.fn;
        if (!c || c.name !== "And") fail("unsupported: constructor on a goal that is not And");
        const ga = E.mvar(A), gb = E.mvar(B);
        close(g, full("And.intro", [A, B, ga, gb])); goals.unshift(ga, gb);
      } else if (tac.kind === "rw") {
        let cur = g, curG = G;
        for (const rule of tac.rules) {
          let h = inst(elab(rule.term, locals));
          let { T, a: l, b: r } = asEq(beta(inst(infer(h)))) || fail("rw: the rule is not an equation");
          if (rule.rev) { h = inst(full("Eq.symm", [T, l, r, h])); [l, r] = [r, l]; }
          const body = abstract(curG, l);
          if (body === curG) fail("rw: the pattern does not occur");
          const next = instantiate(body, r), ng = E.mvar(next);
          const step = full("congrArg", [T, Prop(), l, r, E.lam("_a", T, body), h]);
          close(cur, full("Eq.mpr", [curG, next, step, ng]));
          cur = ng; curG = next;
        }
        const eq = asEq(curG);
        if (eq && eq.a === eq.b) close(cur, full("Eq.refl", [eq.T, eq.a])); else goals.unshift(cur);
      } else fail(`unsupported proof form: ${tac.kind}`);
    }
    if (goals.length) fail("goals remain");
    return closeOver(th, locals, statement, inst(root));
  }

  // ---------- writing lines that continue the library's file ----------
  const out = [];
  let nIn = lib.maxIn, nIl = lib.maxIl, nIe = lib.maxIe;
  // The parsed library is read-only while writing: each emitter keeps its own overlay of what it adds.
  const newName = new Map(), newLevel = new Map(), newExpr = new Map();
  function nameIx(full) {
    if (lib.nameIx.has(full)) return lib.nameIx.get(full);
    if (newName.has(full)) return newName.get(full);
    const cut = full.lastIndexOf("."), pre = cut < 0 ? 0 : nameIx(full.slice(0, cut)), ix = ++nIn;
    out.push(JSON.stringify({ in: ix, str: { pre, str: full.slice(cut + 1) } })); newName.set(full, ix); return ix;
  }
  function levelIx(l) {
    if (lib.levelIx.has(l.key)) return lib.levelIx.get(l.key);
    if (newLevel.has(l.key)) return newLevel.get(l.key);
    if (l.k === "lmvar") fail("an unsolved universe level");
    const o = l.k === "succ" ? { succ: levelIx(l.l) } : l.k === "max" ? { max: [levelIx(l.a), levelIx(l.b)] } : l.k === "imax" ? { imax: [levelIx(l.a), levelIx(l.b)] } : { param: nameIx(l.name) };
    const ix = ++nIl; out.push(JSON.stringify({ il: ix, ...o })); newLevel.set(l.key, ix); return ix;
  }
  function exprIx(e) {
    if (lib.exprIx.has(e.key)) return lib.exprIx.get(e.key);
    if (newExpr.has(e)) return newExpr.get(e);
    let o;
    switch (e.k) {
      case "bvar": o = { bvar: e.i }; break;
      case "sort": o = { sort: levelIx(e.l) }; break;
      case "const": o = { const: { name: nameIx(e.name), us: e.us.map(levelIx) } }; break;
      case "app": o = { app: { fn: exprIx(e.fn), arg: exprIx(e.arg) } }; break;
      case "lam": o = { lam: { name: nameIx(e.name), type: exprIx(e.type), body: exprIx(e.body), binderInfo: e.bi } }; break;
      case "pi": o = { forallE: { name: nameIx(e.name), type: exprIx(e.type), body: exprIx(e.body), binderInfo: e.bi } }; break;
      case "nat": o = { natVal: String(e.n) }; break;
      case "str": o = { strVal: e.s }; break;
      case "let": o = { letE: { name: nameIx(e.name), type: exprIx(e.type), value: exprIx(e.value), body: exprIx(e.body), nondep: false } }; break;
      case "proj": o = { proj: { typeName: nameIx(e.typeName), idx: e.idx, struct: exprIx(e.struct) } }; break;
      default: fail(`cannot write ${e.k}: an unsolved goal or a local escaped`);
    }
    const ix = ++nIe; out.push(JSON.stringify({ ie: ix, ...o })); newExpr.set(e, ix); return ix;
  }
  function write(t) {
    const name = nameIx(t.name), type = exprIx(t.type), value = exprIx(t.value);
    out.push(JSON.stringify({ thm: { all: [name], levelParams: [], name, type, value } }));
  }
  // A definition, for declarations lowered from a LexLean model (src/lower.mjs). Hints only steer the kernel's
  // unfolding; they never decide what it accepts.
  function writeDef(t) {
    const name = nameIx(t.name), type = exprIx(t.type), value = exprIx(t.value);
    const levels = t.levelParams ?? [];
    out.push(JSON.stringify({ def: { all: [name], hints: t.hints ?? "abbrev", levelParams: levels.map(nameIx), name, safety: "safe", type, value } }));
    lib.decls.set(t.name, { levelParams: levels, type: t.type, value: t.value });
  }
  // An inductive type and its constructors, with no recursor: the kernel builds `T.rec` itself when it adds the type.
  function writeInductive(t) {
    const name = nameIx(t.name);
    const ctors = t.ctors.map((c, i) => ({ cidx: i, induct: name, isUnsafe: false, levelParams: [], name: nameIx(c.name), numFields: c.numFields, numParams: t.numParams, type: exprIx(c.type) }));
    out.push(JSON.stringify({ inductive: { ctors, recs: [], types: [{ all: [name], ctors: ctors.map((c) => c.name), isRec: !!t.isRec, isReflexive: false, isUnsafe: false, levelParams: [], name, numIndices: 0, numNested: 0, numParams: t.numParams, type: exprIx(t.type) }] } }));
    lib.decls.set(t.name, { levelParams: [], type: t.type });
    for (const c of t.ctors) lib.decls.set(c.name, { levelParams: [], type: c.type });
    lib.ctors.set(t.name, t.ctors.map((c) => c.name));
  }
  // A declaration's content, independent of its name, of binder names, and of where it sits in a file:
  // library terms by their index (fixed by the library's address), everything else by local number.
  function canon(t) {
    const local = new Map(), nodes = [];
    const go = (e) => {
      const li = lib.exprIx.get(e.key); if (li !== undefined) return "L" + li;
      if (local.has(e)) return local.get(e);
      let r;
      switch (e.k) {
        case "bvar": r = ["b", e.i]; break;
        case "sort": r = ["s", e.l.key]; break;
        case "const": r = ["c", e.name, e.us.map((u) => u.key)]; break;
        case "app": r = ["a", go(e.fn), go(e.arg)]; break;
        case "lam": r = ["l", e.bi, go(e.type), go(e.body)]; break;
        case "pi": r = ["p", e.bi, go(e.type), go(e.body)]; break;
        case "nat": r = ["n", e.n]; break;
        case "str": r = ["z", e.s]; break;
        case "proj": r = ["j", e.typeName, e.idx, go(e.struct)]; break;
        case "let": r = ["t", go(e.type), go(e.value), go(e.body)]; break;
        default: fail("cannot address " + e.k);
      }
      nodes.push(r); local.set(e, nodes.length - 1); return nodes.length - 1;
    };
    return { type: go(t.type), value: go(t.value), nodes };
  }
  // A proof that came from elsewhere is only as good as its statement. This declares, for a theorem `name` already
  // in the file, `LexBind.name : LexStmt.name := name`: the kernel accepts it only if the theorem's type is the
  // statement expected.
  function bind(name) {
    if (!lib.decls.has(name)) fail(`${name} is not in the pack`);
    if (!lib.decls.has("LexStmt." + name)) fail(`no statement is known for ${name}`);
    return { name: "LexBind." + name, type: E.const("LexStmt." + name, []), value: E.const(name, []) };
  }
  // A point to come back to, and the lines written since it. With these, each theorem is written as its own file over
  // the same declarations: checkpoint after the declarations, write a theorem, take its lines, roll back.
  function checkpoint() { return { out: out.length, nIn, nIl, nIe, own: new Set(lib.decls.own.keys()) }; }
  function since(c) { return out.slice(c.out); }
  function rollback(c) {
    out.length = c.out;
    for (const [m, top] of [[newName, c.nIn], [newLevel, c.nIl], [newExpr, c.nIe]]) for (const [k, ix] of m) if (ix > top) m.delete(k);
    nIn = c.nIn; nIl = c.nIl; nIe = c.nIe;
    for (const k of [...lib.decls.own.keys()]) if (!c.own.has(k)) lib.decls.own.delete(k);
  }
  // ---------- proofs LexLean states by their shape (cases, induction, apply, decide) ----------
  // LexLean's SemanticProof says how a theorem is proved; this builds that proof as a term. Each branch is a theorem of
  // its own, proved by the same means (or by the finder), and joined by the type's own eliminator. Nothing here is
  // trusted: the kernel judges every part.
  // The rest (region_check, law, congruence, boolean_reflection) state goals the finder takes as they stand.
  const STRUCTURED = new Set(["cases", "induction", "nested_induction", "apply", "decide", "constructor", "simplify", "region_check", "law", "congruence", "boolean_reflection"]);
  const unfoldOnce = (P) => { const [g, a] = spine(P); const d = g.k === "const" && g.name !== "And" ? lib.decls.get(g.name) : null; return d && d.value && d.levelParams.length === 0 ? beta(apps(d.value, ...a)) : null; };
  const piOpen = (S) => { const fvs = []; let b = S; while (b.k === "pi") { const fv = E.fvar(b.name, b.type); fvs.push(fv); b = instantiate(b.body, fv); } return [fvs, b]; };
  const piClose = (fvs, e) => fvs.reduceRight((acc, fv) => E.pi(fv.name, fv.type, abstract(acc, fv)), e);
  const lamClose = (fvs, e) => fvs.reduceRight((acc, fv) => E.lam(fv.name, fv.type, abstract(acc, fv)), e);
  // A Decidable instance for a closed proposition built from what the kernel can decide by evaluation.
  function decidable(P, depth = 0) {
    if (depth > 64) fail("decide: too deep");
    P = beta(P);
    if (P.k === "pi") {
      let dep = false; map(P.body, (n, d) => { if (n.k === "bvar" && n.i === d) dep = true; return null; });
      if (dep) fail("decide: a quantifier");
      return apps(c0("instDecidableForall"), P.type, P.body, decidable(P.type, depth + 1), decidable(P.body, depth + 1));
    }
    const [g, a] = spine(P);
    if (g.k !== "const") fail("decide: an open proposition");
    const two = (inst) => apps(c0(inst), a[0], a[1], decidable(a[0], depth + 1), decidable(a[1], depth + 1));
    switch (g.name) {
      case "True": return c0("instDecidableTrue");
      case "False": return c0("instDecidableFalse");
      case "And": if (a.length === 2) return two("instDecidableAnd"); break;
      case "Or": if (a.length === 2) return two("instDecidableOr"); break;
      case "Iff": if (a.length === 2) return two("instDecidableIff"); break;
      case "Not": if (a.length === 1) return apps(c0("instDecidableNot"), a[0], decidable(a[0], depth + 1)); break;
      case "Eq": if (a.length === 3) {
        const T = a[0].k === "const" ? a[0].name : null;
        const inst = { Nat: "Nat.decEq", Bool: "instDecidableEqBool", Int: "Int.decEq" }[T];
        if (inst) return apps(c0(inst), a[1], a[2]);
      } break;
      case "LE.le": case "LT.lt": if (a.length === 4 && a[0].k === "const" && (a[0].name === "Nat" || a[0].name === "Int"))
        return apps(c0(`${a[0].name}.dec${g.name === "LE.le" ? "Le" : "Lt"}`), a[2], a[3]); break;
    }
    const d = lib.decls.get(g.name);
    if (d && d.value && d.levelParams.length === 0) return decidable(apps(d.value, ...a), depth + 1); // unfolded: the same proposition
    fail(`decide: ${g.name}`);
  }
  const truth = () => apps(E.const("Eq.refl", [u1]), c0("Bool"), c0("Bool.true"));
  const hasFree = (t) => { let f = false; map(t, (n) => { if (n.k === "fvar") f = true; return null; }); return f; };

  // ---------- case analysis on an equation hypothesis `L = C args` ----------
  // The constructor each constant is, and its type.
  const ownerOf = new Map();
  const ctorOwner = (name) => {
    if (!ownerOf.size) for (const [T, cs] of lib.ctors) for (const c of cs) ownerOf.set(c, T);
    return ownerOf.get(name);
  };
  const ctorHead = (t) => { const [h, a] = spine(t); return h.k === "const" && ctorOwner(h.name) ? { h, a, T: ctorOwner(h.name) } : null; };
  // The head form the kernel reaches by itself, nothing under a binder: a let substituted, this project's definitions
  // unfolded, a casesOn or `if` at a constructor or a literal taken, a pair's part of a pair. A casesOn or `if` it cannot
  // take is left with its scrutinee in head form, which is where a case split goes.
  function whnfH(t, project, fuel = { n: 4000 }) {
    for (;;) {
      if (--fuel.n < 0) return t;
      t = beta(t);
      if (t.k === "let") { t = instantiate(t.body, t.value); continue; }
      const [h, a] = spine(t);
      if (h.k !== "const") return t;
      if (h.name === "ite" && a.length >= 5) {
        const [eq, ea] = spine(a[1]);
        if (eq.k === "const" && eq.name === "Eq" && ea.length === 3 && ea[0] === c0("Bool") && ea[2] === c0("Bool.true")) {
          const b = whnfH(ea[1], project, fuel);
          if (b === c0("Bool.true")) { t = apps(a[3], ...a.slice(5)); continue; }
          if (b === c0("Bool.false")) { t = apps(a[4], ...a.slice(5)); continue; }
        }
        return t;
      }
      if ((h.name === "Prod.fst" || h.name === "Prod.snd") && a.length >= 3) {
        const p = whnfH(a[2], project, fuel), [ph, pa] = spine(p);
        if (ph.k === "const" && ph.name === "Prod.mk" && pa.length === 4) { t = apps(pa[h.name === "Prod.fst" ? 2 : 3], ...a.slice(3)); continue; }
        return apps(h, a[0], a[1], p, ...a.slice(3));
      }
      if (h.name.endsWith(".casesOn")) {
        const T = h.name.slice(0, -8), ctors = lib.ctorsOf(T);
        if (ctors && lib.decls.has(T)) {
          const np = numParamsOf(T), at = np + 1;
          if (a.length >= at + 1 + ctors.length) {
            const m = whnfH(a[at], project, fuel), [ch, ca] = spine(m), i = ch.k === "const" ? ctors.indexOf(ch.name) : -1;
            if (i >= 0) { t = apps(a[at + 1 + i], ...ca.slice(np), ...a.slice(at + 1 + ctors.length)); continue; }
            return apps(h, ...a.slice(0, at), m, ...a.slice(at + 1));
          }
        }
      }
      const d = lib.decls.get(h.name);
      if (d && d.value && d.levelParams.length === 0 && h.name.startsWith(project)) { t = apps(d.value, ...a); continue; }
      return t;
    }
  }
  const sortLevelOf = (ty) => (ty.k === "sort" ? ty.l : u1); // the universe of a type whose type is `ty`, as Eq and congrArg take it
  // For a hypothesis `L = C args` (C a constructor): when L's head form is the other constructor, the goal follows from
  // False; when it is C at other fields, the fields' equations are the new hypotheses; when it is a casesOn or `if` on
  // a scrutinee s, the goal is proved by cases on s, each case keeping `s = case` and the hypothesis at that case.
  function caseHyp(name, S, deps) {
    if ((name.match(/\.case\d/g) || []).length > 8) return null;
    const project = name.split(".")[0] + ".";
    let [fvs, G] = piOpen(S);
    // A goal that is a definition of the project: unfolded, its own hypotheses opened.
    for (let g = whnfH(G, project); g !== G && g.k === "pi"; g = whnfH(G, project)) { const [more, body] = piOpen(g); fvs = [...fvs, ...more]; G = body; }
    // The hypotheses as stated first; a case's own equation only after them, and split again only on a decision.
    const own = (fv) => fv.name.startsWith("split");
    for (const h of [...fvs.filter((fv) => !own(fv)), ...fvs.filter(own)]) {
      const [g, a] = spine(h.type);
      if (!(g.k === "const" && g.name === "Eq" && a.length === 3)) continue;
      const [T, Lraw, Kraw] = a, K = whnfH(Kraw, project), kc = ctorHead(K);
      if (!kc) continue;
      const Lhs = whnfH(Lraw, project), lc = ctorHead(Lhs), rest = fvs.filter((fv) => fv !== h);
      const [TH, Targs] = spine(T);
      if (TH.k !== "const" || TH.name !== kc.T) continue;
      const np = numParamsOf(kc.T), ctors = lib.ctorsOf(kc.T);
      const ctorFields = (cname, us, params) => { const cd = lib.decls.get(cname); let cty = substLevels(cd.type, new Map(cd.levelParams.map((p, i) => [p, us[i]]))); for (const p of params) cty = instantiate(cty.body, p); const out = []; while (cty.k === "pi") { const f = E.fvar("a" + out.length, cty.type); out.push(f); cty = instantiate(cty.body, f); } return out; };
      const casesOn = (level, motive, major, minors) => apps(E.const(`${kc.T}.casesOn`, [level, ...TH.us]), ...Targs, motive, major, ...minors);
      if (lc && lc.T === kc.T) {
        if (lc.h.name !== kc.h.name) {
          // Different constructors: P e is True at L's constructor and False elsewhere, so P K, which is False.
          const e = E.fvar("e", T);
          const P = E.lam("e", T, abstract(casesOn(u1, E.lam("_", T, E.sort(L.zero)), e, ctors.map((cn) => lamClose(ctorFields(cn, TH.us, Targs), c0(cn === lc.h.name ? "True" : "False")))), e));
          const along = apps(E.const("congrArg", [sortLevelOf(infer(T)), u1]), T, E.sort(L.zero), Lraw, Kraw, P, h);
          const no = apps(E.const("Eq.mp", [L.zero]), E.app(P, Lraw), E.app(P, Kraw), along, c0("True.intro"));
          return { value: lamClose(fvs, apps(E.const("False.elim", [L.zero]), G, no)) };
        }
        // The same constructor: each field that differs is equal to K's, by congrArg of its selector.
        const lf = lc.a.slice(np), kf = kc.a.slice(np), eqs = [], proofs = [];
        const fieldTys = ctorFields(kc.h.name, TH.us, Targs).map((f) => f.type);
        lf.forEach((x, j) => {
          if (x === kf[j]) return;
          const e = E.fvar("e", T), ty = fieldTys[j];
          const pick = E.lam("e", T, abstract(casesOn(sortLevelOf(infer(ty)), E.lam("_", T, ty), e, ctors.map((cn) => { const fs = ctorFields(cn, TH.us, Targs); return lamClose(fs, cn === kc.h.name ? fs[j] : kf[j]); })), e));
          eqs.push(E.fvar(`split_inj${j}`, apps(E.const("Eq", [sortLevelOf(infer(ty))]), ty, x, kf[j])));
          proofs.push(apps(E.const("congrArg", [sortLevelOf(infer(T)), sortLevelOf(infer(ty))]), T, ty, Lraw, Kraw, pick, h));
        });
        if (!eqs.length) continue;
        const c = partTheorem(`${name}.inj`, piClose([...rest, ...eqs], G), null, deps);
        return { value: lamClose(fvs, apps(c, ...rest, ...proofs)) };
      }
      // A case split on the scrutinee of L's head casesOn, or of its `if`'s Boolean.
      const [lh, la] = spine(Lhs);
      if (lh.k !== "const") continue;
      if (own(h) && lh.name !== "ite" && lh.name !== "Bool.casesOn") continue;
      let s, sT, sOwner, sUs, sArgs;
      if (lh.name === "ite" && la.length >= 5) {
        const [, ea] = spine(la[1]); if (ea.length !== 3) continue;
        s = ea[1]; sT = c0("Bool"); sOwner = "Bool"; sUs = []; sArgs = [];
      } else if (lh.name.endsWith(".casesOn") && lib.ctorsOf(lh.name.slice(0, -8))) {
        sOwner = lh.name.slice(0, -8); const snp = numParamsOf(sOwner);
        s = la[snp + 1]; sUs = lh.us.slice(1); sArgs = la.slice(0, snp); sT = apps(E.const(sOwner, sUs), ...sArgs);
      } else continue;
      if (ctorHead(s)) continue;
      const z = E.fvar("z", sT), occurs = (x) => (n) => (n === x ? z : null);
      const Lz = map(Lhs, occurs(s));
      if (Lz === Lhs) continue; // the scrutinee is not where the split would see it
      const eqS = (rhs) => apps(E.const("Eq", [sortLevelOf(infer(sT))]), sT, s, rhs), eqL = (lhs) => apps(E.const("Eq", g.us), T, lhs, Kraw);
      const motive = E.lam("z", sT, abstract(E.pi("split", eqS(z), E.pi("h", eqL(Lz), G)), z));
      const k = (name.match(/\.case\d/g) || []).length;
      const minors = lib.ctorsOf(sOwner).map((cn, i) => {
        const fs = ctorFields(cn, sUs, sArgs), built = apps(E.const(cn, sUs), ...sArgs, ...fs);
        const hs = E.fvar("split", eqS(built)), hi = E.fvar("h", eqL(map(Lz, (n) => (n === z ? built : null))));
        const c = partTheorem(`${name}.case${k}_${i}`, piClose([...rest, ...fs, hs, hi], G), null, deps);
        return lamClose([...fs, hs, hi], apps(c, ...rest, ...fs, hs, hi));
      });
      const split = apps(E.const(`${sOwner}.casesOn`, [L.zero, ...sUs]), ...sArgs, motive, s, ...minors);
      return { value: lamClose(fvs, apps(split, apps(E.const("Eq.refl", [sortLevelOf(infer(sT))]), sT, s), h)) };
    }
    return null;
  }
  // A part, written as its own theorem before the whole; returns its constant.
  function partTheorem(name, S, proof, deps) {
    const r = prove(name, S, proof, deps);
    write({ name, type: S, value: r.value }); lib.decls.set(name, { levelParams: [], type: S });
    return c0(name);
  }
  function prove(name, S, proof, deps) {
    const kind = proof?.kind;
    const viaFinder = () => { const th = { name, sub: true }; return substitute(name, S) ?? caseHyp(name, S, deps) ?? decompose(th, S) ?? compile(th, S); };
    if (kind === "decide" && !hasFree(S)) {
      // A closed proposition: the kernel evaluates `decide S`. Under binders it is the finder's.
      const [fvs, body] = piOpen(S);
      if (!fvs.length) { try { return { value: apps(c0("of_decide_eq_true"), S, decidable(S), truth()) }; } catch { /* the finder */ } }
      else { try { return { value: apps(c0("of_decide_eq_true"), S, decidable(S), truth()) }; } catch { void body; } }
      return viaFinder();
    }
    if (kind === "reflexivity") {
      const [fvs, body] = piOpen(S), [g, a] = spine(body);
      if (g.k === "const" && g.name === "Eq" && a.length === 3) return { value: lamClose(fvs, apps(E.const("Eq.refl", g.us), a[0], a[1])) };
      return viaFinder();
    }
    if (kind === "simplify") { try { return simplify(S); } catch { return viaFinder(); } }
    if (kind === "apply" && proof.arguments.some((x) => !["var", "first", "second"].includes(x.kind))) return viaFinder(); // term arguments: the statement itself
    if (kind === "apply") {
      const [fvs] = piOpen(S), parts = name.split(".");
      // The theorem in the named module, or in the nearest enclosing namespace that states it (a part's name is
      // its theorem's name and more).
      const stmt = (n) => lib.decls.get(n)?.type ?? lib.decls.get("LexStmt." + n)?.value;
      let target = `${parts[0]}.${proof.theorem.module}.${proof.theorem.name}`;
      if (!proof.theorem.module) for (let k = parts.length - 1; k > 0; k--) { target = `${parts.slice(0, k).join(".")}.${proof.theorem.name}`; if (stmt(target)) break; }
      const stated = lib.decls.get(target)?.type ?? lib.decls.get("LexStmt." + target)?.value;
      if (!stated) return viaFinder(); // a theorem LexLean generates and does not state here: the statement itself
      deps.add(target);
      const byName = new Map(fvs.map((fv) => [fv.name, fv])), used = new Set();
      const arg = (x) => {
        if (x.kind === "var") { const fv = byName.get(x.name) ?? fail(`apply: no variable ${x.name}`); used.add(fv); return fv; }
        if (x.kind === "first" || x.kind === "second") {
          const v = arg(x.value), [h, ab] = spine(v.k === "fvar" ? v.type : fail("apply: a projection of a term"));
          if (h.k !== "const" || h.name !== "Prod") fail("apply: a projection of a non-pair");
          return apps(E.const(x.kind === "first" ? "Prod.fst" : "Prod.snd", h.us), ab[0], ab[1], v);
        }
        return fail(`apply: an argument of kind ${x.kind}`);
      };
      const args = proof.arguments.map(arg);
      let t = apps(c0(target), ...args), ty = stated;
      for (const arg of args) ty = ty.k === "pi" ? instantiate(ty.body, arg) : fail("apply: too many arguments");
      const rest = fvs.filter((fv) => !used.has(fv));
      while (ty.k === "pi") { const h = rest.shift() ?? fail("apply: a premise with no hypothesis"); t = E.app(t, h); ty = instantiate(ty.body, h); }
      return { value: lamClose(fvs, t) };
    }
    if (kind === "constructor") {
      // A conjunction, each side by its own branch, under the same parameters.
      const [fvs, body0] = piOpen(S);
      let body = body0;
      for (let u = unfoldOnce(body); u; u = unfoldOnce(body)) { const [g] = spine(body); if (g.k === "const" && g.name === "And") break; body = u; }
      const [g, a] = spine(body);
      if (!(g.k === "const" && g.name === "And" && a.length === 2) || proof.branches.length !== 2) return viaFinder();
      const sides = a.map((P, i) => apps(partTheorem(`${name}.${i ? "right" : "left"}`, piClose(fvs, P), proof.branches[i], deps), ...fvs));
      return { value: lamClose(fvs, apps(c0("And.intro"), a[0], a[1], ...sides)) };
    }
    if (kind === "cases" || kind === "induction") {
      // Π before. Π x:T. R  =>  λ before x. T.casesOn params (λ x. R) x minors  (T.rec with the major last, for induction).
      const before = []; let rest = S;
      while (rest.k === "pi" && rest.name !== proof.scrutinee) { const fv = E.fvar(rest.name, rest.type); before.push(fv); rest = instantiate(rest.body, fv); }
      if (rest.k !== "pi") fail(`${kind}: no binder ${proof.scrutinee}`);
      const [T, params] = spine(rest.type);
      if (T.k !== "const") fail(`${kind}: the scrutinee's type is not an inductive`);
      const x = E.fvar(rest.name, rest.type), motive = E.lam(rest.name, rest.type, rest.body);
      const ctors = lib.ctorsOf(T.name) ?? fail(`${kind}: ${T.name} is not a known inductive`);
      const minors = ctors.map((cname) => {
        const short = cname.slice(T.name.length + 1), branch = proof.branches.find((b) => b.constructor === short) ?? fail(`${kind}: no branch for ${short}`);
        const cd = lib.decls.get(cname); let cty = substLevels(cd.type, new Map(cd.levelParams.map((p, i) => [p, T.us[i]]))); for (const p of params) cty = instantiate(cty.body, p);
        const fields = [], recs = [];
        while (cty.k === "pi") { const f = E.fvar(branch.binders[fields.length] ?? "a" + fields.length, cty.type); fields.push(f); if (spine(cty.type)[0].k === "const" && spine(cty.type)[0].name === T.name) recs.push(f); cty = instantiate(cty.body, f); }
        const built = apps(E.const(cname, T.us), ...params, ...fields);
        const ihs = kind === "induction" ? recs.map((f, i) => E.fvar(branch.binders[fields.length + i] ?? "ih", beta(E.app(motive, f)))) : [];
        const Si = piClose([...before, ...fields, ...ihs], beta(E.app(motive, built)));
        const c = partTheorem(`${name}.${short}`, Si, branch.proof, deps);
        return lamClose([...fields, ...ihs], apps(c, ...before, ...fields, ...ihs));
      });
      const elim = E.const(`${T.name}.${kind === "cases" ? "casesOn" : "rec"}`, [L.zero, ...T.us]);
      const body = kind === "cases" ? apps(elim, ...params, motive, x, ...minors) : apps(elim, ...params, motive, ...minors, x);
      return { value: lamClose([...before, x], body) };
    }
    if (kind === "nested_induction") {
      // One recursor over the family: the statement's motive for the type, and for each nested member the motive
      // LexLean declares as `LexStmt.T.<binder>`; a minor for every constructor of every member, its proof its branch's.
      const before = []; let rest = S;
      while (rest.k === "pi" && rest.name !== proof.scrutinee) { const fv = E.fvar(rest.name, rest.type); before.push(fv); rest = instantiate(rest.body, fv); }
      if (rest.k !== "pi") fail(`nested_induction: no binder ${proof.scrutinee}`);
      const [T, params] = spine(rest.type);
      if (T.k !== "const") fail("nested_induction: the scrutinee's type is not an inductive");
      const x = E.fvar(rest.name, rest.type), motives = [E.lam(rest.name, rest.type, rest.body)], memberTys = [rest.type];
      for (const m of proof.members) {
        let t = lib.decls.get(`LexStmt.${name}.${m.binder}`)?.value ?? fail(`nested_induction: no statement for member ${m.binder}`);
        for (const b of before) t = t.k === "pi" ? instantiate(t.body, b) : fail("nested_induction: a member statement's parameters");
        if (t.k !== "pi") fail("nested_induction: a member statement without its binder");
        motives.push(E.lam(t.name, t.type, t.body)); memberTys.push(t.type);
      }
      const branchesOf = [proof.branches, ...proof.members.map((m) => m.branches)], minors = [];
      memberTys.forEach((mty, mi) => {
        const [MT, mparams] = spine(mty);
        const ctors = (MT.k === "const" && lib.ctorsOf(MT.name)) || fail("nested_induction: a member that is not an inductive");
        for (const cname of ctors) {
          const short = cname.slice(MT.name.length + 1), branch = branchesOf[mi].find((b) => b.constructor === short) ?? fail(`nested_induction: no branch for ${short}`);
          const cd = lib.decls.get(cname); let cty = substLevels(cd.type, new Map(cd.levelParams.map((p, i) => [p, MT.us[i]]))); for (const p of mparams) cty = instantiate(cty.body, p);
          const fields = [], recs = [];
          while (cty.k === "pi") { const f = E.fvar(branch.binders[fields.length] ?? "a" + fields.length, cty.type); fields.push(f); const k = memberTys.indexOf(cty.type); if (k >= 0) recs.push([f, k]); cty = instantiate(cty.body, f); }
          const built = apps(E.const(cname, MT.us), ...mparams, ...fields);
          const ihs = recs.map(([f, k], i) => E.fvar(branch.binders[fields.length + i] ?? "ih" + i, beta(E.app(motives[k], f))));
          const Si = piClose([...before, ...fields, ...ihs], beta(E.app(motives[mi], built)));
          const c = partTheorem(`${name}.m${mi}.${short}`, Si, branch.proof, deps);
          minors.push(lamClose([...fields, ...ihs], apps(c, ...before, ...fields, ...ihs)));
        }
      });
      return { value: lamClose([...before, x], apps(E.const(`${T.name}.rec`, [L.zero, ...T.us]), ...params, ...motives, ...minors, x)) };
    }
    return viaFinder();
  }
  // A hypothesis `x = t`, x a parameter of a model's own type: the goal is proved with t for x, and carried back along
  // the equation (congrArg of the goal as a function of x). Hypotheses that mention x are carried forward the same way.
  function substitute(name, S) {
    const [fvs, body] = piOpen(S);
    for (const h of fvs) {
      const [g, a] = spine(h.type);
      if (!(g.k === "const" && g.name === "Eq" && a.length === 3 && a[0].k === "const" && !["Nat", "Int", "Bool"].includes(a[0].name) && lib.ctorsOf(a[0].name))) continue;
      const occurs = (x, e) => { let f = false; map(e, (n) => { if (n === x) f = true; return null; }); return f; };
      let x, t, heq;
      if (a[1].k === "fvar" && fvs.includes(a[1]) && !occurs(a[1], a[2])) { x = a[1]; t = a[2]; heq = h; }
      else if (a[2].k === "fvar" && fvs.includes(a[2]) && !occurs(a[2], a[1])) { x = a[2]; t = a[1]; heq = apps(E.const("Eq.symm", g.us), a[0], a[1], a[2], h); }
      else continue;
      const T = a[0], put = (e) => map(e, (n) => (n === x ? t : null));
      const along = (P) => apps(E.const("congrArg", [u1, u1]), T, E.sort(L.zero), x, t, E.lam("z", T, abstract(P, x)), heq);
      const kept = fvs.filter((fv) => fv !== h), moved = kept.map((fv) => fv !== x && occurs(x, fv.type) ? E.fvar(fv.name, put(fv.type)) : fv);
      const S2 = piClose(moved, put(body));
      const c = partTheorem(`${name}.subst`, S2, null, new Set());
      const args = kept.map((fv, i) => moved[i] === fv ? fv : apps(E.const("Eq.mp", [L.zero]), fv.type, moved[i].type, along(fv.type), fv));
      return { value: lamClose(fvs, apps(E.const("Eq.mpr", [L.zero]), body, put(body), along(body), apps(c, ...args))) };
    }
    return null;
  }
  // ---------- simplify: unfold, reduce, rewrite with the hypotheses, then reflexivity ----------
  // The kernel's own reductions, written out so the hypotheses can be found in the result: a model's definitions
  // unfolded, beta, a recursor at a constructor (iota), a projection of a constructor.
  const numParamsOf = (T) => { const d = lib.decls.get(T); let n = 0; for (let t = d?.type; t && t.k === "pi"; t = t.body) n++; return n; };
  function reduce(t, fuel = { n: 20000 }) {
    if (--fuel.n < 0) fail("simplify: the reduction does not end");
    t = beta(t);
    if (t.k === "proj") {
      const s = reduce(t.struct, fuel), [h, a] = spine(s), np = numParamsOf(t.typeName);
      if (h.k === "const" && lib.ctorsOf(t.typeName)?.includes(h.name) && a.length > np + t.idx) return reduce(a[np + t.idx], fuel);
      return E.proj(t.typeName, t.idx, s);
    }
    if (t.k === "app" || t.k === "const") {
      const [h, a] = spine(t);
      if (h.k === "const") {
        if (/\.rec(_\d+)?$/.test(h.name)) { const r = familyIota(h, a, (x) => reduce(x, fuel)); if (r) return reduce(r, fuel); }
        if (h.name.endsWith(".rec")) {
          const T = h.name.slice(0, -4), ctors = lib.ctorsOf(T);
          if (ctors) {
            const np = numParamsOf(T), mi = np + 1, major = mi + ctors.length;
            if (a.length > major) {
              const m = reduce(a[major], fuel), [ch, ca] = spine(m), i = ch.k === "const" ? ctors.indexOf(ch.name) : -1;
              if (i >= 0) {
                const cd = lib.decls.get(ch.name); let cty = substLevels(cd.type, new Map(cd.levelParams.map((p, j) => [p, h.us[j + 1] ?? L.zero])));
                const fields = ca.slice(np), recs = [];
                for (const p of ca.slice(0, np)) cty = instantiate(cty.body, p);
                for (const f of fields) { const [fh] = spine(cty.type); if (fh.k === "const" && fh.name === T) recs.push(apps(h, ...a.slice(0, major), f)); cty = instantiate(cty.body, f); }
                return reduce(apps(a[mi + i], ...fields, ...recs, ...a.slice(major + 1)), fuel);
              }
            }
          }
        }
        const d = lib.decls.get(h.name);
        // A model's own definitions (and its casesOn), and the runtime's: unfolded. Anything else is left as it stands.
        const own = d && d.value && (h.name.startsWith(lib.project ?? "\u0000") || h.name.startsWith("LexLeanRuntime.") || h.name.startsWith("LexLeanCollections."));
        if (own) return reduce(apps(substLevels(d.value, new Map(d.levelParams.map((p, j) => [p, h.us[j]]))), ...a), fuel);
        return apps(h, ...a.map((x) => reduce(x, fuel)));
      }
      return apps(reduce(h, fuel), ...a.map((x) => reduce(x, fuel)));
    }
    return t;
  }
  const replaceAll = (e, from, to) => map(e, (n) => (n === from ? to : null));
  function simplify(S) {
    const [fvs, body] = piOpen(S), [g, a] = spine(body);
    if (!(g.k === "const" && g.name === "Eq" && a.length === 3)) fail("simplify: the goal is not an equation");
    const eqs = fvs.map((h) => [h, spine(h.type)]).filter(([, [hg, ha]]) => hg.k === "const" && hg.name === "Eq" && ha.length === 3).map(([h, [, ha]]) => ({ h, T: ha[0], l: reduce(ha[1]), r: reduce(ha[2]), lRaw: ha[1], rRaw: ha[2] }));
    let L0 = reduce(a[1]), R0 = reduce(a[2]);
    // Each rewrite: the goal `L = R` from `L[l:=r] = R[l:=r]`, by Eq.mpr along congrArg of the goal as a function of l.
    const steps = [];
    for (let changed = true; changed && L0 !== R0; ) {
      changed = false;
      for (const q of eqs) {
        let hit = false; map(E.app(L0, R0), (n) => { if (n === q.l) hit = true; return null; });
        if (!hit) continue;
        const z = E.fvar("z", q.T), G = (x, y) => apps(E.const("Eq", g.us), a[0], x, y);
        steps.push({ q, motive: E.lam("z", q.T, abstract(G(replaceAll(L0, q.l, z), replaceAll(R0, q.l, z)), z)), before: G(L0, R0) });
        L0 = replaceAll(L0, q.l, q.r); R0 = replaceAll(R0, q.l, q.r); changed = true;
      }
    }
    if (L0 !== R0) fail("simplify: the sides differ after rewriting");
    let proof = apps(E.const("Eq.refl", g.us), a[0], L0);
    for (let i = steps.length - 1; i >= 0; i--) {
      const { q, motive, before } = steps[i], after = beta(E.app(motive, q.r));
      // The hypothesis states lRaw = rRaw; congrArg at those, which the kernel takes for l = r by reduction.
      const along = apps(E.const("congrArg", [u1, u1]), q.T, E.sort(L.zero), q.lRaw, q.rRaw, motive, q.h);
      proof = apps(E.const("Eq.mpr", [L.zero]), before, after, along, proof);
    }
    return { value: lamClose(fvs, proof) };
  }
  // A theorem LexLean states as `LexStmt.<name>`, proved by the shape its SemanticProof gives.
  function structured(name, proof) {
    const given = lib.decls.get("LexStmt." + name);
    if (!given || !given.value) fail(`no statement for ${name}`);
    lib.project = name.split(".")[0] + ".";
    const S = given.value, deps = new Set(), r = prove(name, S, proof, deps);
    lib.decls.set(name, { levelParams: [], type: S });
    return { name, type: S, value: r.value, deps: [...deps] };
  }
  return { theorem, structured, STRUCTURED, write, writeDef, writeInductive, canon, bind, lib, checkpoint, since, rollback, lines: () => out.join("\n") + "\n" };
}

// ---------- reading the generated Lean ----------
function term(src) {
  const toks = src.match(/[()\[\],]|←|[^\s()\[\],←]+/g) || [];
  let i = 0;
  const atom = () => { const t = toks[i++]; if (t !== "(") return t; const inner = app(); i++; return inner; };
  const app = () => { const xs = []; while (i < toks.length && toks[i] !== ")") xs.push(atom()); return xs.length === 1 && !Array.isArray(xs[0]) ? [xs[0]] : xs.length === 1 ? xs[0] : xs; };
  return app();
}
export function readModule(text) {
  const ns = /^namespace (\S+)/m.exec(text)[1];
  const theorems = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:public )?theorem (\S+) (.*) := by$/.exec(lines[i]);
    if (!m) continue;
    let sig = m[2]; const binders = [];
    for (let b; (b = /^\((\S+) : ([^()]+)\) /.exec(sig)); sig = sig.slice(b[0].length)) binders.push([b[1], term(b[2])]);
    const script = [], body = [];
    for (i++; i < lines.length && lines[i].startsWith("  "); i++) {
      const l = lines[i].trim(); body.push(l);
      if (l === "rfl" || l === "constructor") script.push({ kind: l });
      else if (l.startsWith("exact ")) script.push({ kind: "exact", term: term(l.slice(6)) });
      else if (l.startsWith("rw [")) script.push({ kind: "rw", rules: l.slice(4, -1).split(", ").map((r) => ({ rev: r.startsWith("←"), term: term(r.replace(/^←\s*/, "")) })) });
      else script.push({ kind: l.split(" ")[0] });
    }
    const raw = sig.replace(/^: /, "");
    // `text` is everything that decides the proof except the theorem's own name.
    theorems.push({ name: `${ns}.${m[1]}`, ns, text: m[2] + "\n" + body.join("\n"), binders, raw, get type() { return term(raw); }, script });
  }
  return theorems;
}

/** A theorem record that crossed a thread boundary lost its lazy `type`; this puts it back. */
export { E, L, apps, abstract, instantiate };
export function revive(th) { return Object.defineProperty(th, "type", { get() { return term(th.raw); }, configurable: true }); }
