// Keep every recent build of the site reachable by label. Run last, after build-offline-site.mjs.
// Usage: node tools/build-kappa-store.mjs <out dir> [--from <address or folder of the site as published>] [--keep 20]
//
//   <out>/kappa/<64 hex>      any file of any kept build, at the hex of its BLAKE3 label. A build's listing
//                             (offline.json) is a file like any other, at the hex of its own label, which is the
//                             label that names the build.
//   <out>/kappa/index.json    the builds kept, newest first: { schema, builds: [{ label, commit }] }
//   <out>/ide.json            gains "store": "kappa/"
//
// Why: the site is rebuilt on every change, and a path then holds the new build's bytes. So the label of an earlier
// build stopped resolving the moment the next was published, and whoever named the IDE by that label was refused.
// Here nothing is fetched by path. A label is an address that never holds other bytes, so two builds never share
// one, a file two builds have in common is kept once, and an answer may be cached for ever.
//
// The builds kept are this one, the newest of the builds the published site keeps, up to `--keep` in all, and any
// build tools/kept-labels.json names, however old. Each kept build is read from the published site by label, and
// every file is taken only as the bytes its label names. A published site that cannot be read, or a kept file that
// is missing or is other bytes, stops this build: history is not dropped quietly. A site that has no kappa/ yet has
// no history, and that alone is not a failure.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../../src/blake3.mjs';

export const STORE = 'kappa/';
export const STORE_SCHEMA = 'prism-ide/kappa-store/1';
const LABEL = /^blake3:[0-9a-f]{64}$/;
const hexOf = (label) => label.slice('blake3:'.length);
const ide = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A reader of the site as published: `(name) => Uint8Array | null`, null only when the site says the file is not there. */
export function readerOf(from, { fetch: get = fetch } = {}) {
  if (!/^https?:\/\//.test(from)) {
    const root = resolve(from);
    return async (name) => (existsSync(join(root, name)) ? new Uint8Array(readFileSync(join(root, name))) : null);
  }
  const base = from.replace(/\/?$/, '/');
  return async (name) => {
    const response = await get(base + name, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${base}${name} answered HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

/**
 * Write the store into `out`. `read` reads the published site (or is null when there is none to read); `pinned`
 * are labels kept however old. Returns `{ label, builds, files, bytes, carried }`.
 */
export async function buildKappaStore(out, { read = null, keep = 20, pinned = [] } = {}) {
  const store = join(out, STORE);
  mkdirSync(store, { recursive: true });
  const held = new Set();
  let bytesKept = 0;
  const put = (label, bytes) => {
    if (kappa(bytes) !== label) throw new Error(`bytes offered for ${label} are ${kappa(bytes)}`);
    if (held.has(label)) return;
    held.add(label);
    bytesKept += bytes.length;
    writeFileSync(join(store, hexOf(label)), bytes);
  };

  // This build: its listing, and every file the listing names, read from the folder about to be published.
  const listingBytes = new Uint8Array(readFileSync(join(out, 'offline.json')));
  const label = kappa(listingBytes);
  const listing = JSON.parse(new TextDecoder().decode(listingBytes));
  put(label, listingBytes);
  for (const [path, entry] of Object.entries(listing.files)) put(entry.kappa, new Uint8Array(readFileSync(join(out, path))));
  const builds = [{ label, commit: listing.commit ?? null }];

  // The builds the published site keeps, carried forward by label.
  let carried = 0;
  if (read) {
    const indexBytes = await read(STORE + 'index.json');
    const before = indexBytes === null ? [] : JSON.parse(new TextDecoder().decode(indexBytes)).builds;
    if (!Array.isArray(before)) throw new Error('the published kappa/index.json does not list its builds');
    const wanted = new Set(pinned);
    for (const build of before) {
      if (!LABEL.test(build?.label ?? '') || build.label === label) continue;
      if (builds.length >= keep && !wanted.has(build.label)) continue;
      const kept = await read(STORE + hexOf(build.label));
      if (kept === null) throw new Error(`the published site lists the build ${build.label} and does not hold its listing`);
      put(build.label, kept);
      const files = JSON.parse(new TextDecoder().decode(kept)).files;
      for (const [path, entry] of Object.entries(files)) {
        if (held.has(entry.kappa)) continue;
        const bytes = await read(STORE + hexOf(entry.kappa));
        if (bytes === null) throw new Error(`the published site does not hold ${path} of the build ${build.label} (${entry.kappa})`);
        put(entry.kappa, bytes);
        carried++;
      }
      builds.push({ label: build.label, commit: build.commit ?? null });
    }
    for (const want of wanted) if (want !== label && !builds.some((build) => build.label === want)) throw new Error(`tools/kept-labels.json names ${want}, which the published site does not keep`);
  }

  writeFileSync(join(store, 'index.json'), JSON.stringify({ schema: STORE_SCHEMA, builds }) + '\n');
  const named = JSON.parse(readFileSync(join(out, 'ide.json'), 'utf8'));
  if (named.kappa !== label) throw new Error(`ide.json names ${named.kappa}, and offline.json is ${label}`);
  writeFileSync(join(out, 'ide.json'), JSON.stringify({ ...named, store: STORE }) + '\n');
  return { label, builds: builds.length, files: held.size, bytes: bytesKept, carried };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outArg, ...rest] = process.argv.slice(2);
  if (!outArg) { console.error('usage: node tools/build-kappa-store.mjs <out dir> [--from <address or folder>] [--keep 20]'); process.exit(64); }
  const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
  const from = option('--from');
  const pinned = JSON.parse(readFileSync(join(ide, 'tools', 'kept-labels.json'), 'utf8')).labels;
  const made = await buildKappaStore(resolve(outArg), { read: from ? readerOf(from) : null, keep: Number(option('--keep') ?? 20), pinned });
  console.log(`kappa: ${made.builds} build${made.builds === 1 ? '' : 's'} kept by label, ${made.files} files, ${(made.bytes / 1048576).toFixed(1)} MiB; ${made.carried} carried from the published site; this build is ${made.label}`);
}
