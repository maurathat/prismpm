/**
 * LexLean's front end as WebAssembly: the `lexlean` executable built for
 * `wasm32-wasip1` without its production data (LexLean SPEC §8.3 and §8.4,
 * `CL-25`, `CL-26`), run by Node's own `node:wasi`. It checks a model and
 * exports its semantic snapshot on this machine with no container, no toolchain
 * and no server. It starts no process of its own and takes no lock, so it
 * runs `check` and `snapshot`, never `verify`: Lean is not in it.
 *
 * The bytes are named by their UOR κ-label (BLAKE3) and used only when they have it,
 * whether they were just fetched or read from disk. They are kept once per
 * machine in the pinned store (`$PRISM_HOME/kappa/pinned/`, kappa-store.mjs), or
 * read from `PRISM_LEXLEAN_WASM` when that names a file. Where they are fetched from is `LEXLEAN_WASM.url`, read through the
 * serverless boundary (hosts.mjs), once; `PRISM_LEXLEAN_FETCH=0` fetches nothing.
 *
 * It runs in this process on wasi-memory.mjs, a WASI host over the project's
 * files held in memory: `node:wasi` lists no directory on Windows, and the
 * same host serves a browser. What is run is lexlean-core.mjs, which reads no
 * disk; this module is its Node side: the pinned file and the project's folder. The module is compiled once per process, so
 * every check after the first pays only for the run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismCodeError } from '../errors.mjs';
import { buildFetch } from './hosts.mjs';
import { admittedLabel, decoded, keptFile, pinnedFile, receiveDecoded, writeAtomic } from './kappa-store.mjs';
import { DECLARE_LIBRARY_PATH, lexleanCheck, lexleanDeclare, lexleanRun, lexleanSnapshot } from './lexlean-core.mjs';

/**
 * The pinned executable: LexLean at `commit`, built with
 * `cargo build --locked --release --target wasm32-wasip1 -p lexlean --bin lexlean --no-default-features`.
 * `kappa`, `sha256` and `bytes` are the uncompressed module's; `url` serves it gzipped, or is null while no public copy exists.
 */
export const LEXLEAN_WASM = Object.freeze({
  // UOR-Foundation/lexlean commit 9ba600d0 (draft PR #566: 0.4.3 with `lexlean snapshot`, CL-26). Two builds from clean
  // target directories gave these same bytes.
  commit: '9ba600d071b2bfa6ca990fd38d92a4c47fa9d39c',
  // The identity: the UOR κ-label of the module, BLAKE3. SHA-256 is a secondary digest, bound to it, never a key.
  kappa: 'blake3:4f302c18e02a46b0d015c57bd389a0754b301ec876aa7a637f786c4562274ecb',
  sha256: 'f76fa2aacdc96a0a977395b9889b0eb659942d0fbfe7af4d0aac62c18b25d6d5',
  bytes: 19133367,
  // Served and kept gzipped: 4.1 MB on disk in place of 19.1 MB. The label is that of the decoded module.
  encoding: 'gzip',
  encodedBytes: 4140342,
  // The pre-release asset the user approved; fetched through the serverless boundary and admitted when it decodes to `kappa`.
  url: 'https://github.com/UOR-Foundation/lexlean/releases/download/wasm-snapshot-9ba600d/lexlean-9ba600d.wasm.gz',
});


/** The pin to hold the bytes to: the package's, or the one a caller names (a test, or a build of LexLean being tried). */
const pinOf = (pin) => pin ?? LEXLEAN_WASM;

/** Files already found to decode to the pinned κ-label in this process, by path, size and change time. */
const verified = new Map();

/** How a pin is served: what it names, else gzip when its URL is a `.gz`. */
const encodingOf = (pin) => pin.encoding ?? (/\.gz$/.test(pin.url ?? '') ? 'gzip' : 'identity');

