/**
 * Prove any app's theorems in this process, with no Lean toolchain, no
 * Docker and no server: the kernel path.
 *
 * LexLean (WebAssembly, lexlean-wasm.mjs) gives the model's semantic snapshot.
 * The snapshot is lowered to Lean kernel declarations (vendor/kernel-path/lower.mjs),
 * a proof of each theorem is found (vendor/kernel-path/emit.mjs), and Lean
 * 4.32.2's own kernel, as WebAssembly, judges every declaration and proof
 * over a small base library. The same code, kernel and library run in a
 * browser tab as PrismPM's sealed prover (sdk/npm/lean-prover/web/sealed.html).
 *
 * Nothing here is trusted to be right: the kernel refuses a wrong term. What
 * the lowering decides is what each statement means, and every declaration it
 * writes is the one LexLean's model names.
 *
 * The kernel, its loader and the base library are fetched once per machine
 * into the pinned store, each admitted only when it decodes to its BLAKE3
 * label, or read from `PRISM_MODEL_KERNEL_DIR` by name. The request names no
 * app and carries nothing of the user's.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildFetch } from './hosts.mjs';
import { admittedLabel, kappaDirectory, pinnedFile, writeAtomic } from './kappa-store.mjs';
// The UOR content-addressed label, BLAKE3: what this machine keeps is named by it.
import { kappa } from '../blake3.mjs';
import { COVERED } from '../vendor/kernel-path/plan.mjs';
// What is judged, and how, is prove-core.mjs's, which reads no disk: a browser worker runs the same functions.
import { ModelKernelMissing, STANDARD_AXIOMS, openKernel, proveDeclared, proveSnapshot } from './prove-core.mjs';

export { ModelKernelMissing, STANDARD_AXIOMS };

export const MODEL_KERNEL_REPOSITORY = 'UOR-Foundation/PrismPM';
export const MODEL_KERNEL_COMMIT = '67ba3a17656fae808cfa9e6b7419591e35c977c6';
/** The files, by name: where each lives in the repository, and the BLAKE3 κ-label of its decoded bytes. */
export const MODEL_KERNEL_FILES = Object.freeze({
  'lean-kernel.mjs': { path: 'sdk/npm/lean-prover/kernel-path/kernel/lean-kernel.mjs', kappa: 'blake3:ec13d669b62c9a0223a937e04c3df18235fa67878ca53ba926f75904fe9c4610', encoding: 'identity', bytes: 62389 },
  'lean-kernel.wasm.gz': { path: 'sdk/npm/lean-prover/kernel-path/kernel/lean-kernel.wasm.gz', kappa: 'blake3:2f254140590074724ca1a8033080e0ae0834a018e06481ad7ccf7de9b80f175a', encoding: 'gzip', bytes: 2235146 },
  'base.ndjson.gz': { path: 'sdk/npm/lean-prover/kernel-path/library/base.ndjson.gz', kappa: 'blake3:f5502e3d8e4fd563f8bd352b427883149abd5dca0e6c47002fe686a5ddeae995', encoding: 'gzip', bytes: 20413230 },
});
/** LexLean's proof kinds the proof finder covers, by the name it knows them by. */
export const COVERED_PROOFS = COVERED;

const RAW_URL = 'https://raw.githubusercontent.com';

const fileOf = (name, env) => (env.PRISM_MODEL_KERNEL_DIR ? join(env.PRISM_MODEL_KERNEL_DIR, name) : pinnedFile(MODEL_KERNEL_FILES[name].kappa, env));

/** One kept file's decoded bytes, admitted when they have its κ-label. Throws `ModelKernelMissing` otherwise. */
function readFile(name, env) {
  const file = fileOf(name, env);
  if (!existsSync(file)) throw new ModelKernelMissing(`${name} is not on this machine yet`);
  const bytes = readFileSync(file);
  if (admittedLabel(bytes) !== MODEL_KERNEL_FILES[name].kappa) throw new ModelKernelMissing(`${file} is not the pinned ${name}`);
  return MODEL_KERNEL_FILES[name].encoding === 'gzip' ? gunzipSync(bytes) : bytes;
}

