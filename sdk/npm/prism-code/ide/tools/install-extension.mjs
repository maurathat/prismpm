// Install an extension from Open VSX by its content label.
//
// An extension is named by its id, its version and the BLAKE3 label of its package (`.vsix`). The package is fetched
// from the registry, and nothing of it is unpacked, read or written unless its bytes derive to that label, by
// prism-code's own blake3.mjs. So the registry is a place to fetch from, not something to trust: what is installed
// is what the pin names, or nothing. The SHA-256 the registry publishes is kept in a pin as a checked field.
//
//   node tools/install-extension.mjs [--pins tools/extension-pins.json] [--out public/ext] [<id> ...]
//       install every pinned extension, or only those named
//   node tools/install-extension.mjs --label <id>@<version> ...
//       print the pin of what the registry serves for each, and install nothing: how a pin is first made,
//       to be reviewed before it is committed
//
// Written under <out>/<id>/: the files of the package's `extension/` folder, and files.json listing them, which is
// the layout the workbench page loads an extension from. A package is untrusted data: it is only unpacked here,
// never run, and every path is held inside the extension's own folder.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { kappa } from '../../src/blake3.mjs';

export const REGISTRY = 'https://open-vsx.org';
export const MAX_PACKAGE = 25 * 1024 * 1024;
export const MAX_UNPACKED = 100 * 1024 * 1024;
export const MAX_ENTRIES = 20000;

const isLabel = (label) => typeof label === 'string' && /^blake3:[0-9a-f]{64}$/.test(label);
const isId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
const isVersion = (version) => typeof version === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) && !version.includes('..');

/** A refusal to install, with `code`: 'pin', 'unreachable', 'answer', 'too-large', 'other-bytes' or 'package'. */
export class InstallError extends Error {
  constructor(code, message) { super(message); this.name = 'InstallError'; this.code = code; }
}

/** Where the registry describes one version of an extension. The registry must be https, or http on this machine. */
export function versionAddress(registry, id, version) {
  if (!isId(id)) throw new InstallError('pin', `${JSON.stringify(id)} is not an extension id (namespace.name)`);
  if (!isVersion(version)) throw new InstallError('pin', `${JSON.stringify(version)} is not a version`);
  const base = new URL(registry);
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) throw new InstallError('pin', `the registry must be reached by https; ${base.origin} is not`);
  const [namespace, name] = [id.slice(0, id.indexOf('.')), id.slice(id.indexOf('.') + 1)];
  return `${base.origin}/api/${namespace}/${name}/${version}`;
}

