// A read-only client for kappa-registry's blob endpoint (https://github.com/UOR-Foundation/kappa-registry).
//
// The registry stores content under its kappa-label and answers at the OCI distribution address
//
//   GET <registry>/v2/<namespace>/blobs/<label>        label = blake3:<64 hex>
//
// for any origin (it reflects the request's Origin). This client asks for a blob by its BLAKE3 label and gives the
// bytes back only when they derive to that label, by prism-code's own blake3.mjs. So the registry is a place to fetch
// from, not something to trust: a registry that answers with other bytes is refused, whichever registry it is.
//
// Read only. Nothing is pushed, no credential is sent, and the request carries nothing but the address.

import { kappa } from './prism-code/blake3.mjs';

export const isLabel = (label) => typeof label === 'string' && /^blake3:[0-9a-f]{64}$/.test(label);
// A namespace as the registry takes it: path segments of lowercase letters, digits and . _ - between slashes.
const isNamespace = (namespace) => typeof namespace === 'string' && namespace.length <= 255 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(namespace);

/** A failure to get a blob, with `code`: 'address', 'unreachable', 'absent', 'answer' or 'other-bytes'. */
export class RegistryError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'RegistryError'; this.code = code; Object.assign(this, detail); }
}

/**
 * The address of a blob. The registry must be https, or http on this machine: a model's bytes are checked whatever
 * carries them, but an address typed into a page should not quietly send a request in the clear across a network.
 */
export function blobAddress(registry, namespace, label) {
  let base;
  try { base = new URL(registry); } catch { throw new RegistryError('address', `${JSON.stringify(registry)} is not an address`); }
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '[::1]';
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) throw new RegistryError('address', `the registry must be reached by https, or by http on this machine; ${base.origin} is neither`);
  if (base.username || base.password) throw new RegistryError('address', 'the registry address must not carry a name or a password');
  if (!isNamespace(namespace)) throw new RegistryError('address', `${JSON.stringify(namespace)} is not a registry namespace`);
  if (!isLabel(label)) throw new RegistryError('address', `${JSON.stringify(label)} is not a BLAKE3 label (blake3: and 64 lowercase hex digits)`);
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}/v2/${namespace}/blobs/${label}`;
}

/**
 * The bytes of the blob named `label`, from `registry` under `namespace`. Resolves `{ bytes, address }` only when
 * the bytes derive to the label. Rejects with a RegistryError otherwise; `limit` bounds what is read.
 */
export async function fetchBlob(registry, namespace, label, { fetch: get = fetch, limit = 64 * 1024 * 1024 } = {}) {
  const address = blobAddress(registry, namespace, label);
  let response;
  try {
    response = await get(address, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch (error) {
    throw new RegistryError('unreachable', `the registry at ${new URL(address).origin} did not answer, or does not let this page read from it (${error?.message ?? error})`, { address });
  }
  if (response.status === 404) throw new RegistryError('absent', `the registry has no blob ${label} under ${namespace}`, { address });
  if (!response.ok) throw new RegistryError('answer', `the registry answered HTTP ${response.status} for ${label}`, { address, status: response.status });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new RegistryError('answer', `the blob is ${declared} bytes, more than the ${limit} this page reads`, { address });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) throw new RegistryError('answer', `the blob is ${bytes.length} bytes, more than the ${limit} this page reads`, { address });
  const got = kappa(bytes);
  if (got !== label) throw new RegistryError('other-bytes', `the registry answered with bytes that are ${got}, not the ${label} asked for. Nothing was opened.`, { address, got });
  return { bytes, address };
}
