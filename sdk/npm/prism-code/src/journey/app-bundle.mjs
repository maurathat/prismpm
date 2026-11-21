/**
 * An app as one content-addressed bundle, for `prism_push` and `prism_pull`, as `docker push` and `docker pull` move
 * an image. Every object is named by the UOR κ-label of its bytes (BLAKE3), and the bundle by the label of its
 * manifest: the same app is the same address on every machine, and no byte is trusted for where it came from.
 *
 * The manifest (`prism/app-bundle/1`) names the model's files, the files a check and a proof read (`modelFiles`), and,
 * when the app is built, what was built: a rule app's record and the files of its page, or any other app's holo.
 * A store is a set of objects found by label:
 *
 *   (no reference)        this machine's Prism store, a folder of objects ($PRISM_HOME/kappa/apps)
 *   dir://<folder>        a folder of objects, `<folder>/<hex>`, that any static host can serve as it is
 *   https://<site>/<path> such a folder served by a static host the network boundary admits (pull only)
 *
 * Pull admits an object only when its bytes re-derive its label, then hands the model to Lean's kernel to prove
 * before anything runs (mcp.mjs): a bundle carries what was proved, never a verdict.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismCodeError } from '../errors.mjs';
// Every label here is a UOR κ-label, BLAKE3: `blake3:` and 64 hex digits.
import { kappa } from '../blake3.mjs';
import { buildFetch } from './hosts.mjs';
import { kappaDirectory } from './kappa-store.mjs';
import { modelFiles } from './model-files.mjs';

export const BUNDLE_SCHEMA = 'prism/app-bundle/1';

const enc = new TextEncoder();
const dec = new TextDecoder();
const isKappa = (label) => typeof label === 'string' && /^blake3:[0-9a-f]{64}$/.test(label);
/** This machine's store of apps: a folder of objects named by label, as a dir:// store is. */
const localFolder = (env) => join(kappaDirectory(env), 'apps');
const fail = (code, message) => {
  throw new PrismCodeError(code, message);
};

/** JSON with object keys in UTF-8 order and no whitespace: one manifest, one byte string, one label. */
const canonical = (value) => (Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value));

/** Every regular file under `dir`, `/`-separated and sorted. */
function filesUnder(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name), `${rel}${e.name}/`) : e.isFile() ? [`${rel}${e.name}`] : []));
}

/**
 * The bundle of the app in `dir`: `{ address, manifest, objects }`, `objects` a Map of label to bytes, the manifest's
 * own bytes among them under `address`. `session` says what is built (mcp.mjs's session record).
 */
export function bundleOf(dir, session) {
  const objects = new Map();
  const keep = (bytes) => {
    const label = kappa(bytes);
    objects.set(label, bytes);
    return label;
  };
  const { files, entry } = modelFiles(dir);
  const model = Object.fromEntries([...files].map(([path, bytes]) => [path, keep(new Uint8Array(bytes))]));
  const manifest = { schema: BUNDLE_SCHEMA, starter: session.starter ?? null, entry, model };
  const rule = session.status?.ruleApp;
  if (rule?.path && existsSync(rule.path)) {
    const site = rule.site && existsSync(rule.site) ? Object.fromEntries(filesUnder(rule.site).map((p) => [p, keep(new Uint8Array(readFileSync(join(rule.site, p))))])) : {};
    manifest.built = { kind: 'rule-app', record: keep(new Uint8Array(readFileSync(rule.path))), address: rule.address, semanticId: rule.semanticId, site };
  }
  // Any other app: its holo, one object, whose label is the app's built address.
  const holo = session.status?.built;
  if (!manifest.built && holo?.path && existsSync(holo.path)) {
    const label = keep(new Uint8Array(readFileSync(holo.path)));
    manifest.built = { kind: 'holo', holo: label, address: label, semanticId: holo.semanticId ?? null };
  }
  const bytes = enc.encode(canonical(manifest));
  const address = keep(bytes);
  return { address, manifest, objects };
}

/** Where a reference points: `{ kind: 'local' | 'dir' | 'https', at, address }`. */
export function parseReference(reference = '') {
  const [where, hash] = reference.includes('#') ? reference.split('#', 2) : isKappa(reference) ? ['', reference] : [reference, ''];
  const address = hash || null;
  if (address && !isKappa(address)) fail('bundle.reference', `${address} is not a κ-label: it is blake3: then 64 lowercase hex digits`);
  if (!where) return { kind: 'local', at: null, address };
  if (where.startsWith('dir://')) return { kind: 'dir', at: resolve(where.startsWith('dir://file:') ? fileURLToPath(where.slice(6)) : where.slice(6)), address };
  if (where.startsWith('https://')) return { kind: 'https', at: where.replace(/\/+$/, ''), address };
  return fail('bundle.reference', `${reference} is not a Prism store: give a κ-label, dir://<folder>#<κ>, or https://<site>/<path>#<κ>`);
}

