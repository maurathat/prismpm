/**
 * Where each step of an app runs: on this machine, always. Prism is serverless; nothing about an app is sent anywhere.
 *
 * - `wasm`: LexLean as WebAssembly (lexlean-wasm.mjs). It checks the model and takes its semantic snapshot; it has
 *   no Lean in it. A rule app needs nothing more: Lean's kernel judges its guarantees in this process.
 * - `kernel`: any other app's theorems, proved in this process from the semantic snapshot by the kernel path
 *   (model-prove.mjs): the model lowered to Lean kernel declarations, a proof found for each theorem, and Lean's own
 *   kernel judging all of it.
 *
 * The same LexLean and the same kernel run in a browser tab (sdk/npm/lean-prover/web/sealed.html). There is no hosted
 * route: when LexLean as WebAssembly is not here and cannot be fetched, the step is refused, never sent.
 */
import { PrismCodeError } from '../errors.mjs';

/** The proposal phase that put LexLean's front end in WebAssembly. */
export const PHASE_3 = 'docs/proposals/canonical-serverless-build.md, Phase 3: LexLean\'s front end as WebAssembly';
/** The phase that proves an app's own theorems with no Lean toolchain: kernel terms produced in-process. */
export const PHASE_4 = 'docs/proposals/canonical-serverless-build.md, Phase 4: in-process proof producers';

/** Where each step runs, said wherever the state matters. */
export const NO_DOCKER_FREE_BUILD = `No step needs Docker, an image or a server. LexLean runs as WebAssembly on this machine (${PHASE_3}), shipped in this package and checked against its BLAKE3 label; it checks every app. Every app's theorems are then proved by Lean's own kernel, as WebAssembly, in this process (${PHASE_4}), shipped and checked the same way. Nothing is fetched, and nothing about the app is sent anywhere.`;

/** No place to run the step. `code` is `build.frontend-unavailable`. */
export function frontendUnavailable(why) {
  return new PrismCodeError('build.frontend-unavailable', `${why}. ${NO_DOCKER_FREE_BUILD}`);
}

const offline = (env) => env.PRISM_CODE_TIER === 'offline';

/** Where the front end runs: `wasm`, on this machine. With LexLean as WebAssembly missing the step is refused, never sent. */
export function frontendWhere({ env = process.env, hasWasm = () => false } = {}) {
  if (hasWasm()) return 'wasm';
  throw frontendUnavailable(offline(env)
    ? 'LexLean as WebAssembly is not on this machine, and PRISM_CODE_TIER=offline fetches nothing'
    : 'LexLean as WebAssembly is not on this machine and could not be fetched; nothing was sent anywhere');
}

/** Where an app's theorems are proved: Lean's kernel, in this process. */
export function proverWhere() {
  return 'kernel';
}
