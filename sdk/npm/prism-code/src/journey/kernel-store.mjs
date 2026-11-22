/**
 * Where Lean's kernel, its loader, the lemma library and the rule judge's holo
 * are kept: in the package (`wasm/pinned/`, kappa-store.mjs), so a first run fetches
 * nothing. A package without them fetches each once per machine into the pinned
 * store (`$PRISM_HOME/kappa/pinned/`).
 *
 * Each file is named by the BLAKE3 κ-label of its decoded bytes at one commit
 * of UOR-Foundation/foundry, and kept as served; its SHA-256 is a secondary
 * digest. A file is used only when it decodes to that label, whether it was just fetched or read
 * from disk, so neither the network nor the disk is trusted. The request
 * names no app and carries nothing of the user's: it is a GET of four public files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFetch } from './hosts.mjs';
import { admittedLabel, keptFile, pinnedFile, writeAtomic } from './kappa-store.mjs';

export const KERNEL_REPOSITORY = 'UOR-Foundation/foundry';
export const KERNEL_COMMIT = '7755331b8d1cba879d89a1956c0703b749868abd';
/**
 * The files, by name: where each lives in the repository, the κ-label of its decoded bytes, how it is served
 * (`encoding`, with `bytes` decoded and `encodedBytes` as served), and the SHA-256 of the bytes as served.
 */
export const KERNEL_FILES = Object.freeze({
  'lean-kernel.mjs.gz': { path: 'studio/shell/kernel/lean/lean-kernel.mjs.gz', kappa: 'blake3:ac5db408040227bebf5addb792481c6cad70b3c4e5734e6de5d28f0f4bef5b4d', encoding: 'gzip', bytes: 62458, encodedBytes: 17609, sha256: '8c77e3250d8c124d8f07fca9d9cc508475a062f72e9778208cd8aed3eab39cb9' },
  'lean-kernel.wasm.gz': { path: 'studio/shell/kernel/lean/lean-kernel.wasm.gz', kappa: 'blake3:21b2c46df9424cc7f12001f94ea8696f2b773e1cbd30e8e44c593207dc8ea177', encoding: 'gzip', bytes: 2235906, encodedBytes: 420987, sha256: '79accfb403771f7a362e17ed777bb1e84c19cb34e24ae537a919c980e6a833f2' },
  'library.ndjson.gz': { path: 'studio/shell/kernel/lean/library.ndjson.gz', kappa: 'blake3:1d8b899ed1eb5b7703151fff2bf525c24e9b24768ae6c1c7281fd19c53512b3d', encoding: 'gzip', bytes: 7834171, encodedBytes: 1246498, sha256: '0253aaa8f557ca95b072ab8dc06ac84c4f95e076eb458dead7d27c0f7afb6434' },
  'kernel.holo': { path: 'studio/shell/kernel/kernel.holo', kappa: 'blake3:9a26402323b5918c8db5568bdec2ebdd5a1579f907d223e9fbbeb2a4bc192af9', encoding: 'identity', sha256: 'e775324ea3abf203d3f7cb0b5a31e2c6c2328d751fdddf5fa1c46aae4e0d8cee', bytes: 657131 },
});
const RAW_URL = 'https://raw.githubusercontent.com';

/** The kernel's files are not on this machine and could not be fetched. `code` is `kernel.unavailable`: it says nothing about an app. */
export class KernelMissing extends Error {
  constructor(message) {
    super(message);
    this.name = 'KernelMissing';
    this.code = 'kernel.unavailable';
  }
}

/** Where a file is kept: the pinned store, or by name in `PRISM_KERNEL_DIR`, for a machine that carries the files itself. */
export function kernelFile(name, env = process.env) {
  const want = KERNEL_FILES[name];
  if (!want) throw new Error(`${name} is not a pinned kernel file`);
  return env.PRISM_KERNEL_DIR ? join(env.PRISM_KERNEL_DIR, name) : pinnedFile(want.kappa, env);
}

/** One kept file as served, admitted when it decodes to its κ-label. Throws `KernelMissing` when it is absent or is not the pinned bytes. */
export function readKernelFile(name, { env = process.env } = {}) {
  // Read from the store, else from the package's own copy; a fetched file is written to the store only (kernelFile).
  const file = env.PRISM_KERNEL_DIR ? kernelFile(name, env) : keptFile(KERNEL_FILES[name]?.kappa ?? '', env);
  if (!KERNEL_FILES[name]) throw new Error(`${name} is not a pinned kernel file`);
  if (!existsSync(file)) throw new KernelMissing(`${name} is not on this machine yet`);
  const bytes = readFileSync(file);
  if (admittedLabel(bytes) !== KERNEL_FILES[name].kappa) throw new KernelMissing(`${file} is not the pinned ${name}`);
  return bytes;
}

/** Whether every file is on this machine with its pinned bytes. */
export function hasKernel({ env = process.env } = {}) {
  try {
    for (const name of Object.keys(KERNEL_FILES)) readKernelFile(name, { env });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure every file is on this machine, fetching what is missing. A fetched
 * file is written only when its bytes have the pinned address. Resolves the
 * names that were fetched; throws `KernelMissing` when one could not be.
 */
export async function ensureKernel({ env = process.env, fetch = globalThis.fetch, log = () => {} } = {}) {
  // Behind the serverless boundary: the kernel is read from GitHub or not at all.
  const get = buildFetch({ fetch });
  const fetched = [];
  for (const [name, want] of Object.entries(KERNEL_FILES)) {
    try {
      readKernelFile(name, { env });
      continue;
    } catch (error) {
      if (!(error instanceof KernelMissing)) throw error;
    }
    if (fetched.length === 0) log(`Fetching Lean's kernel once (about 2.3 MB) from github.com/${KERNEL_REPOSITORY}; each file is checked against its BLAKE3 digest. Nothing about the app is sent.`);
    const url = `${RAW_URL}/${KERNEL_REPOSITORY}/${KERNEL_COMMIT}/${want.path}`;
    let response;
    try {
      response = await get(url);
    } catch (error) {
      if (error.code === 'build.host-not-allowed') throw error;
      throw new KernelMissing(`${url} did not answer: ${error.cause?.code ?? error.message}`);
    }
    if (!response.ok) throw new KernelMissing(`${url} answered HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const got = admittedLabel(bytes);
    if (got !== want.kappa) throw new KernelMissing(`${url} decodes to ${got ?? 'nothing'}, not the pinned ${want.kappa}`);
    writeAtomic(kernelFile(name, env), bytes);
    fetched.push(name);
  }
  return fetched;
}
