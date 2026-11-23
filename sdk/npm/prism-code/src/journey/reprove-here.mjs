/**
 * `reprove` and `relex` (proof-record.mjs) bound to this machine: Lean's kernel and LexLean's front end as the
 * package ships them, each admitted by its κ-label (model-prove.mjs, lexlean-wasm.mjs). These are the functions
 * `check` and `verify` take as their `reprove` and `relex` options in Node.
 *
 * Neither is opened for a holo that carries nothing to judge: the kernel is asked for only once the holo is known
 * to hold a snapshot and a kernel-proof statement, and LexLean only once it holds sources. Nothing about the holo
 * is sent anywhere; a file that is not on this machine is fetched once, as for `check` and `build`.
 */
import { ensureLexleanWasm, lexleanModule } from './lexlean-wasm.mjs';
import { ensureModelKernel, openModelKernel } from './model-prove.mjs';
import { relex, reprove } from './proof-record.mjs';

/** `(holoBytes) => reprove(holoBytes, { kernel })`, the kernel being this machine's. */
export function reproveHere({ env = process.env, log = () => {} } = {}) {
  const kernel = async () => {
    await ensureModelKernel({ env, log });
    return openModelKernel({ env });
  };
  return (holoBytes) => reprove(holoBytes, { kernel });
}

/** `(holoBytes) => relex(holoBytes, { lexlean })`, LexLean being this machine's. */
export function relexHere({ env = process.env, log = () => {} } = {}) {
  const lexlean = async () => {
    await ensureLexleanWasm({ env, log });
    return lexleanModule({ env });
  };
  return (holoBytes) => relex(holoBytes, { lexlean });
}
