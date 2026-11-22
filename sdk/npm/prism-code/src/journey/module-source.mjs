/**
 * The admitted bytes a compiled WebAssembly module was compiled from, held beside the module for as long as the
 * module lives, so a run that finds the compiled code broken can compile the same admitted bytes again
 * (lexlean-core.mjs, `lexleanRun`). Only toolchain.mjs records a module here, and only after its bytes have the
 * pinned κ-label, so what is compiled again is never other bytes than the ones admitted.
 */
const sources = new WeakMap();

/** Record that `module` was compiled from `bytes`, already admitted by their label. Returns `module`. */
export function rememberSource(module, bytes) {
  sources.set(module, bytes);
  return module;
}

/** The admitted bytes `module` was compiled from, or null when it was not admitted through toolchain.mjs. */
export function sourceOf(module) {
  return sources.get(module) ?? null;
}
