/**
 * LexLean's front end, run on a compiled module and a set of files held in memory. Nothing here reads a disk,
 * a store or the network, so the same code runs in Node and in a browser worker: lexlean-wasm.mjs gives it
 * the module it admitted and a folder's files, and build-core.mjs gives it what its ports returned.
 *
 * `files` is a Map of `/`-rooted paths to bytes, as the instance sees them (wasi-memory.mjs). The file system
 * the instance sees is read only, and only `check`, `snapshot` and `declare` are run.
 */
import { PrismCodeError } from '../errors.mjs';
import { runWasi } from './wasi-memory.mjs';
import { rememberSource, sourceOf } from './module-source.mjs';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Runs of one module after a trap, before its admitted bytes are compiled again. */
const SAME_MODULE_TRIES = 3;
/** Runs of a module compiled again from its admitted bytes. */
const FRESH_MODULE_TRIES = 3;

/**
 * Modules found to trap, mapped to the module compiled again in their place, so later runs start from that one.
 * WebKit compiles LexLean wrongly at times (seen with Lean's kernel open in the same page): a run then traps at
 * its start, with "Out of bounds memory access" or "Unreachable code", and the module can keep trapping.
 */
const replaced = new WeakMap();

/**
 * Run `lexlean <args>`. Resolves `{ exit, stdout, stderr, ms, retried }`: stdout as bytes, stderr as text, and
 * how many runs trapped before this one answered.
 *
 * A trap (`WebAssembly.RuntimeError`) is not an answer: a run that traps writes nothing a caller reads, and every
 * run is a new instance with new memory over the same read-only files, so running again is the same request and
 * cannot change what LexLean answers. A trapped run is run again on the same module, then on the same admitted
 * bytes compiled again (when toolchain.mjs admitted the module), and the trap is thrown only after both are spent.
 * Any other error is thrown at once.
 */
export async function lexleanRun(module, files, args) {
  const started = performance.now();
  let current = replaced.get(module) ?? module;
  let retried = 0;
  let fresh = false;
  for (;;) {
    try {
      const r = await runWasi(current, { files, args });
      return { exit: r.exit, stdout: new Uint8Array(r.stdout), stderr: dec.decode(new Uint8Array(r.stderr)), ms: Math.round(performance.now() - started), retried };
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError)) throw error;
      retried += 1;
      const source = sourceOf(current);
      if (!fresh && retried >= SAME_MODULE_TRIES && source) {
        current = rememberSource(await WebAssembly.compile(source), source);
        replaced.set(module, current);
        fresh = true;
        continue;
      }
      if (retried >= (fresh ? SAME_MODULE_TRIES + FRESH_MODULE_TRIES : SAME_MODULE_TRIES)) {
        throw new PrismCodeError('lexlean.wasm-failed', `LexLean as WebAssembly trapped ${retried} times running \`${args.join(' ')}\` (${error.message}). This is a fault of the browser's WebAssembly engine and says nothing about the model; check again, or use another browser.`);
      }
    }
  }
}

/** `lexlean --diagnostic-format json check --all`: the command result, parsed, with how long it took. */
export async function lexleanCheck(module, files) {
  const r = await lexleanRun(module, files, ['--diagnostic-format', 'json', 'check', '--all']);
  let result;
  try {
    result = JSON.parse(dec.decode(r.stdout));
  } catch {
    throw new PrismCodeError('lexlean.wasm-failed', `LexLean as WebAssembly gave no command result (exit ${r.exit}): ${r.stderr.slice(0, 400)}`);
  }
  return { ...result, ms: r.ms };
}

/**
 * `lexlean snapshot --all`: the model's `lexlean/semantic-snapshot/2`, with its exact bytes. A model LexLean
 * refuses resolves `{ ok: false, check }` with the command result of `check`.
 */
export async function lexleanSnapshot(module, files) {
  const r = await lexleanRun(module, files, ['snapshot', '--all']);
  if (r.exit !== 0) return { ok: false, check: await lexleanCheck(module, files), ms: r.ms };
  // LexLean names the snapshot (its semantic_id); Prism derives no identity of its own for it.
  return { ok: true, bytes: r.stdout, snapshot: JSON.parse(dec.decode(r.stdout)), ms: r.ms };
}

/** Where the library export `declare` continues is placed in the instance's file system, beside the project. */
export const DECLARE_LIBRARY_PATH = '/.prism-code/base.ndjson';

/**
 * `lexlean declare --all --library <base>` (LexLean CL-29): the project's kernel declarations as one
 * `lexlean/kernel-declarations/2` document that continues `base`. Resolves `{ ok: true, document, ms }`;
 * `{ ok: false, unsupported: true }` when this LexLean has no `declare` command; or `{ ok: false, check }`
 * with the command result of `check` when LexLean refuses the model.
 */
export async function lexleanDeclare(module, files, base) {
  const all = new Map(files);
  all.set(DECLARE_LIBRARY_PATH, typeof base === 'string' ? enc.encode(base) : base);
  const r = await lexleanRun(module, all, ['declare', '--all', '--library', DECLARE_LIBRARY_PATH]);
  if (r.exit === 0) {
    const document = JSON.parse(dec.decode(r.stdout));
    if (document.spec !== 'lexlean/kernel-declarations/2') throw new PrismCodeError('lexlean.wasm-failed', `LexLean's declare gave a ${document.spec}, not lexlean/kernel-declarations/2`);
    return { ok: true, document, ms: r.ms };
  }
  // CLI misuse naming the command: this LexLean predates `declare` (a release before CL-29).
  if (r.exit === 2 && /unrecognized subcommand|invalid value 'declare'|unexpected argument/i.test(r.stderr)) return { ok: false, unsupported: true, ms: r.ms };
  return { ok: false, check: await lexleanCheck(module, files), ms: r.ms };
}
