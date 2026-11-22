// A model's proving work, as independent batches for any number of kernels.
//
// The model is lowered once and its declarations written once. From that point, any set of theorems is written as one
// file that continues the base library: the declarations, then those theorems' proofs. Files for different batches
// share nothing but the declarations, so kernels can judge them at the same time. Each theorem carries its Merkle key
// (lower.mjs), so a caller that has judged it before under that key need not write it at all.
//
//   const p = plan(snapshot, library, { hash });
//   p.theorems           -> [{ name, key, proof, declared, status }]; status is set when it is not to be judged here
//   p.batches(names, n, cost) -> at most n groups of names, slowest first into the lightest group
//   p.file(names)        -> the text a kernel judges for those theorems (check_suffix over the base library)
import { emitter } from "./emit.mjs";
import { lower } from "./lower.mjs";

// LexLean's proof kinds the proof finder covers, by the name it knows them by.
export const COVERED = Object.freeze({ linear_arithmetic: "linear_arithmetic", decide: "decide", reflexivity: "rfl", simplify: "simplify" });

export function plan(snapshot, library, { hash = null } = {}) {
  const em = emitter(library);
  const lowered = lower(snapshot, em, { hash });
  const declarations = em.lines(), mark = em.checkpoint();
  const byName = new Map(lowered.theorems.map((th) => [th.name, th]));
  const theorems = lowered.theorems.map((th) => ({
    name: th.name, key: th.key, proof: th.proof, declared: [...th.axioms].sort(),
    status: COVERED[th.proof] ? null : `not proved: the proof kind ${th.proof} is not covered here yet`,
  }));
  // Each proof is found once, here, so a batch is never one that cannot be written.
  for (const t of theorems) {
    if (t.status) continue;
    try { em.theorem(script(byName.get(t.name))); } catch (e) { t.status = `not proved: no proof found (${e.message})`; }
    em.rollback(mark);
  }
  return {
    theorems, declarations: lowered.declared.length, recursive: lowered.recursive.length, bytes: declarations.length,
    // Slowest first into the lightest group: within 4/3 of the best split. `cost(key)` is a theorem's last judging time
    // in milliseconds; without one, a theorem counts a millisecond for each declaration it reaches.
    batches(names, n, cost = () => null) {
      const costOf = (name) => cost(byName.get(name).key) ?? byName.get(name).weight;
      const sorted = [...names].sort((a, b) => costOf(b) - costOf(a));
      const groups = Array.from({ length: Math.max(1, Math.min(n, sorted.length)) }, () => ({ names: [], load: 0 }));
      for (const name of sorted) { const g = groups.reduce((a, b) => (b.load < a.load ? b : a)); g.names.push(name); g.load += costOf(name); }
      return groups.filter((g) => g.names.length).map((g) => g.names);
    },
    file(names) {
      for (const n of names) em.write(em.theorem(script(byName.get(n))));
      const proofs = em.since(mark), text = declarations + (proofs.length ? proofs.join("\n") + "\n" : "");
      em.rollback(mark);
      return text;
    },
  };
}

const script = (th) => ({ name: th.name, ns: th.name.slice(0, th.name.lastIndexOf(".")), script: [{ kind: COVERED[th.proof] }], binders: [], raw: "", text: "" });
