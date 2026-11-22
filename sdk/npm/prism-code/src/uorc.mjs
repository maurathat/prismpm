/**
 * The holo container: a self-contained raw UORC archive of ordered objects
 * (ADR-017; UOR-Foundation/compression `Uorc.Codec.Archive`, what
 * `uorc::archive::raw_objects` writes). The Rust twin is
 * `crates/prismpm/src/holo/v5.rs`; both are held to the same bytes.
 *
 *   "UORC" 02 profile 00 00 uleb(count) uleb(length)* uleb(bodyLength) body seal[32]
 *
 * The profile byte says how the archive seals and names what it holds:
 *
 *   1  holo v5 (ADR-017): the seal is UORC-SHA256-CHAIN-v1 of every byte before it; a κ-label is `sha256:`.
 *   2  holo v6 (ADR-018): the seal is plain BLAKE3 of every byte before it; a κ-label is `blake3:`.
 *
 * `kappa`, `isKappa` and `chain` keep their v5 meaning; `labelOf`, `isLabel` and `sealOf` take the format.
 */
import { DigestMismatchError, fail } from './errors.mjs';
import { sha256HexSync } from './sha256.mjs';
import { blake3, kappa as blake3Label } from './blake3.mjs';

/** The magic of a holo v5: UORC format 2, profile 1. */
export const MAGIC = Uint8Array.of(0x55, 0x4f, 0x52, 0x43, 0x02, 0x01);
/** The magic of a holo v6: UORC format 2, profile 2 (ADR-018). */
export const MAGIC_V6 = Uint8Array.of(0x55, 0x4f, 0x52, 0x43, 0x02, 0x02);
export const SEAL_LENGTH = 32;
export const KAPPA_LENGTH = 71;
/** The decode budget every reader applies to an application holo. */
export const APPLICATION_BUDGET = Object.freeze({ objects: 16, bytes: 2 ** 30 });

const TAG = new TextEncoder().encode('UORC-SHA256-CHAIN-v1\0');

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const sha256 = (parts) => fromHex(sha256HexSync(concat(parts)));

/** The κ-label of `bytes`. */
export function kappa(bytes) {
  return `sha256:${sha256HexSync(bytes)}`;
}

/** Whether `label` is a well-formed κ-label. */
export function isKappa(label) {
  return typeof label === 'string' && /^sha256:[0-9a-f]{64}$/.test(label);
}

const noFormat = (format) => fail('archive.version', `there is no holo format ${format}`);

/** The κ-label of `bytes` in holo format 5 (`sha256:`) or 6 (`blake3:`). */
export function labelOf(format, bytes) {
  if (format === 6) return blake3Label(bytes);
  if (format === 5) return kappa(bytes);
  return noFormat(format);
}

/** Whether `label` is a well-formed κ-label of holo format 5 or 6. */
export function isLabel(format, label) {
  if (format === 5) return isKappa(label);
  return format === 6 && typeof label === 'string' && /^blake3:[0-9a-f]{64}$/.test(label);
}

/** The holo format a UORC archive's magic names: 5, 6, or null for anything else. */
export function formatOf(bytes) {
  if (bytes.length < 6 || !equal(bytes.subarray(0, 5), MAGIC.subarray(0, 5))) return null;
  return bytes[5] === 1 ? 5 : bytes[5] === 2 ? 6 : null;
}

/** The seal of `preimage` in holo format 5 (UORC-SHA256-CHAIN-v1) or 6 (BLAKE3), as bytes. */
export function sealOf(format, preimage) {
  if (format === 6) return blake3(preimage);
  if (format === 5) return chain(preimage);
  return noFormat(format);
}

/** The name of the seal a holo format uses, for messages. */
export const sealName = (format) => (format === 6 ? 'BLAKE3' : 'UORC-SHA256-CHAIN-v1');

/** Whether `bytes` start like a UORC archive. */
export function isUorc(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x55 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x43;
}

/** UORC-SHA256-CHAIN-v1 of `preimage`, as bytes. */
export function chain(preimage) {
  let c = sha256([TAG, Uint8Array.of(0)]);
  const whole = preimage.length - (preimage.length % 64);
  for (let at = 0; at < whole; at += 64) c = sha256([TAG, Uint8Array.of(1), c, preimage.subarray(at, at + 64)]);
  const tail = preimage.subarray(whole);
  return sha256([TAG, Uint8Array.of(2), c, Uint8Array.of(tail.length), tail]);
}