/** The package's bytes for `{ id, version }`, as the registry serves them. Nothing about them is believed yet. */
export async function fetchPackage({ id, version }, { registry = REGISTRY, fetch: get = fetch } = {}) {
  const address = versionAddress(registry, id, version);
  let meta;
  try {
    const response = await get(address);
    if (!response.ok) throw new InstallError('answer', `${address} answered HTTP ${response.status}`);
    meta = await response.json();
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError('unreachable', `the registry did not answer for ${id} ${version} (${error.message})`);
  }
  const download = meta?.files?.download;
  let from;
  try { from = new URL(download); } catch { throw new InstallError('answer', `the registry names no package for ${id} ${version}`); }
  if (from.protocol !== 'https:' && from.origin !== new URL(registry).origin) throw new InstallError('answer', `the registry names a package at ${from.origin}, which is not reached by https`);
  const response = await get(from.href);
  if (!response.ok) throw new InstallError('answer', `${from.href} answered HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PACKAGE) throw new InstallError('too-large', `the package is ${declared} bytes, more than the ${MAX_PACKAGE} installed here`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_PACKAGE) throw new InstallError('too-large', `the package is ${bytes.length} bytes, more than the ${MAX_PACKAGE} installed here`);
  return bytes;
}

/** The pin of these bytes: what a reviewer commits. */
export const pinOf = ({ id, version }, bytes) => ({ id, version, kappa: kappa(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });

/** Hold bytes to a pin. Throws 'other-bytes' unless they derive to its BLAKE3 label, and to its SHA-256 when it names one. */
export function admitPackage(pin, bytes) {
  if (!isLabel(pin?.kappa)) throw new InstallError('pin', `the pin of ${pin?.id} names no BLAKE3 label`);
  const got = kappa(bytes);
  if (got !== pin.kappa) throw new InstallError('other-bytes', `the registry served bytes that are ${got}, not the ${pin.kappa} pinned for ${pin.id} ${pin.version}. Nothing was installed.`);
  if (pin.sha256 !== undefined && createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new InstallError('other-bytes', `the bytes of ${pin.id} ${pin.version} have the pinned BLAKE3 label and not the pinned SHA-256. Nothing was installed.`);
  return bytes;
}

/**
 * The files of a package's `extension/` folder, as `Map<path, bytes>`. The archive is read strictly: no encryption,
 * no zip64, stored or deflated entries only, every checksum held, and no path that leaves the folder.
 */
export function unpackPackage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = (why) => new InstallError('package', `the package is not one this installs: ${why}`);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw bad('it is not a zip archive');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff || size === 0xffffffff) throw bad('it is a zip64 archive');
  if (count > MAX_ENTRIES) throw bad(`it holds ${count} entries, more than ${MAX_ENTRIES}`);
  if (at + size > end) throw bad('its directory runs past its end');
  const files = new Map();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw bad('its directory is broken');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const plain = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const mode = view.getUint32(at + 38, true) >>> 16;
    const local = view.getUint32(at + 42, true);
    let name;
    try { name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength)); } catch { throw bad('a name in it is not text'); }
    at += 46 + nameLength + skip;
    if (flags & 1) throw bad(`${JSON.stringify(name)} is encrypted`);
    if (packed === 0xffffffff || plain === 0xffffffff || local === 0xffffffff) throw bad('it is a zip64 archive');
    if (name.endsWith('/')) continue;
    if (!name.startsWith('extension/')) continue;
    // A link, or anything that is not a plain file: a unix mode is given only by some writers, so 0 is a file.
    if (mode !== 0 && (mode & 0o170000) !== 0o100000) throw bad(`${JSON.stringify(name)} is not a plain file`);
    const path = name.slice('extension/'.length);
    const parts = path.split('/');
    if (path === '' || parts.some((part) => part === '' || part === '.' || part === '..') || path.includes('\\') || path.includes('\0') || parts[0].includes(':')) throw bad(`${JSON.stringify(name)} is not a path inside the extension`);
    if (files.has(path)) throw bad(`${JSON.stringify(path)} is in it twice`);
    total += plain;
    if (total > MAX_UNPACKED) throw bad(`it unpacks to more than ${MAX_UNPACKED} bytes`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw bad(`${JSON.stringify(path)} has no entry where the directory says`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) throw bad(`${JSON.stringify(path)} runs past the end`);
    const data = bytes.subarray(start, start + packed);
    let body;
    if (method === 0) body = data;
    else if (method === 8) {
      try { body = new Uint8Array(inflateRawSync(data, { maxOutputLength: plain + 1 })); } catch { throw bad(`${JSON.stringify(path)} does not inflate`); }
    } else throw bad(`${JSON.stringify(path)} is packed by a method this does not read`);
    if (body.length !== plain || crc32(body) !== crc) throw bad(`${JSON.stringify(path)} is not the bytes its checksum names`);
    files.set(path, body);
  }
  if (!files.has('package.json')) throw bad('it has no extension/package.json');
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Install one pinned extension into `out`. Resolves `{ id, version, kappa, files }`. Throws an InstallError, having
 * written nothing, when the registry's bytes are not the pinned ones or the package is not one this installs.
 */
export async function installExtension(pin, { out, registry = REGISTRY, fetch: get = fetch } = {}) {
  const bytes = admitPackage(pin, await fetchPackage(pin, { registry, fetch: get }));
  const files = unpackPackage(bytes);
  const folder = join(out, pin.id);
  rmSync(folder, { recursive: true, force: true });
  for (const [path, body] of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), body);
  }
  writeFileSync(join(folder, 'files.json'), JSON.stringify([...files.keys()]));
  return { id: pin.id, version: pin.version, kappa: pin.kappa, files: files.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ide = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const take = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args.splice(i, 2)[1]; };
  if (args[0] === '--label') {
    for (const named of args.slice(1)) {
      const [id, version] = named.split('@');
      console.log(JSON.stringify(pinOf({ id, version }, await fetchPackage({ id, version }))));
    }
  } else {
    const pins = JSON.parse(readFileSync(resolve(take('--pins', join(ide, 'tools', 'extension-pins.json'))), 'utf8'));
    const out = resolve(take('--out', join(ide, 'public', 'ext')));
    const wanted = pins.extensions.filter((pin) => args.length === 0 || args.includes(pin.id));
    for (const id of args) if (!wanted.some((pin) => pin.id === id)) { console.error(`${id} is not pinned`); process.exitCode = 1; }
    for (const pin of wanted) {
      try {
        const done = await installExtension(pin, { out, registry: pins.registry ?? REGISTRY });
        console.log(`installed ${done.id} ${done.version}, ${done.files} files, ${done.kappa}`);
      } catch (error) {
        console.error(`not installed: ${pin.id} ${pin.version}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}
