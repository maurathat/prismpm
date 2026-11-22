// A model as one file a reader can take out of the browser: a tar archive that unpacks into a LexLean project.
//
// The archive is written the same way every time: paths in order, no dates, no owners, one mode. So the same model
// gives the same bytes, and the archive has one UOR content address, the BLAKE3 label prism-code's blake3.mjs gives.
// Two people who download the same model hold the same label; a model changed by one character has another.
//
// The format is ustar (POSIX.1-1988), which every tar reads. Nothing is compressed.

import { kappa } from './prism-code/blake3.mjs';

const enc = new TextEncoder();
const BLOCK = 512;

function field(block, at, length, text) {
  const bytes = enc.encode(text);
  if (bytes.length > length) throw new Error(`"${text}" does not fit a tar field of ${length} bytes`);
  block.set(bytes, at);
}

/** Split a path into ustar's prefix and name, at a slash, or throw when it fits neither. */
function splitPath(path) {
  if (enc.encode(path).length <= 100) return { prefix: '', name: path };
  for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
    const prefix = path.slice(0, at);
    const name = path.slice(at + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100 && name.length > 0) return { prefix, name };
  }
  throw new Error(`${path} is too long for a tar archive`);
}

function header(path, size) {
  const block = new Uint8Array(BLOCK);
  const { prefix, name } = splitPath(path);
  field(block, 0, 100, name);
  field(block, 100, 8, '0000644\0');
  field(block, 108, 8, '0000000\0');
  field(block, 116, 8, '0000000\0');
  field(block, 124, 12, size.toString(8).padStart(11, '0') + '\0');
  field(block, 136, 12, '00000000000\0');
  block.fill(0x20, 148, 156); // the checksum is taken with its own field as spaces
  block[156] = 0x30; // a regular file
  field(block, 257, 6, 'ustar\0');
  field(block, 263, 2, '00');
  field(block, 345, 155, prefix);
  const sum = block.reduce((total, byte) => total + byte, 0);
  field(block, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}

/**
 * The archive of a model: `files` is `{ path: text }`, each path relative to the model's folder, with or without a
 * leading slash. Every file is placed under `folder/`. Resolves nothing asynchronously: returns `{ bytes, label }`.
 */
export function modelTar(files, { folder = 'model' } = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(folder)) throw new Error('the folder name may hold letters, digits, dots, dashes and underscores only');
  const entries = Object.entries(files).map(([path, text]) => [path.replace(/^\/+/, ''), text]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [];
  for (const [path, text] of entries) {
    // A path that could leave the folder it is unpacked into is refused, whoever wrote the listing.
    if (path === '' || path.split('/').some((part) => part === '' || part === '.' || part === '..') || path.includes('\\') || path.includes('\0')) throw new Error(`${JSON.stringify(path)} is not a path inside the model`);
    const body = enc.encode(text);
    parts.push(header(`${folder}/${path}`, body.length), body, new Uint8Array((BLOCK - (body.length % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK)); // the end of the archive
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return { bytes, label: kappa(bytes) };
}

const strict = new TextDecoder('utf-8', { fatal: true });
const textAt = (block, at, length) => { let end = at; while (end < at + length && block[end] !== 0) end++; return strict.decode(block.subarray(at, end)); };

/**
 * A model read back from an archive: `{ folder, files: { path: text }, entry }`, the paths relative to the model's
 * folder and without a leading slash, `entry` the file its lexlean.toml names first. The archive is read strictly,
 * since it may come from anywhere: every entry must be a regular file of text under one folder, with a header whose
 * checksum holds and a path that stays inside the folder. Anything else is refused, and nothing is returned.
 */
export function readModelTar(bytes, { limit = 32 * 1024 * 1024 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length % BLOCK !== 0) throw new Error('not a tar archive: its length is not whole blocks');
  if (bytes.length > limit) throw new Error(`the archive is ${bytes.length} bytes, more than the ${limit} read here`);
  const files = {};
  let folder = null;
  let at = 0;
  while (at + BLOCK <= bytes.length) {
    const block = bytes.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break; // the end of the archive
    const stated = parseInt(textAt(block, 148, 8).trim() || 'x', 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
    if (stated !== sum) throw new Error('not a tar archive this page reads: a header does not add up');
    const kind = block[156];
    if (kind !== 0x30 && kind !== 0) throw new Error('the archive holds something other than plain files, which a model does not');
    const prefix = textAt(block, 345, 155);
    const full = (prefix ? prefix + '/' : '') + textAt(block, 0, 100);
    const size = parseInt(textAt(block, 124, 12).trim() || 'x', 8);
    if (!Number.isInteger(size) || size < 0 || at + BLOCK + size > bytes.length) throw new Error(`${JSON.stringify(full)} has a size the archive cannot hold`);
    const parts = full.split('/');
    if (parts.length < 2 || parts.some((part) => part === '' || part === '.' || part === '..') || full.includes('\\')) throw new Error(`${JSON.stringify(full)} is not a path inside a model's folder`);
    folder ??= parts[0];
    if (parts[0] !== folder) throw new Error('the archive holds more than one folder');
    const path = parts.slice(1).join('/');
    if (path in files) throw new Error(`${JSON.stringify(path)} is in the archive twice`);
    let text;
    try { text = strict.decode(bytes.subarray(at + BLOCK, at + BLOCK + size)); } catch { throw new Error(`${JSON.stringify(path)} is not text`); }
    files[path] = text;
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (folder === null) throw new Error('the archive is empty');
  const entry = /entrypoints\s*=\s*\[\s*"([^"]+)"/.exec(files['lexlean.toml'] ?? '')?.[1];
  if (!entry || !(entry in files)) throw new Error('the archive is not a LexLean project: its lexlean.toml names no file that is in it');
  return { folder, files, entry };
}