/**
 * The executable's file, checked against its pin's κ-label, or null when it is
 * not on this machine. `PRISM_LEXLEAN_WASM` names a file to use in place of
 * the kept one; it is held to the same pin. Bytes are re-derived the first
 * time a file is read in a process, and again whenever its size or change
 * time moves.
 */
export function lexleanWasmFile({ env = process.env, pin = null } = {}) {
  const want = pinOf(pin);
  if (!want.kappa) return null;
  // Kept or named, gzipped or not, a file is admitted when it decodes to the pinned label.
  const label = want.kappa;
  const file = env.PRISM_LEXLEAN_WASM ? resolve(env.PRISM_LEXLEAN_WASM) : keptFile(label, env);
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  const seen = `${label} ${stat.size} ${stat.mtimeMs}`;
  if (verified.get(file) === seen) return file;
  const got = admittedLabel(readFileSync(file));
  if (got !== label) throw new PrismCodeError('lexlean.wasm-mismatch', `${file} decodes to ${got ?? 'nothing'}, not the pinned ${label}`);
  verified.set(file, seen);
  return file;
}

/**
 * Whether LexLean as WebAssembly can run here, fetching it once when it is not
 * here yet. Never fetches for a user who asked for the hosted verifier, and
 * never throws: a module that cannot be had leaves the other front ends.
 */
export async function lexleanReady({ env = process.env, fetch = globalThis.fetch, log = () => {}, pin = null } = {}) {
  if (env.PRISM_CODE_TIER === 'hosted') return false;
  try {
    await ensureLexleanWasm({ env, fetch, log, pin });
    return true;
  } catch {
    return false;
  }
}

/** Whether LexLean's front end can run here now, as WebAssembly. */
export function hasLexleanWasm(options = {}) {
  try {
    return lexleanWasmFile(options) !== null;
  } catch {
    return false;
  }
}

/**
 * Make sure the executable is on this machine, fetching it once when the pin
 * names where. Resolves its file. Throws `lexlean.wasm-mismatch` for bytes
 * that are not the pinned ones, and `lexlean.wasm-unavailable` when there is
 * nowhere to fetch it from.
 */
export async function ensureLexleanWasm({ env = process.env, pin = null, fetch = globalThis.fetch, log = () => {} } = {}) {
  const want = pinOf(pin);
  const kept = lexleanWasmFile({ env, pin: want });
  if (kept) return kept;
  if (env.PRISM_LEXLEAN_FETCH === '0') throw new PrismCodeError('lexlean.wasm-unavailable', 'LexLean as WebAssembly is not on this machine, and PRISM_LEXLEAN_FETCH=0 says not to fetch it');
  if (!want.url || !want.kappa) throw new PrismCodeError('lexlean.wasm-unavailable', 'no public copy of LexLean as WebAssembly is pinned in this prism-code yet, and PRISM_LEXLEAN_WASM names no file');
  log(`Fetching LexLean's front end as WebAssembly once (about ${Math.round((want.encodedBytes ?? 4e6) / 1e6)} MB); it is checked against its κ-label.`);
  const response = await buildFetch({ fetch })(want.url);
  if (!response.ok) throw new PrismCodeError('lexlean.wasm-unavailable', `${want.url} answered HTTP ${response.status}`);
  // Decoded and hashed as it arrives; kept as served.
  const { encoded, label } = await receiveDecoded(response, encodingOf(want));
  if (label !== want.kappa) throw new PrismCodeError('lexlean.wasm-mismatch', `${want.url} gave bytes that decode to ${label ?? 'nothing'}, not the pinned ${want.kappa}`);
  const file = pinnedFile(want.kappa, env);
  writeAtomic(file, encoded);
  return file;
}

/** Folders a check never reads: build outputs, caches and version control. */
const SKIPPED = new Set(['.lexlean', '.lake', '.prism', '.git', 'target', 'node_modules']);

