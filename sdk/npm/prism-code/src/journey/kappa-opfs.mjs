/**
 * Prism's content-addressed store in a browser: the origin's private file
 * system, laid out as `kappa-store.mjs` lays out a disk, so a page keeps what
 * it has already fetched and proved and does not do it again on the next visit.
 *
 * Bytes are kept under their BLAKE3 label (`blake3:` and 64 hex digits, the
 * label kappa-registry and Hologram's store use), and every read re-derives
 * it, so bytes that are not what their name says are not returned. The SHA-256
 * κ-label that prism-code's records and reuse rules name things by is kept as
 * a checked field: it leads to the BLAKE3 label, and bytes asked for by it are
 * returned only when they re-derive to both. Reuse is decided by
 * `kappa-rules.mjs` alone. What is stored is what this origin's own pages
 * wrote: the store is trusted no further than the origin that serves the
 * page's code.
 *
 * Layout under `prism-kappa/`: `blake3/` holds bytes by BLAKE3 label,
 * `sha256/` holds, per κ-label, the BLAKE3 label of those bytes, and
 * `derived/` holds, per derivation key, the BLAKE3 label of the result. A
 * store written before this layout (`bytes/`, by SHA-256) is removed on open:
 * nothing in it is read.
 */
import { kappa as blake3Label } from '../blake3.mjs';
import { sha256Hex } from '../sha256.mjs';
import { isKappa } from '../uorc.mjs';
import { proofFacts, proofRealization } from './kappa-rules.mjs';
import { imageFacts, imageRealization } from './kernel-image.mjs';

const enc = new TextEncoder();
const label = async (bytes) => `sha256:${await sha256Hex(bytes)}`;
const dec = new TextDecoder();
/** Whether `name` is a BLAKE3 label, as this store addresses bytes. */
export const isBlake3 = (name) => typeof name === 'string' && /^blake3:[0-9a-f]{64}$/.test(name);

/**
 * The store, or one that keeps nothing where the browser has no origin-private file system or refuses it
 * (a private window, a blocked site). Every method resolves; none throws. `put` resolves the bytes' κ-label,
 * as the reuse rules name them; `address` resolves the BLAKE3 label they are kept under. `get` takes either
 * and resolves bytes only when they re-derive to the label asked for.
 */
export async function opfsStore({ root = null } = {}) {
  let top = root;
  try {
    top ??= await (await navigator.storage.getDirectory()).getDirectoryHandle('prism-kappa', { create: true });
  } catch {
    top = null;
  }
  const off = top === null;
  // The layout before BLAKE3. Its names are not this store's, so nothing in it could be found again.
  try { await top?.removeEntry?.('bytes', { recursive: true }); } catch { /* absent, or not removable: it is only unused */ }
  const dirOf = async (kind, name, create) => {
    const k = await top.getDirectoryHandle(kind, { create });
    return k.getDirectoryHandle(name.slice(7, 9), { create });
  };
  const read = async (kind, name) => {
    try {
      const file = await (await (await dirOf(kind, name, false)).getFileHandle(name.slice(9))).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  };
  const write = async (kind, name, bytes) => {
    try {
      const handle = await (await dirOf(kind, name, true)).getFileHandle(name.slice(9), { create: true });
      // A writable stream replaces the file only on close, so a reader never sees half of it.
      const stream = await handle.createWritable();
      await stream.write(bytes);
      await stream.close();
    } catch {
      // A store that cannot keep something has not kept it; the next visit does the work again.
    }
  };
  /** The BLAKE3 label kept under `name` in `kind`, or null. */
  const pointer = async (kind, name) => {
    const bytes = await read(kind, name);
    const address = bytes ? dec.decode(bytes) : '';
    return isBlake3(address) ? address : null;
  };
  /** The BLAKE3 label a name leads to: itself, or what the κ-label was kept under. */
  const address = async (name) => (off ? null : isBlake3(name) ? name : isKappa(name) ? pointer('sha256', name) : null);
  return {
    off,
    address,
    async put(bytes) {
      const name = await label(bytes);
      if (!off) {
        const at = blake3Label(bytes);
        await write('blake3', at, bytes);
        await write('sha256', name, enc.encode(at));
      }
      return name;
    },
    async get(name) {
      const at = await address(name);
      const bytes = at ? await read('blake3', at) : null;
      // The universal check under every stored byte: bytes that are not what their name says are not there.
      if (!bytes || blake3Label(bytes) !== at) return null;
      // Asked for by κ-label, the bytes must be that too: what led here is checked, not believed.
      return at === name || (await label(bytes)) === name ? bytes : null;
    },
    async bind(key, name) {
      const at = await address(name);
      if (at) await write('derived', key, enc.encode(at));
    },
    async bound(key) {
      if (off || !isKappa(key)) return null;
      return pointer('derived', key);
    },
  };
}

/** Keep an accepted proof: its bytes, its realization, and the key that leads to it. Resolves the realization's κ-label. */
export async function keepProof(store, { key, kernel, library, statement, policy, text, axioms }) {
  const bundle = await store.put(enc.encode(text));
  const name = await store.put(proofRealization({ key, kernel, library, statement, policy, bundle, axioms }));
  await store.bind(key, name);
  return name;
}

/** Look a proof up by its derivation key. Resolves `{ facts, proof, text }`, as `kappa-store.mjs` does; the caller asks the rule. */
export async function findProof(store, { key, kernel, library, statement, policy }) {
  const name = await store.bound(key);
  const bytes = name ? await store.get(name) : null;
  let bundle = null;
  if (bytes) {
    try {
      const named = JSON.parse(new TextDecoder().decode(bytes)).bundle;
      bundle = isKappa(named) ? await store.get(named) : null;
    } catch {
      bundle = null;
    }
  }
  return proofFacts({ key, kernel, library, statement, policy }, bytes, () => bundle);
}

/** Keep the image of a kernel that loaded its library: the image, its realization, and the key that leads to it. */
export async function keepImage(store, { key, loader, kernel, library, bytes }) {
  const image = await store.put(bytes);
  const name = await store.put(imageRealization({ key, loader, kernel, library, image }));
  await store.bind(key, name);
  return name;
}

/** Look an image up by its derivation key. Resolves `{ facts, image }`; the caller asks `reuseAdmits`. */
export async function findImage(store, { key, kernel, library }) {
  const name = await store.bound(key);
  const bytes = name ? await store.get(name) : null;
  // `get` returns bytes only when they re-derive to the label asked for, so the label is what the bytes are now.
  return imageFacts({ key, kernel, library }, bytes, async (label) => {
    const image = await store.get(label);
    return image ? { bytes: image, label } : null;
  });
}
