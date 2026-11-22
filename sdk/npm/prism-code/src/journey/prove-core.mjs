/**
 * Lean's kernel judging a model's theorems, with no disk, no process and no network of its own. model-prove.mjs is
 * its Node side (the pinned files, the kernel's image and the verdicts kept on this machine); a browser worker gives
 * it the same three files through the build's ports (toolchain.mjs) and runs the same functions, so a theorem is
 * judged the same way in both.
 *
 * Nothing here is trusted to be right: the kernel refuses a wrong term. A theorem is reported proved only when the
 * kernel accepted its proof in this run, or under the same Merkle key in a run whose verdict the caller kept, and
 * the axioms it rests on are among those it declares and Lean's three standard ones.
 */
import { kappa } from '../blake3.mjs';
import { loadLibrary } from '../vendor/kernel-path/emit.mjs';
import { plan } from '../vendor/kernel-path/plan.mjs';
import { judgeDeclarations } from '../vendor/kernel-path/declarations.mjs';
import { lexleanDeclare } from './lexlean-core.mjs';
import { admitBytes } from './toolchain.mjs';

/** Lean's three standard axioms: no theorem may rest on any other. */
export const STANDARD_AXIOMS = Object.freeze(['Classical.choice', 'Quot.sound', 'propext']);

/** The kernel's files are not here and could not be had. `code` is `kernel.unavailable`: it says nothing about an app. */
export class ModelKernelMissing extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelKernelMissing';
    this.code = 'kernel.unavailable';
  }
}

const enc = new TextEncoder();

/**
 * Open Lean's kernel with the base library resident. `factory` is the default export of the kernel's loader
 * (`lean-kernel.mjs`), `wasm` the kernel's bytes and `baseText` the library export, each already admitted by its
 * κ-label. `image`, when given, is the whole memory of a kernel that had loaded this library: the kernel resumes
 * from it instead of reading the library, and when that fails for any reason a fresh kernel reads the library, so
 * an image only saves time. `keepImage` is given the image of a kernel that read the library.
 *
 * With `resettable`, the kernel's memory as it is once the library is resident is held, and `reset()` lays it back:
 * the kernel is then as it was before anything was judged, so what one batch declared cannot stand in for the next.
 * It costs one copy of the kernel's memory. `memory()` is a copy of the kernel's memory as it is now, for a caller
 * that keeps images in a format of its own (kernel-image.mjs).
 * Resolves `{ library, baseText, check, memory, reset, resumed, setAside? }`.
 */
export async function openKernel({ factory, wasm, baseText, image = null, keepImage = null, resettable = false }) {
  const said = [];
  // A kernel, and its memory, taken from the instance: a view of memory made after it grows always reaches its end,
  // where a view kept from before the growth does not.
  const start = async () => {
    let memory = null;
    const made = await factory({
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(wasm, imports).then((r) => { memory = Object.values(r.instance.exports).find((x) => x instanceof WebAssembly.Memory) ?? null; done(r.instance, r.module); });
        return {};
      },
      print: (line) => said.push(line),
      printErr: (line) => said.push(line),
    });
    if (made.ccall('checker_ready', 'number', [], []) !== 0) throw new Error('the kernel did not start');
    return { made, heap: () => (memory ? new Uint8Array(memory.buffer) : made.HEAPU8) };
  };
  let { made: module, heap } = await start();
  const run = (entry, text) => {
    said.length = 0;
    module.FS.writeFile('/in.ndjson', text);
    let exit;
    try { exit = module.ccall(entry, 'number', ['string'], ['/in.ndjson']); } catch (error) { exit = 3; said.push(`trap: ${error?.message ?? error}`); }
    module.FS.unlink('/in.ndjson');
    const axioms = {}, rest = [];
    for (const line of said) {
      const a = /^axioms (\S+): ?(.*)$/.exec(line);
      if (a) axioms[a[1]] = a[2] ? a[2].split(', ').sort() : [];
      else rest.push(line);
    }
    return { exit, axioms: exit === 0 ? axioms : {}, output: rest.join('\n').slice(-600) };
  };
  let resumed = false, setAside = null;
  if (image) {
    try {
      // The image can be larger than a fresh kernel's memory (80.5 MB against 64 MB on CI). malloc of only the
      // difference can be met from free space inside the current memory, which then never grows; asking for the
      // image's whole size makes the runtime grow memory past it.
      if (image.length > heap().length && !module._malloc(image.length)) throw new Error('the kernel could not grow to its image');
      const now = heap();
      if (now.length < image.length) throw new Error(`the kernel grew to ${now.length} bytes, not its image's ${image.length}`);
      now.set(image);
      if (now.length > image.length) now.fill(0, image.length);
      // The resumed kernel must answer as a kernel over its library: checking nothing is accepted, or it is not resumed.
      const probe = run('check_suffix', '');
      if (probe.exit !== 0) throw new Error(`the resumed kernel did not answer (${probe.output.slice(0, 120)})`);
      resumed = true;
    } catch (error) {
      // Why the image was set aside, said with the kernel, so a slow start is never a mystery.
      setAside = String(error?.message ?? error);
      ({ made: module, heap } = await start());
    }
  }
  if (!resumed) {
    const loaded = run('load_library', baseText);
    if (loaded.exit !== 0) throw new Error(`the kernel refused its base library: ${loaded.output}`);
    if (keepImage) await keepImage(heap().slice());
  }
  const loaded = resettable ? heap().slice() : null;
  const reset = () => {
    if (!loaded) throw new Error('this kernel was not opened resettable');
    // Memory only grows: what lies past the held copy was allocated since, and is cleared.
    const now = heap();
    now.set(loaded);
    if (now.length > loaded.length) now.fill(0, loaded.length);
  };
  return { library: loadLibrary(baseText), baseText, check: (text) => run('check_suffix', text), memory: () => heap().slice(), reset, resumed, ...(setAside ? { setAside } : {}) };
}