function uleb(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return Uint8Array.from(out);
}

function readUleb(bytes, at) {
  let value = 0;
  let scale = 1;
  const start = at;
  for (;;) {
    if (at >= bytes.length || at - start > 7) return null;
    const byte = bytes[at];
    at += 1;
    value += (byte & 0x7f) * scale;
    scale *= 0x80;
    if (byte < 0x80) {
      if (byte === 0 && at - start > 1) return null; // not the shortest form
      if (!Number.isSafeInteger(value)) return null;
      return [value, at];
    }
  }
}

/** The self-contained raw UORC archive of `objects`, in order, as a holo of `format` (5 unless 6 is asked for). */
export function writeObjects(objects, format = 5) {
  const magic = format === 6 ? MAGIC_V6 : format === 5 ? MAGIC : noFormat(format);
  const header = [magic, Uint8Array.of(0, 0), uleb(objects.length)];
  for (const object of objects) header.push(uleb(object.length));
  header.push(uleb(objects.reduce((n, o) => n + o.length, 0)));
  const preimage = concat([...header, ...objects]);
  return concat([preimage, sealOf(format, preimage)]);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The ordered objects of a raw self-contained UORC archive, its holo format
 * and whether its seal matches. The framing and the budget are enforced; the
 * seal is reported, so `inspect` can still look at a damaged holo.
 */
export function layout(bytes, budget = APPLICATION_BUDGET) {
  const format = formatOf(bytes);
  if (format === null) fail('archive.magic', 'a holo v5 or v6 file is a UORC archive (format 2, profile 1 or 2)');
  if (bytes.length < 8 + SEAL_LENGTH) fail('archive.bounds', 'UORC archive is truncated');
  const preimage = bytes.subarray(0, bytes.length - SEAL_LENGTH);
  const seal = bytes.subarray(bytes.length - SEAL_LENGTH);
  const sealed = equal(sealOf(format, preimage), seal);
  if (preimage[6] !== 0 || preimage[7] !== 0) fail('archive.bounds', 'a holo is a self-contained archive whose objects are stored raw');
  let read = readUleb(preimage, 8);
  if (!read) fail('archive.bounds', 'object count is not a ULEB128');
  const [count] = read;
  let at = read[1];
  if (count === 0 || count > budget.objects) fail('archive.bounds', `archive declares ${count} objects; a holo holds 1 to ${budget.objects}`);
  const lengths = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    read = readUleb(preimage, at);
    if (!read) fail('archive.bounds', 'object length is not a ULEB128');
    total += read[0];
    if (total > budget.bytes) fail('archive.bounds', 'archive exceeds the decode budget');
    lengths.push(read[0]);
    at = read[1];
  }
  read = readUleb(preimage, at);
  if (!read) fail('archive.bounds', 'body length is not a ULEB128');
  const [bodyLength, start] = read;
  if (bodyLength !== total || preimage.length - start !== total) {
    fail('archive.bounds', 'body length disagrees with the objects or the archive has trailing bytes');
  }
  const objects = [];
  let offset = start;
  for (const length of lengths) {
    objects.push({ offset, length, bytes: preimage.subarray(offset, offset + length) });
    offset += length;
  }
  return { format, objects, sealed, seal, preimage };
}

/** The ordered objects of a UORC archive whose seal matches; anything else throws. */
export function readObjects(bytes, budget = APPLICATION_BUDGET) {
  // The seal is checked before the framing, so any changed byte is an integrity failure, not a structural one.
  const format = formatOf(bytes);
  if (format !== null && bytes.length >= SEAL_LENGTH) {
    const preimage = bytes.subarray(0, bytes.length - SEAL_LENGTH);
    if (!equal(sealOf(format, preimage), bytes.subarray(bytes.length - SEAL_LENGTH))) {
      throw new DigestMismatchError(`integrity failure: the holo was altered: its ${sealName(format)} seal does not match`, { check: 'holo.integrity' });
    }
  }
  return layout(bytes, budget).objects.map((object) => object.bytes);
}