/** The project's files as the instance sees them: `/`-rooted paths to bytes. */
export function projectFiles(projectDir) {
  const files = new Map();
  const visit = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) visit(join(dir, entry.name), `${rel}/${entry.name}`);
      } else if (entry.isFile()) files.set(`${rel}/${entry.name}`, new Uint8Array(readFileSync(join(dir, entry.name))));
    }
  };
  visit(resolve(projectDir), '');
  return files;
}

const compiled = new Map();

/** The compiled module of the file, inflated when it is kept gzipped, compiled once per process. */
function moduleOf(file) {
  if (!compiled.has(file)) compiled.set(file, WebAssembly.compile(decoded(readFileSync(file))));
  return compiled.get(file);
}

/**
 * LexLean's front end as it is on this machine: `{ module, kappa }`, the compiled module and the κ-label it was
 * admitted by, which is what `relex` takes (proof-record.mjs). Throws `lexlean.wasm-unavailable` when it is not here.
 */
export async function lexleanModule({ env = process.env, pin = null } = {}) {
  const file = lexleanWasmFile({ env, pin });
  if (!file) throw new PrismCodeError('lexlean.wasm-unavailable', 'LexLean as WebAssembly is not on this machine');
  return { module: await moduleOf(file), kappa: pinOf(pin).kappa };
}

/** The admitted module and the project's files: what lexlean-core.mjs runs on. */
async function here(projectDir, { env = process.env, pin = null } = {}) {
  const file = lexleanWasmFile({ env, pin });
  if (!file) throw new PrismCodeError('lexlean.wasm-unavailable', 'LexLean as WebAssembly is not on this machine');
  return { module: await moduleOf(file), files: projectFiles(projectDir) };
}

/**
 * Run `lexlean <args>` on the project at `projectDir` as WebAssembly. Resolves
 * `{ exit, stdout, stderr, ms }`, stdout as bytes. Only `check`, `snapshot` and `declare`
 * are run here: a command that changes the project is refused by LexLean on
 * WASI (`LLV7010`), and the file system it sees is read only.
 */
export async function runLexleanWasm(projectDir, args, { env = process.env, pin = null, files = null } = {}) {
  const started = performance.now();
  const { module, files: all } = await here(projectDir, { env, pin });
  // `files` adds read-only files beside the project's own.
  for (const [path, bytes] of files ?? []) all.set(path, bytes);
  const r = await lexleanRun(module, all, args);
  return { exit: r.exit, stdout: Buffer.from(r.stdout), stderr: r.stderr, ms: Math.round(performance.now() - started) };
}

/** `lexlean --diagnostic-format json check --all`: the command result, parsed. */
export async function wasmCheck(projectDir, options = {}) {
  const { module, files } = await here(projectDir, options);
  return lexleanCheck(module, files);
}

/**
 * `lexlean snapshot --all`: the model's `lexlean/semantic-snapshot/2`, with its
 * exact bytes. A model LexLean refuses
 * resolves `{ ok: false, check }` with the command result of `check`.
 */
export async function wasmSnapshot(projectDir, options = {}) {
  const { module, files } = await here(projectDir, options);
  const taken = await lexleanSnapshot(module, files);
  return taken.ok ? { ...taken, bytes: Buffer.from(taken.bytes) } : taken;
}

export { DECLARE_LIBRARY_PATH };

/**
 * `lexlean declare --all --library <base>` (LexLean CL-29): the project's kernel declarations, written by LexLean
 * itself from the model with no Lean, as one `lexlean/kernel-declarations/2` document that continues `base`, the
 * library export the kernel holds. Resolves `{ ok: true, document, ms }`; `{ ok: false, unsupported: true }` when the
 * pinned LexLean has no `declare` command, so the caller keeps its own lowering; or `{ ok: false, check }` with the
 * command result of `check` when LexLean refuses the model.
 */
export async function wasmDeclare(projectDir, base, options = {}) {
  const { module, files } = await here(projectDir, options);
  return lexleanDeclare(module, files, base);
}