/** A theorem's verdict from the axioms the kernel observed for its accepted proof: the same rule for both paths. */
export function verdictOf(th) {
  const got = th.axioms;
  return got === null ? 'not proved: the kernel reported nothing for it'
    : got.some((a) => !STANDARD_AXIOMS.includes(a)) ? `not proved: it rests on ${got.filter((a) => !STANDARD_AXIOMS.includes(a)).join(', ')}, outside Lean's standard axioms`
    : got.some((a) => !th.declared.includes(a)) ? `not proved: it rests on ${got.filter((a) => !th.declared.includes(a)).join(', ')}, which it does not declare`
    : got.length < th.declared.length ? 'proved, on fewer axioms than declared' : 'proved';
}

/**
 * Prove every theorem of a model from its semantic snapshot, on an open kernel `k`. `known` is the verdicts the
 * caller kept, by Merkle key; a theorem found there is not judged again, and `keep`, when given, is handed the map
 * after new verdicts were added. Resolves
 * `{ ok, theorems: [{ name, key, proof, declared, axioms, status, remembered, ms }], declarations, judged, remembered, resumed, ms, refusal? }`.
 *
 * A proof found here may rest on fewer axioms than the Lean text LexLean writes; that is proved, and said. When the
 * kernel refuses one theorem's proof, that theorem is set aside as not proved and the rest are judged again, so one
 * false theorem never hides the others.
 */
export async function proveSnapshot(snapshot, k, { known = new Map(), keep = null } = {}) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let p;
  try {
    p = plan(snapshot, k.library, { hash: (s) => kappa(enc.encode(s)) });
  } catch (error) {
    return { ok: false, theorems: [], declarations: 0, judged: 0, remembered: 0, ms: elapsed(), refusal: error.message.replace(/^lower: /, '') };
  }
  const theorems = p.theorems.map((th) => {
    const v = th.status ? null : known.get(th.key);
    return { name: th.name, key: th.key, proof: th.proof, declared: th.declared, axioms: v?.axioms ?? null, status: th.status, remembered: !!v, ms: v?.ms ?? null };
  });
  let todo = theorems.filter((t) => !t.status && !t.remembered).map((t) => t.name);
  const judged = todo.length;
  while (todo.length) {
    const t0 = performance.now(), r = k.check(p.file(todo)), ms = Math.round((performance.now() - t0) / todo.length);
    if (r.exit === 0) {
      for (const n of todo) { const t = theorems.find((x) => x.name === n); t.axioms = r.axioms[n] ?? null; t.ms = ms; if (t.axioms) known.set(t.key, { axioms: t.axioms, ms }); }
      break;
    }
    const named = /declaration '([^']+)'/.exec(r.output)?.[1];
    const culprit = theorems.find((t) => t.name === named && todo.includes(t.name));
    if (!culprit) return { ok: false, theorems, declarations: p.declarations, judged, remembered: theorems.filter((t) => t.remembered).length, ms: elapsed(), refusal: `Lean's kernel refused the lowered model: ${r.output}` };
    culprit.status = `not proved: Lean's kernel refused the proof found (${r.output.split('\n').slice(-1)[0].slice(0, 200)})`;
    todo = todo.filter((n) => n !== culprit.name);
  }
  if (judged && keep) await keep(known);
  for (const th of theorems) if (!th.status) th.status = verdictOf(th);
  const ok = theorems.length > 0 && theorems.every((t) => t.status.startsWith('proved'));
  return { ok, theorems, declarations: p.declarations, judged, remembered: theorems.filter((t) => t.remembered).length, resumed: !!k.resumed, ms: elapsed() };
}