/** The object file of a label inside a folder store. */
const objectFile = (folder, label) => join(folder, label.slice(label.indexOf(':') + 1));

/** Write the bundle to the store `reference` names. Resolves `{ address, reference, objects, bytes }`. */
export async function pushBundle(bundle, reference, { env = process.env } = {}) {
  const target = parseReference(reference);
  if (target.kind === 'https') fail('bundle.read-only', 'An https:// store is read-only here: push to dir://<folder> and publish that folder with any static host');
  let bytes = 0;
  if (target.kind === 'local' && env.PRISM_KAPPA === '0') fail('bundle.store-off', 'This machine keeps no Prism store (PRISM_KAPPA=0): push to dir://<folder> instead');
  const folder = target.kind === 'local' ? localFolder(env) : target.at;
  mkdirSync(folder, { recursive: true });
  for (const [label, b] of bundle.objects) {
    const file = objectFile(folder, label);
    if (!existsSync(file)) writeFileSync(file, b);
    bytes += b.length;
  }
  const named = target.kind === 'local' ? bundle.address : `${reference.split('#')[0]}#${bundle.address}`;
  return { address: bundle.address, reference: named, objects: bundle.objects.size, bytes };
}

/** A reader of objects from the store a reference names: `read(label)` resolves bytes, or null when absent. */
function readerOf(source, { env, fetch }) {
  if (source.kind !== 'https') {
    const folder = source.kind === 'local' ? localFolder(env) : source.at;
    return async (label) => (existsSync(objectFile(folder, label)) ? new Uint8Array(readFileSync(objectFile(folder, label))) : null);
  }
  const get = buildFetch({ fetch });
  return async (label) => {
    const response = await get(`${source.at}/${label.slice(label.indexOf(':') + 1)}`);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  };
}

/**
 * Fetch the bundle `reference` names and admit every object by its label. Resolves `{ address, manifest, files }`,
 * `files` a Map of the model's paths to bytes, plus the built record and page when the bundle has them.
 */
export async function pullBundle(reference, { env = process.env, fetch = globalThis.fetch } = {}) {
  const source = parseReference(reference);
  if (!source.address) fail('bundle.reference', `${reference} names no app: add #<κ>, the address prism_push gave`);
  const read = readerOf(source, { env, fetch });
  const admitted = async (label, what) => {
    const bytes = await read(label);
    if (!bytes) fail('bundle.missing', `${what} (${label}) is not in ${reference.split('#')[0] || "this machine's Prism store"}`);
    if (kappa(bytes) !== label) fail('bundle.altered', `${what} does not re-derive its label ${label}: it was altered, and nothing was written`);
    return bytes;
  };
  const manifest = JSON.parse(dec.decode(await admitted(source.address, 'The manifest')));
  if (manifest.schema !== BUNDLE_SCHEMA) fail('bundle.schema', `The manifest is a ${manifest.schema}, not a ${BUNDLE_SCHEMA}`);
  const files = new Map();
  for (const [path, label] of Object.entries(manifest.model ?? {})) {
    if (path.startsWith('/') || path.split('/').includes('..')) fail('bundle.path', `The manifest names ${path}, outside the app`);
    files.set(path, await admitted(label, path));
  }
  const built = manifest.built ? { record: manifest.built.record ? await admitted(manifest.built.record, 'The build record') : null, holo: manifest.built.holo ? await admitted(manifest.built.holo, 'The holo') : null, site: new Map() } : null;
  for (const [path, label] of Object.entries(manifest.built?.site ?? {})) built.site.set(path, await admitted(label, `site/${path}`));
  return { address: source.address, manifest, files, built };
}

/** Write pulled model files under `dir`, never over a file that differs. Resolves the paths written. */
export function writeModel(dir, files) {
  const written = [];
  for (const [path, bytes] of files) {
    const file = join(dir, path);
    if (existsSync(file)) {
      if (Buffer.compare(readFileSync(file), Buffer.from(bytes)) !== 0) fail('bundle.exists', `${file} already holds other bytes: pull into an empty project`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    written.push(path);
  }
  return written;
}
