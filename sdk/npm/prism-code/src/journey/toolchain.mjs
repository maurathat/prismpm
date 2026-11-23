/**
 * The build's toolchain, admitted through two ports and no disk: a store that keeps bytes under their UOR
 * κ-label (BLAKE3), and a fetch. It runs the same in Node and in a browser worker.
 *
 * The one module admitted this way today is LexLean's front end, so the refusals carry its registered codes.
 * A WebAssembly module is admitted only when its decoded bytes have the pinned κ-label. Fetched bytes are
 * decoded, hashed and compiled as they arrive, all three at once, so the hash costs no time of its own; the
 * compiled module is given to nobody until the label is known to be the pinned one. Bytes read back from the
 * store are held to the same label, so a store is trusted no further than the label it was asked for.
 *
 * The store port is `{ get(label) → bytes | null, put(bytes) → label }`. `blobStore` adapts a store that
 * names the same two requests `getBlob` and `putBlob`.
 */
import { PrismCodeError } from '../errors.mjs';
import { Blake3, kappa, toHex } from '../blake3.mjs';
import { rememberSource } from './module-source.mjs';

/** A store that keeps what it is given for as long as the process or page lives. */
export function memoryStore() {
  const kept = new Map();
  return {
    async get(label) { return kept.get(label) ?? null; },
    async put(bytes) { const label = kappa(bytes); kept.set(label, bytes); return label; },
  };
}

/** The store port over a store whose requests are `getBlob(label)` and `putBlob(bytes) → { label }`. */
export function blobStore(store) {
  return {
    async get(label) { return (await store.getBlob(label)) ?? null; },
    async put(bytes) { const put = await store.putBlob(bytes); return typeof put === 'string' ? put : put.label; },
  };
}

const joined = (chunks, size) => {
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
  return all;
};

/** How a pin is served: what it names, else gzip when its URL is a `.gz`. */
const encodingOf = (pin) => pin.encoding ?? (/\.gz$/.test(pin.url ?? '') ? 'gzip' : 'identity');

/**
 * Decode, hash and compile a served module as its bytes arrive. Resolves `{ module, bytes }`, the decoded
 * bytes, only when they have `label`; throws `lexlean.wasm-mismatch` otherwise, and the compiled module is dropped.
 */
export async function compileAdmitted(response, { label, encoding = 'identity', what = 'the module' }) {
  const plain = encoding === 'gzip' ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
  const streamed = typeof WebAssembly.compileStreaming === 'function';
  const [toHash, toCompile] = streamed ? plain.tee() : [plain, null];
  const compiling = streamed ? WebAssembly.compileStreaming(new Response(toCompile, { headers: { 'content-type': 'application/wasm' } })) : null;
  // Settled below; bytes that are not a module must not surface as an unhandled rejection before the label is known.
  compiling?.catch(() => {});
  const hasher = new Blake3();
  const chunks = [];
  let size = 0;
  const reader = toHash.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      chunks.push(value);
      size += value.length;
    }
  } catch (error) {
    throw new PrismCodeError('lexlean.wasm-mismatch', `${what} did not decode (${error.message}), so it is not the pinned ${label}`);
  }
  const got = `blake3:${toHex(hasher.digest())}`;
  if (got !== label) throw new PrismCodeError('lexlean.wasm-mismatch', `${what} decodes to ${got}, not the pinned ${label}`);
  const bytes = joined(chunks, size);
  // The admitted bytes stay with the module, so a run can compile them again if the compiled code breaks.
  return { module: rememberSource(compiling ? await compiling : await WebAssembly.compile(bytes), bytes), bytes };
}

/**
 * The pinned module, compiled: from the store when it holds bytes with the pin's label, else fetched once from
 * the pin's URL, admitted, and kept. `pin` is `{ kappa, url, encoding }`. Resolves `{ module, from, ms }`, `from`
 * being `store` or `fetch`. Throws `lexlean.wasm-unavailable` when it is in neither place, and `lexlean.wasm-mismatch`
 * for bytes that are not the pinned ones.
 */
export async function admitModule(pin, { store = null, fetch = null, log = () => {}, what = 'the module' } = {}) {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const kept = store ? await store.get(pin.kappa) : null;
  // A store's word is not taken: what it returns is hashed again before it is compiled.
  if (kept && kappa(kept) === pin.kappa) return { module: rememberSource(await WebAssembly.compile(kept), kept), from: 'store', ms: ms() };
  if (!fetch || !pin.url) throw new PrismCodeError('lexlean.wasm-unavailable', `${what} is not in the store, and there is nowhere to fetch it from`);
  log(`Fetching ${what} once; it is checked against its κ-label as it arrives.`);
  const response = await fetch(pin.url);
  if (!response.ok) throw new PrismCodeError('lexlean.wasm-unavailable', `${pin.url} answered HTTP ${response.status}`);
  const { module, bytes } = await compileAdmitted(response, { label: pin.kappa, encoding: encodingOf(pin), what });
  if (store) await store.put(bytes);
  return { module, from: 'fetch', ms: ms() };
}

/**
 * Bytes that are not a module (Lean's kernel loader, its library), held to their κ-label the same way: from the
 * store when it holds bytes with the pin's label, else fetched once, decoded and hashed as they arrive, and kept.
 * `pin` is `{ kappa, url, encoding }`. Resolves the decoded bytes. `refuse` makes the error thrown for bytes that
 * cannot be had or are not the pinned ones, so each caller refuses in its own registered way.
 */
export async function admitBytes(pin, { store = null, fetch = null, what = 'the file', refuse = (message) => new PrismCodeError('lexlean.wasm-unavailable', message) } = {}) {
  const kept = store ? await store.get(pin.kappa) : null;
  if (kept && kappa(kept) === pin.kappa) return kept;
  if (!fetch || !pin.url) throw refuse(`${what} is not in the store, and there is nowhere to fetch it from`);
  let response;
  try {
    response = await fetch(pin.url);
  } catch (error) {
    if (error.code === 'build.host-not-allowed') throw error;
    throw refuse(`${pin.url} did not answer: ${error.cause?.code ?? error.message}`);
  }
  if (!response.ok) throw refuse(`${pin.url} answered HTTP ${response.status}`);
  const hasher = new Blake3();
  const chunks = [];
  let size = 0;
  try {
    const reader = (encodingOf(pin) === 'gzip' ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      chunks.push(value);
      size += value.length;
    }
  } catch (error) {
    throw refuse(`${what} did not decode (${error.message}), so it is not the pinned ${pin.kappa}`);
  }
  const got = `blake3:${toHex(hasher.digest())}`;
  if (got !== pin.kappa) throw refuse(`${what} decodes to ${got}, not the pinned ${pin.kappa}`);
  const bytes = joined(chunks, size);
  if (store) await store.put(bytes);
  return bytes;
}