/** Make sure every file is on this machine, fetching what is missing; a file is written only when it has its pinned label. */
export async function ensureModelKernel({ env = process.env, fetch = globalThis.fetch, log = () => {} } = {}) {
  const get = buildFetch({ fetch });
  let said = false;
  for (const [name, want] of Object.entries(MODEL_KERNEL_FILES)) {
    try {
      readFile(name, env);
      continue;
    } catch (error) {
      if (!(error instanceof ModelKernelMissing)) throw error;
    }
    if (env.PRISM_MODEL_KERNEL_DIR) throw new ModelKernelMissing(`${name} is not in PRISM_MODEL_KERNEL_DIR with its pinned bytes`);
    if (!said) log(`Fetching Lean's kernel and its base library once (about 1.7 MB) from github.com/${MODEL_KERNEL_REPOSITORY}; each file is checked against its BLAKE3 label. Nothing about the app is sent.`);
    said = true;
    const url = `${RAW_URL}/${MODEL_KERNEL_REPOSITORY}/${MODEL_KERNEL_COMMIT}/${want.path}`;
    let response;
    try {
      response = await get(url);
    } catch (error) {
      if (error.code === 'build.host-not-allowed') throw error;
      throw new ModelKernelMissing(`${url} did not answer: ${error.cause?.code ?? error.message}`);
    }
    if (!response.ok) throw new ModelKernelMissing(`${url} answered HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const got = admittedLabel(bytes);
    if (got !== want.kappa) throw new ModelKernelMissing(`${url} decodes to ${got ?? 'nothing'}, not the pinned ${want.kappa}`);
    writeAtomic(fileOf(name, env), bytes);
  }
}


// ----- what is done once, kept by its label, and never done again -----
//
// Two things are remembered on this machine, in the κ store (`$PRISM_HOME/kappa/kernel-path/`), so every proof of every
// app here makes the next one cheaper:
//   - the kernel with the base library loaded, suspended to an image: a later process resumes from it instead of
//     reading the library again. Kept gzipped under the κ store's label of those bytes (BLAKE3),
//     used only when they have it, and set aside for a fresh kernel when resuming from it fails.
//   - each theorem's verdict, by its Merkle key (vendor/kernel-path/lower.mjs): the label of its statement and of every
//     declaration it reaches, without the project's module prefix, so the same theorem over the same definitions is
//     judged once for every app on this machine. Filed under the labels of the kernel, the library and this code.
const enc = new TextEncoder();
const storeDir = (env) => join(kappaDirectory(env), 'kernel-path');
const codeLabel = () => kappa(Buffer.concat(['emit.mjs', 'lower.mjs', 'plan.mjs'].map((f) => readFileSync(new URL(`../vendor/kernel-path/${f}`, import.meta.url)))));
const identity = (what) => kappa(enc.encode([`prism-code/kernel-path/${what}/1`, ...Object.values(MODEL_KERNEL_FILES).map((f) => f.kappa), what === 'verdicts' ? codeLabel() : ''].join('\n'))).slice(7);

function readLabelled(file) {
  // A file of `label\nbody`: the body, when it still has its label.
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8'), cut = text.indexOf('\n');
  return cut > 0 && kappa(enc.encode(text.slice(cut + 1))) === text.slice(0, cut) ? text.slice(cut + 1) : null;
}
const writeLabelled = (file, body) => writeAtomic(file, enc.encode(`${kappa(enc.encode(body))}\n${body}`));

function readImage(env) {
  try {
    const label = readLabelled(join(storeDir(env), `image-${identity('image')}`))?.trim();
    if (!label) return null;
    const file = join(storeDir(env), 'images', label.slice(7));
    if (!existsSync(file)) return null;
    const gz = readFileSync(file);
    return kappa(gz) === label ? gunzipSync(gz) : null;
  } catch { return null; }
}
function keepImage(env, image) {
  try {
    const gz = gzipSync(image, { level: 1 }), label = kappa(gz);
    writeAtomic(join(storeDir(env), 'images', label.slice(7)), gz);
    writeLabelled(join(storeDir(env), `image-${identity('image')}`), label);
  } catch { /* a store that cannot be written only means the next process reads the library again */ }
}

/** The theorem verdicts this machine has found: `{ key: { axioms, ms } }`. */
export function knownVerdicts({ env = process.env } = {}) {
  try { return new Map(Object.entries(JSON.parse(readLabelled(join(storeDir(env), `verdicts-${identity('verdicts')}.json`)) ?? '{}'))); } catch { return new Map(); }
}
function keepVerdicts(env, known) {
  try { writeLabelled(join(storeDir(env), `verdicts-${identity('verdicts')}.json`), JSON.stringify(Object.fromEntries(known))); } catch { /* the next proof judges again */ }
}

let opened = null;

/** Lean's kernel with the base library resident, opened once per process. Resolves `{ library, baseText, check, resumed }`. */
export function openModelKernel({ env = process.env } = {}) {
  opened ??= (async () => {
    const glue = readFile('lean-kernel.mjs', env), wasm = readFile('lean-kernel.wasm.gz', env), base = readFile('base.ndjson.gz', env);
    // Node imports a module from a file: the loader's checked bytes are written under their own label, then moved into place.
    const tag = MODEL_KERNEL_FILES['lean-kernel.mjs'].kappa.slice(7, 31);
    let loader = join(tmpdir(), `prism-model-kernel-${tag}.mjs`);
    const kept = () => existsSync(loader) && admittedLabel(readFileSync(loader)) === MODEL_KERNEL_FILES['lean-kernel.mjs'].kappa;
    if (!kept()) {
      const own = join(tmpdir(), `prism-model-kernel-${tag}-${process.pid}.mjs`);
      writeFileSync(own, glue);
      try { renameSync(own, loader); } catch { if (!kept()) loader = own; }
    }
    const factory = (await import(pathToFileURL(loader).href)).default;
    // Resumed from this machine's image when there is one; otherwise the library is read, and the image kept.
    return openKernel({ factory, wasm, baseText: base.toString('utf8'), image: readImage(env), keepImage: (image) => keepImage(env, image) });
  })();
  opened.catch(() => { opened = null; });
  return opened;
}

/**
 * Prove every theorem of a model from its semantic snapshot. Resolves
 * `{ ok, theorems: [{ name, proof, declared, axioms, status, remembered }], declarations, judged, remembered, ms, refusal? }`.
 *
 * A theorem is proved when the kernel accepts its proof and the axioms it rests on are among those it declared and
 * Lean's three standard ones. A proof found here may rest on fewer axioms than the Lean text LexLean writes (an
 * arithmetic proof without `Classical.choice`); that is proved, and said. A theorem this machine has judged under the
 * same key is not judged again. When the kernel refuses one theorem's proof, that theorem is set aside as not proved
 * and the rest are judged again, so one false theorem never hides the others.
 */
export async function modelProve(snapshot, { env = process.env, fetch = globalThis.fetch, log = () => {}, kernel = null } = {}) {
  let k = kernel;
  if (!k) {
    await ensureModelKernel({ env, fetch, log });
    k = await openModelKernel({ env });
  }
  return proveSnapshot(snapshot, k, { known: knownVerdicts({ env }), keep: (known) => keepVerdicts(env, known) });
}

/**
 * Prove every theorem of a model from the kernel declarations LexLean wrote for it (`lexlean declare`, LexLean CL-29):
 * the project's types, definitions and theorem statements as LexLean means them, and the proofs LexLean produced,
 * as lean4export lines that continue the base library this kernel holds. Every LexLean proof form is planned: a proof
 * LexLean produced is judged as it is, and a proof is found here for each other theorem (`judgeDeclarations`). A
 * produced proof the kernel refuses is set aside and its theorem found like any other, so it never sinks the rest.
 * Resolves the same shape as `modelProve`, each theorem also carrying `produced` and, when set aside, `setAside`.
 */
export async function modelProveDeclared(document, { env = process.env, fetch = globalThis.fetch, log = () => {}, kernel = null } = {}) {
  let k = kernel;
  if (!k) {
    await ensureModelKernel({ env, fetch, log });
    k = await openModelKernel({ env });
  }
  return proveDeclared(document, k);
}