/**
 * Prove every theorem of a model from the kernel declarations LexLean wrote for it (`lexlean declare`, LexLean
 * CL-29), on an open kernel `k`: a proof LexLean produced is judged as it is, and a proof is found here for each
 * other theorem. A produced proof the kernel refuses is set aside and its theorem found like any other.
 * Resolves the same shape as `proveSnapshot`, each theorem also carrying `produced` and, when set aside, `setAside`.
 */
export async function proveDeclared(document, k) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const empty = (refusal) => ({ ok: false, theorems: [], declarations: 0, judged: 0, remembered: 0, ms: elapsed(), refusal });
  if (document?.spec !== 'lexlean/kernel-declarations/2' || !document.library) return empty("LexLean wrote no declarations over this kernel's library");
  // The planner reads the kernel's answer as lines; the axioms of an accepted run come with it.
  const lines = (text) => text.split(/\r?\n/);
  const check = (text) => { const r = k.check(text); return { exit: r.exit, out: lines(r.output), axioms: r.axioms }; };
  let j;
  try {
    j = judgeDeclarations({ spec: document.spec, library: document.library, theorems: document.theorems, refused: document.refused ?? [] }, document.suffix, k.baseText, check);
  } catch (error) {
    return empty(error.message);
  }
  if (j.declarations.exit !== 0) return empty(`Lean's kernel refused LexLean's declarations: ${j.declarations.out.slice(-2).join(' ')}`);
  const p = j.plan;
  const theorems = p.theorems.map((th) => ({
    name: th.name, proof: th.proof, declared: th.declared, produced: th.produced ?? null,
    axioms: th.produced ? (j.declarations.axioms?.[th.produced] ?? null) : null,
    status: th.status, remembered: false, ms: null, ...(j.setAside.has(th.name) ? { setAside: j.setAside.get(th.name) } : {}),
  }));
  let todo = theorems.filter((t) => !t.status && !t.produced).map((t) => t.name);
  const judged = todo.length;
  while (todo.length) {
    const t0 = performance.now(), r = k.check(p.file(todo)), ms = Math.round((performance.now() - t0) / todo.length);
    if (r.exit === 0) {
      for (const n of todo) { const t = theorems.find((x) => x.name === n); t.axioms = r.axioms[n] ?? null; t.ms = ms; }
      break;
    }
    const named = /declaration '([^']+)'/.exec(r.output)?.[1];
    const culprit = theorems.find((t) => t.name === named && todo.includes(t.name));
    if (!culprit) return { ...empty(`Lean's kernel refused the proofs found: ${lines(r.output).slice(-1)[0]}`), theorems };
    culprit.status = `not proved: Lean's kernel refused the proof found (${lines(r.output).slice(-1)[0].slice(0, 200)})`;
    todo = todo.filter((n) => n !== culprit.name);
  }
  for (const th of theorems) if (!th.status) th.status = verdictOf(th);
  const ok = theorems.length > 0 && theorems.every((t) => t.status.startsWith('proved'));
  return { ok, theorems, declarations: lines(document.suffix).filter(Boolean).length, judged, remembered: 0, produced: theorems.filter((t) => t.produced).length, setAside: j.setAside.size, resumed: !!k.resumed, ms: elapsed() };
}

