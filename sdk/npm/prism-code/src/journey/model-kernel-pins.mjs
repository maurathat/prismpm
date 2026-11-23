/**
 * Lean's kernel for an app's theorems, by address: the loader, the kernel and the base library that prove a model
 * (model-prove.mjs opens them in Node; a page opens them with prove-core.mjs `openKernelFrom`).
 *
 * Each file is named by its UOR content address, the BLAKE3 kappa-label of its decoded bytes, and is used only
 * when its bytes have that label. A holo's kernel-proof statement names the kernel and the library it was proved
 * with by these labels, so whoever proves the holo again must open these, and can only do so from a module it can
 * load: this one has no import, of Node or of anything else.
 *
 * This is not the rule-table kernel (kernel/manifest.json), which is another build with another library and judges
 * rule tables only.
 */

export const MODEL_KERNEL_REPOSITORY = 'UOR-Foundation/PrismPM';
export const MODEL_KERNEL_COMMIT = '67ba3a17656fae808cfa9e6b7419591e35c977c6';

/** The files, by name: where each lives in the repository, the kappa-label of its decoded bytes, and how it is served. */
export const MODEL_KERNEL_FILES = Object.freeze({
  'lean-kernel.mjs': { path: 'sdk/npm/lean-prover/kernel-path/kernel/lean-kernel.mjs', kappa: 'blake3:ec13d669b62c9a0223a937e04c3df18235fa67878ca53ba926f75904fe9c4610', encoding: 'identity', bytes: 62389 },
  'lean-kernel.wasm.gz': { path: 'sdk/npm/lean-prover/kernel-path/kernel/lean-kernel.wasm.gz', kappa: 'blake3:2f254140590074724ca1a8033080e0ae0834a018e06481ad7ccf7de9b80f175a', encoding: 'gzip', bytes: 2235146 },
  'base.ndjson.gz': { path: 'sdk/npm/lean-prover/kernel-path/library/base.ndjson.gz', kappa: 'blake3:f5502e3d8e4fd563f8bd352b427883149abd5dca0e6c47002fe686a5ddeae995', encoding: 'gzip', bytes: 20413230 },
});
