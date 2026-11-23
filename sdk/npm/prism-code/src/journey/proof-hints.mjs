/**
 * What an author needs when Lean's kernel does not prove a theorem: where the model states it, and what to try.
 * From the model's own text and the kernel's own status, and nothing else: it changes no verdict, it only adds to
 * what the author sees. No import, so the command line and a page both use it (build-core.mjs, model-cli.mjs).
 */

const text = (content) => (typeof content === 'string' ? content : new TextDecoder().decode(content));

/**
 * Where the model states the theorem `name`: `{ file, line }` of its `name:` member, or nulls when no file states it.
 * `files` is a Map, pairs or an object of path to content, text or bytes; `name` may be qualified (`Module.name`).
 */
export function theoremPlace(files, name) {
  const pairs = files instanceof Map ? [...files] : Array.isArray(files) ? files : Object.entries(files ?? {});
  const bare = String(name).split(/[.:]/).pop();
  for (const [file, content] of pairs) {
    if (!String(file).endsWith('.lex.tex')) continue;
    const lines = text(content).split(/\r?\n/);
    const at = lines.findIndex((l, i) => /^\s*name:/.test(l) && l.replace(/^\s*name:\s*/, '').replace(/\s*,?\s*$/, '') === bare && /^\s*theorem\{/.test(lines[i - 1] ?? ''));
    if (at >= 0) return { file, line: at + 1 };
  }
  return { file: null, line: null };
}

/** What to try when the kernel finds no proof, by what it said: the forms it covers, never a weaker theorem. */
export function proofRemedy(status) {
  const keep = 'Repair the definition or the theorem in the model; never weaken the theorem to make it pass.';
  if (/unsupported: this form of goal/.test(status)) return `The kernel's search does not cover this statement's form. State it as a breaks definition equal to false, ((breaksName …) = false), and prove it by linear_arithmetic. ${keep}`;
  if (/no certificate found/.test(status)) return `No proof was found: either the theorem is false of the model, or the search cannot see it. List every definition the proof unfolds, and give the theorem Nat parameters (1 and 0 for a Bool), which the search covers. ${keep}`;
  return keep;
}

/**
 * The theorems a prover judged, each one that is not proved given `place`, `{ file, line }`, and `remedy`. A proved
 * theorem is returned as it was; so is anything that is not a list.
 */
export function withProofHints(theorems, files) {
  if (!Array.isArray(theorems)) return theorems;
  return theorems.map((t) => (String(t.status).startsWith('proved') ? t : { ...t, place: theoremPlace(files, t.qualified ?? t.theorem), remedy: proofRemedy(String(t.status)) }));
}