const short = (name) => name.slice(name.lastIndexOf('.') + 1);

/**
 * One theorem as the build reports it: `{ theorem, name, proof, status, detail, axioms, remembered, ms }`. `status`
 * is one of three answers. `proved`: the kernel accepted a proof within the declared axioms. `not proved`: the
 * kernel accepted a proof, and it rests on axioms the theorem does not declare or Lean does not hold standard.
 * `not settled`: no proof was accepted, which says nothing about whether the statement is true. `detail` is the
 * full sentence.
 */
export function reported(th) {
  const status = th.status.startsWith('proved') ? 'proved' : / rests on /.test(th.status) ? 'not proved' : 'not settled';
  return { theorem: short(th.name), name: th.name, proof: th.proof, status, detail: th.status, axioms: th.axioms ?? null, remembered: th.remembered === true, ms: th.ms ?? null };
}

/**
 * The prover the build asks (build-core.mjs, `prove`), over an open kernel. LexLean's own declarations are judged
 * when this LexLean writes them; otherwise the model is lowered here from its semantic snapshot. `known` and `keep`
 * are the verdicts kept, as `proveSnapshot` takes them.
 * Resolves `{ ok, theorems, via, declarations, judged, remembered, resumed, ms, message }`, each theorem as
 * `reported` gives it. A model the prover cannot put to the kernel is `ok: false` with every answer withheld: that
 * is a limit of the prover, and the message says so.
 */
export function kernelProver(k, { known = new Map(), keep = null } = {}) {
  return async ({ files, snapshot, lexlean }) => {
    let result = null;
    let via = 'the semantic snapshot';
    const declared = await lexleanDeclare(lexlean, files, k.baseText);
    if (declared.ok) {
      result = await proveDeclared(declared.document, k);
      via = "LexLean's own declarations";
    } else if (!declared.unsupported) {
      return { ok: false, theorems: [], via, message: 'LexLean refused the model, so it has no declarations.' };
    } else {
      result = await proveSnapshot(snapshot, k, { known, keep });
    }
    const theorems = result.theorems.map(reported);
    const common = { theorems, via, declarations: result.declarations, judged: result.judged, remembered: result.remembered, resumed: result.resumed === true, ms: result.ms };
    if (result.refusal) return { ok: false, ...common, message: `The model could not be put to Lean's kernel: ${result.refusal}. This is a limit of this prover, not a verdict on the app.` };
    const missed = theorems.filter((t) => t.status !== 'proved');
    if (missed.length) return { ok: false, ...common, message: `${missed.length} of ${theorems.length} theorems are not proved: ${missed.slice(0, 3).map((t) => `${t.theorem} (${t.detail.replace(/^not proved: /, '')})`).join('; ')}.` };
    return { ok: true, ...common, message: `Lean's kernel accepted a proof of every one of the model's ${theorems.length} theorems over ${result.declarations} declarations, from ${via}, each within its declared axioms.` };
  };
}

/** The kernel's loader as a module, from its admitted bytes, in a page or a worker: imported from a blob. */
export async function loaderFromBlob(glue) {
  const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
  try {
    return (await import(url)).default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open the kernel from its three files, each admitted through the build's ports (toolchain.mjs) by its κ-label.
 * `pins` is `{ loader, kernel, library }`, each `{ kappa, url, encoding }`; `load` turns the loader's bytes into
 * its factory (`loaderFromBlob` in a page). `image` and `keepImage` are as `openKernel` takes them.
 * Throws `ModelKernelMissing` for a file that cannot be had or is not the pinned one.
 */
export async function openKernelFrom(pins, { store = null, fetch = null, load = loaderFromBlob, image = null, keepImage = null, resettable = false } = {}) {
  const refuse = (message) => new ModelKernelMissing(message);
  const [glue, wasm, base] = await Promise.all([
    admitBytes(pins.loader, { store, fetch, refuse, what: "the kernel's loader" }),
    admitBytes(pins.kernel, { store, fetch, refuse, what: "Lean's kernel" }),
    admitBytes(pins.library, { store, fetch, refuse, what: "the kernel's base library" }),
  ]);
  return openKernel({ factory: await load(glue), wasm, baseText: new TextDecoder().decode(base), image, keepImage, resettable });
}
