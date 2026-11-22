/**
 * Reader for the `.holo` application archive. PrismPM writes holo v5, a UORC
 * archive of ordered objects named by κ (ADR-017, `src/uorc.mjs`); the
 * Hologram physical-v4 archive below stays readable and is never written.
 *
 * Legacy v4 is the archive PrismPM composed before v5 (`SPEC.md` §3, `crates/prismpm/src/holo/archive.rs`, encoded through
 * `Foundation.Holo.V1.Wire`).
 *
 * Layout, little-endian:
 *
 *   0      "HOLO"
 *   4      u16 physical version, 4
 *   6      u16 flags, 0
 *   8      u16 section count
 *   10     section table: per section u64 kind, u64 offset, u64 length
 *   ...    section bodies, contiguous, in table order
 *   end-32 BLAKE3 of everything before it (the archive fingerprint)
 *
 * Section kinds: 15 application manifest, 8 metadata, 14 extension, 16 content
 * blob. A content blob starts with its 71-byte `blake3:<hex>` label.
 */
import { DigestMismatchError, fail } from './errors.mjs';
import { blake3Hex, kappa as v4Label } from './blake3.mjs';
import { isUorc, labelOf, layout, readObjects, writeObjects } from './uorc.mjs';
import { sha256HexSync } from './sha256.mjs';

export const MAGIC = 'HOLO';
export const VERSION = 4;
/** Holo v5 (ADR-017): schema of the manifest object and the roles of the ordered objects. */
export const MANIFEST_SCHEMA_V5 = 'prism/holo/5';
export const PROVENANCE_SCHEMA_V5 = 'prismpm/model-provenance/2';
/** Holo v6 (ADR-018): v5's documents with every κ a `blake3:` label. */
export const MANIFEST_SCHEMA_V6 = 'prism/holo/6';
export const PROVENANCE_SCHEMA_V6 = 'prismpm/model-provenance/3';
const MANIFEST_SCHEMA = { 5: MANIFEST_SCHEMA_V5, 6: MANIFEST_SCHEMA_V6 };
/** A holo v6's optional objects after `model`, in this order, present when the manifest's rows list them (ADR-018). */
export const OPTIONAL_ROLES_V6 = Object.freeze(['snapshot', 'sources']);
export const SOURCES_SCHEMA = 'prism/model-sources/1';
const SNAPSHOT_SOURCE_KIND = 'lexlean-semantic-snapshot';

/** Whether a sources path is one that decides the model: forward-slashed, confined, and of the stated set. */
export function isSourcePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024 || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  if (['prism.toml', 'lexlean.toml', 'lexlean.lock'].includes(path)) return true;
  if (parts[0] === 'src' && parts.length >= 2 && path.endsWith('.lex.tex') && parts[parts.length - 1] !== '.lex.tex') return true;
  return parts[0] === 'language' && parts.length >= 2;
}

const byBytes = (a, b) => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

/** The files a holo v6's sources object holds, `[{ path, bytes }]` in index order; anything else throws `archive.sources`. */
export function readSources(bytes) {
  let objects;
  try {
    // One index and up to 4096 files: a model's sources are not bounded by the application's sixteen objects.
    objects = readObjects(bytes, { objects: 4097, bytes: 2 ** 28 });
  } catch (cause) {
    fail('archive.sources', `the sources object does not read: ${cause.message}`);
  }
  if (bytes[5] !== 2) fail('archive.sources', 'the sources object is not a holo v6 container');
  let index;
  try {
    index = JSON.parse(decoder.decode(objects[0]));
  } catch {
    fail('archive.sources', 'the sources index is not JSON');
  }
  if (canonicalJson(index) !== decoder.decode(objects[0]) || index?.schema !== SOURCES_SCHEMA || !Array.isArray(index.files) || Object.keys(index).length !== 2) {
    fail('archive.sources', `the sources index is not canonical ${SOURCES_SCHEMA}`);
  }
  if (index.files.length === 0) fail('archive.sources', 'the sources index lists no file');
  if (index.files.length !== objects.length - 1) fail('archive.sources', 'the sources index and the container hold different numbers of files');
  return index.files.map((file, i) => {
    if (!file || typeof file !== 'object' || Object.keys(file).sort().join() !== 'kappa,length,path') fail('archive.sources', `sources file ${i} is not { path, kappa, length }`);
    if (!isSourcePath(file.path)) fail('archive.sources', `sources file ${JSON.stringify(file.path)} is not a file that decides the model`);
    if (i > 0 && byBytes(index.files[i - 1].path, file.path) >= 0) fail('archive.sources', 'the sources paths are not unique and sorted by their bytes');
    const content = objects[i + 1];
    if (file.kappa !== labelOf(6, content) || file.length !== content.length) fail('archive.sources', `sources file ${file.path} is not the bytes the index names`);
    return { path: file.path, bytes: content };
  });
}

/**
 * A holo v6 sources object from the files that decide a model, `[{ path, bytes }]`: a nested v6 container whose object
 * 0 is the canonical `prism/model-sources/1` index and whose objects 1..n are the files in path order. A file outside
 * the stated set is left out, as a writer must (ADR-018); none left is refused, since an empty set is no sources object.
 */
export function sourcesArchive(files) {
  const kept = files.filter((file) => isSourcePath(file.path)).sort((a, b) => byBytes(a.path, b.path));
  if (kept.length === 0) fail('archive.sources', 'no file that decides the model: an empty set is not a sources object');
  for (let i = 1; i < kept.length; i++) if (kept[i - 1].path === kept[i].path) fail('archive.sources', `the path ${kept[i].path} is given twice`);
  const index = { files: kept.map((file) => ({ kappa: labelOf(6, file.bytes), length: file.bytes.length, path: file.path })), schema: SOURCES_SCHEMA };
  return writeObjects([encoder.encode(canonicalJson(index)), ...kept.map((file) => file.bytes)], 6);
}

/** The optional roles a v6 manifest's `objects` rows list, in OPTIONAL_ROLES_V6 order. */
function optionalRolesOf(manifest) {
  const listed = new Set(Array.isArray(manifest?.objects) ? manifest.objects.map((row) => row?.role) : []);
  return OPTIONAL_ROLES_V6.filter((role) => listed.has(role));
}
const PROVENANCE_SCHEMA = { 5: PROVENANCE_SCHEMA_V5, 6: PROVENANCE_SCHEMA_V6 };
export const ROLES_V5 = Object.freeze(['manifest', 'source-manifest', 'provenance', 'capabilities', 'guest', 'view', 'model']);
export const ROLE_ATTESTATIONS = 'attestations';
export const KIND = Object.freeze({ APP_MANIFEST: 15, METADATA: 8, EXTENSION: 14, CONTENT_BLOB: 16 });
export const LABEL_LENGTH = 71;
export const FOOTER_LENGTH = 32;
export const HEADER_LENGTH = 10;
export const TABLE_ENTRY_LENGTH = 24;

export const DIRECTORY_EXTENSION = 'https://hologram.foundation/extension/application-directory/v1';
export const MODEL_EXTENSION = 'https://uor.foundation/extension/prismpm-model/v1';
export const APP_MANIFEST_URI = 'https://hologram.foundation/realization/app-manifest';
/** `Foundation.Holo.V1.Wire`: `wireManifestPrefix` is 57 bytes, the manifest 356, `wireManifestSuffix` the 86 bytes below. */
export const MANIFEST_LENGTH = 356;
export const MANIFEST_PREFIX_LENGTH = 57;
export const MANIFEST_SUFFIX_HEX =
  '52000000' + '00000000020000000008000000' + '686f6c6f5f72756e' + '1a000000' + '686f6c6f6772616d3a67756573742f636f72652d7761736d4031' +
  '030a000000' + '696e6465782e68746d6c' + '08000000' + '706f727461626c65' + '00000000';

const decoder = new TextDecoder('utf-8', { fatal: true });

export function asBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  fail('archive.input', 'expected bytes (Uint8Array or ArrayBuffer)');
}

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('archive.bounds', `field at ${offset} exceeds 2^53`);
  return Number(value);
}

function isLabel(bytes) {
  if (bytes.length !== LABEL_LENGTH) return false;
  for (let i = 0; i < 7; i++) if (bytes[i] !== 'blake3:'.charCodeAt(i)) return false;
  for (let i = 7; i < LABEL_LENGTH; i++) {
    const c = bytes[i];
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

/**
 * Parse an archive. Structural errors throw; integrity results are returned in
 * `verification` so a caller can decide what an unverified archive is worth.
 */
export function parseArchive(source) {
  const bytes = asBytes(source);
  if (isUorc(bytes)) return parseArchiveV5(bytes);
  if (bytes.length < HEADER_LENGTH + FOOTER_LENGTH) fail('archive.bounds', 'archive shorter than header and footer');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) fail('archive.magic', `expected magic ${MAGIC}, found ${JSON.stringify(magic)}`);
  const version = view.getUint16(4, true);
  if (version !== VERSION) fail('archive.version', `expected physical version ${VERSION}, found ${version}`);
  const flags = view.getUint16(6, true);
  if (flags !== 0) fail('archive.flags', `expected flags 0, found ${flags}`);
  const count = view.getUint16(8, true);
  const tableEnd = HEADER_LENGTH + count * TABLE_ENTRY_LENGTH;
  const bodyEnd = bytes.length - FOOTER_LENGTH;
  if (tableEnd > bodyEnd) fail('archive.bounds', `section table of ${count} entries overruns the archive`);

  const sections = [];
  let cursor = tableEnd;
  for (let i = 0; i < count; i++) {
    const at = HEADER_LENGTH + i * TABLE_ENTRY_LENGTH;
    const kind = u64(view, at);
    const offset = u64(view, at + 8);
    const length = u64(view, at + 16);
    if (offset !== cursor) fail('archive.bounds', `section ${i} starts at ${offset}, expected ${cursor}`);
    if (offset + length > bodyEnd) fail('archive.bounds', `section ${i} overruns the archive body`);
    sections.push({ index: i, kind, offset, length, body: bytes.subarray(offset, offset + length) });
    cursor = offset + length;
  }
  if (cursor !== bodyEnd) fail('archive.bounds', `sections end at ${cursor}, body ends at ${bodyEnd}`);

  const body = bytes.subarray(0, bodyEnd);
  const footer = blake3HexOf(bytes.subarray(bodyEnd));
  const fingerprint = blake3Hex(body);
  const labelMismatches = [];
  // Text a section holds, or a refusal: never a raw decoding error. When the footer
  // does not match either, the bytes were altered, and that is the reason to name.
  const text = (slice, check, what) => {
    try {
      return decoder.decode(slice);
    } catch {
      if (footer !== fingerprint) {
        throw new DigestMismatchError(`integrity failure: the holo was altered: the footer is not the BLAKE3 of the body, and ${what} is not UTF-8`, { check: 'holo.integrity' });
      }
      return fail(check, `${what} is not UTF-8`);
    }
  };

  let manifest = null;
  let metadata = null;
  const extensions = [];
  const blobs = [];
  try {
  for (const section of sections) {
    const b = section.body;
    switch (section.kind) {
      case KIND.APP_MANIFEST: {
        // `Foundation.Holo.V1.Wire.validAppManifest`: exactly 356 bytes, the
        // 57-byte prefix (URI, NUL, u32 LE 3), three 71-byte labels (requires,
        // guest, view), then the fixed 86-byte layer suffix.
        if (b.length !== MANIFEST_LENGTH) fail('archive.manifest', `application manifest is ${b.length} bytes, expected ${MANIFEST_LENGTH}`);
        const nul = b.indexOf(0);
        if (nul !== MANIFEST_PREFIX_LENGTH - 5) fail('archive.manifest', 'application manifest URI has the wrong length');
        const uri = text(b.subarray(0, nul), 'archive.manifest', 'the application manifest URI');
        if (uri !== APP_MANIFEST_URI) fail('archive.manifest', `application manifest URI is ${uri}`);
        const labelCount = new DataView(b.buffer, b.byteOffset + nul + 1, 4).getUint32(0, true);
        if (labelCount !== 3) fail('archive.manifest', `application manifest declares ${labelCount} labels, expected 3`);
        const labels = [];
        for (let i = 0; i < 3; i++) {
          const label = b.subarray(MANIFEST_PREFIX_LENGTH + i * LABEL_LENGTH, MANIFEST_PREFIX_LENGTH + (i + 1) * LABEL_LENGTH);
          if (!isLabel(label)) fail('archive.manifest', `application manifest label ${i} is not a blake3 label`);
          labels.push(decoder.decode(label));
        }
        const suffix = b.subarray(MANIFEST_PREFIX_LENGTH + 3 * LABEL_LENGTH);
        if (blake3HexOf(suffix) !== MANIFEST_SUFFIX_HEX) fail('archive.manifest', 'application manifest layer suffix is not the Wire constant');
        if (manifest) fail('archive.manifest', 'more than one application manifest');
        manifest = { uri, labels, suffix, section: section.index };
        break;
      }
      case KIND.METADATA: {
        if (metadata) fail('archive.metadata', 'more than one metadata section');
        metadata = { text: text(b, 'archive.metadata', `metadata section ${section.index}`), section: section.index };
        break;
      }
      case KIND.EXTENSION: {
        if (b.length < 2) fail('archive.extension', 'extension shorter than its name length');
        const nameLength = b[0] | (b[1] << 8);
        if (2 + nameLength > b.length) fail('archive.extension', 'extension name overruns the section');
        const name = text(b.subarray(2, 2 + nameLength), 'archive.extension', `the name of extension section ${section.index}`);
        const payload = b.subarray(2 + nameLength);
        extensions.push({ name, payload, text: text(payload, 'archive.extension', `extension ${name}`), section: section.index });
        break;
      }
      case KIND.CONTENT_BLOB: {
        if (b.length < LABEL_LENGTH) fail('archive.blob', 'content blob shorter than its label');
        const labelBytes = b.subarray(0, LABEL_LENGTH);
        if (!isLabel(labelBytes)) fail('archive.blob', `content blob ${blobs.length} has no blake3 label`);
        const label = decoder.decode(labelBytes);
        const content = b.subarray(LABEL_LENGTH);
        const actual = v4Label(content);
        if (actual !== label) labelMismatches.push({ section: section.index, label, actual });
        blobs.push({ label, content, section: section.index });
      break;
      }
      default:
        fail('archive.kind', `unknown section kind ${section.kind} at section ${section.index}`);
    }
  }
  if (!manifest) fail('archive.manifest', 'no application manifest section');
  } catch (error) {
    // A section that does not parse in a holo whose footer does not match either was altered:
    // name the damage first, and keep what broke as the detail.
    if (footer !== fingerprint && error?.code !== DigestMismatchError.code && !(error instanceof DigestMismatchError)) {
      throw new DigestMismatchError(`integrity failure: the holo was altered: the footer is not the BLAKE3 of the body (${error.code ?? 'parse'}: ${error.message})`, { check: 'holo.integrity', cause: error });
    }
    throw error;
  }

  return {
    bytes,
    body,
    version,
    flags,
    sections,
    manifest,
    metadata,
    extensions,
    blobs,
    footer,
    fingerprint,
    verification: {
      footer: footer === fingerprint,
      labels: labelMismatches.length === 0,
      labelMismatches,
    },
  };
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Parse a holo v5 or v6. The result has the v4 reader's shape (sections, blobs,
 * extensions, manifest labels, verification) so every consumer reads all three:
 * each object is a section whose `kind` is its role, the provenance object is
 * the model extension and the attestation object the attestation extension.
 * A v6 holo is a v5 holo whose seal is BLAKE3 and whose every κ is `blake3:` (ADR-018).
 */
function parseArchiveV5(bytes) {
  const { format, objects, sealed, seal, preimage } = layout(bytes);
  const kappa = (object) => labelOf(format, object);
  // A v6 may carry the optional snapshot and sources after `model`; its manifest's rows say which (ADR-018).
  let optional = [];
  if (format === 6 && objects.length > 0) {
    try {
      optional = optionalRolesOf(JSON.parse(decoder.decode(objects[0].bytes)));
    } catch {
      optional = [];
    }
  }
  const base = ROLES_V5.length + optional.length;
  if (objects.length !== base && objects.length !== base + 1) {
    fail('archive.bounds', `a v${format} application holo holds ${base} objects, or ${base + 1} when signed; this one holds ${objects.length}`);
  }
  const roles = [...ROLES_V5, ...optional, ROLE_ATTESTATIONS];
  const sections = objects.map((object, index) => ({ index, kind: roles[index], offset: object.offset, length: object.length, body: object.bytes }));
  const text = (slice, what) => {
    try {
      return decoder.decode(slice);
    } catch {
      if (!sealed) throw new DigestMismatchError(`integrity failure: the holo was altered: its seal does not match, and ${what} is not UTF-8`, { check: 'holo.integrity' });
      return fail('archive.manifest', `${what} is not UTF-8`);
    }
  };
  const manifestText = text(objects[0].bytes, 'the manifest');
  let holoManifest;
  try {
    holoManifest = JSON.parse(manifestText);
  } catch (error) {
    if (!sealed) throw new DigestMismatchError('integrity failure: the holo was altered: its seal does not match', { check: 'holo.integrity', cause: error });
    fail('archive.manifest', `the manifest is not JSON: ${error.message}`);
  }
  if (holoManifest?.schema !== MANIFEST_SCHEMA[format]) fail('archive.manifest', `the manifest schema is ${JSON.stringify(holoManifest?.schema)}, expected ${MANIFEST_SCHEMA[format]}`);
  const layer = (kind) => (Array.isArray(holoManifest.layers) ? holoManifest.layers.find((l) => l.kind === kind) : undefined);
  const labels = [holoManifest.requires, layer('wasm')?.kappa, layer('view')?.kappa];
  // The capability set, guest, view and model, then the optional objects: each a blob a statement may name.
  const blobs = [3, 4, 5, 6, ...optional.map((_, i) => ROLES_V5.length + i)].map((index) => ({ label: kappa(objects[index].bytes), content: objects[index].bytes, section: index }));
  const extensions = [
    { name: MODEL_EXTENSION, payload: objects[2].bytes, text: text(objects[2].bytes, 'the provenance object'), section: 2 },
  ];
  if (objects.length > base) {
    const payload = objects[base].bytes;
    extensions.push({ name: 'https://uor.foundation/extension/attestation-bundle/v1', payload, text: text(payload, 'the attestation object'), section: base });
  }
  const metadataText = text(objects[1].bytes, 'the source manifest');
  const listed = Array.isArray(holoManifest.objects) ? holoManifest.objects : [];
  const expected = [1, 3, 4, 5, 6, ...optional.map((_, i) => ROLES_V5.length + i)].map((index) => ({ role: roles[index], kappa: kappa(objects[index].bytes), length: objects[index].length }));
  const labelMismatches = expected
    .filter((row, i) => listed[i]?.role !== row.role || listed[i]?.kappa !== row.kappa || listed[i]?.length !== row.length)
    .map((row) => ({ section: roles.indexOf(row.role), label: listed.find((l) => l.role === row.role)?.kappa ?? null, actual: row.kappa }));
  if (listed.length !== expected.length) labelMismatches.push({ section: null, label: null, actual: null });
  const fingerprint = hexOf(seal);
  return {
    format,
    bytes,
    body: preimage,
    version: format,
    flags: 0,
    sections,
    manifest: { uri: MANIFEST_SCHEMA[format], labels, section: 0 },
    holoManifest,
    metadata: { text: metadataText, section: 1 },
    extensions,
    blobs,
    footer: fingerprint,
    fingerprint: sealed ? fingerprint : null,
    kappa: kappa(bytes),
    optional,
    optionalProblem: optionalProblemOf(optional, objects, metadataText),
    verification: {
      footer: sealed,
      seal: sealed,
      labels: labelMismatches.length === 0,
      labelMismatches,
    },
  };
}

/** The problem with a v6's optional objects, or null: the snapshot is the source manifest's row, the sources object holds. */
function optionalProblemOf(optional, objects, metadataText) {
  const at = (role) => (optional.includes(role) ? objects[ROLES_V5.length + optional.indexOf(role)].bytes : null);
  const snapshot = at('snapshot');
  if (snapshot) {
    let row;
    try {
      row = JSON.parse(metadataText)?.files?.find((file) => file.kind === SNAPSHOT_SOURCE_KIND);
    } catch {
      row = undefined;
    }
    if (!row) return `the holo carries a snapshot, and its source manifest names no ${SNAPSHOT_SOURCE_KIND}`;
    if (row.sha256 !== sha256HexSync(snapshot)) return `the snapshot object's sha256 is not the source manifest's ${SNAPSHOT_SOURCE_KIND}`;
  }
  const sources = at('sources');
  if (sources) {
    try {
      readSources(sources);
    } catch (error) {
      return error.message;
    }
  }
  return null;
}

function blake3HexOf(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** JSON with sorted keys and no whitespace, the SDK's canonical encoding (`holo/canonical.rs`). */
/**
 * The identity of a holo: for a holo v6 its κ, the `blake3:` of the file (ADR-018); for a holo v5 its κ, the
 * `sha256:` of the file, which is also its OCI layer digest (ADR-017); for a legacy v4 holo the `blake3:` of its
 * body, which its footer claims.
 */
export const holoDigest = (parsed) => (parsed.format >= 5 ? parsed.kappa : `blake3:${parsed.fingerprint}`);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Resolve the parsed archive into the application's parts, cross-checking the
 * directory and model extensions against the manifest and the blobs.
 */
export function resolveArchive(parsed) {
  if (parsed.format >= 5) return resolveArchiveV5(parsed);
  const extension = (name) => parsed.extensions.find((e) => e.name === name);
  const directoryExtension = extension(DIRECTORY_EXTENSION);
  const modelExtension = extension(MODEL_EXTENSION);
  if (!directoryExtension) fail('archive.directory', `missing extension ${DIRECTORY_EXTENSION}`);
  if (!modelExtension) fail('archive.provenance', `missing extension ${MODEL_EXTENSION}`);
  const directory = JSON.parse(directoryExtension.text);
  const provenance = JSON.parse(modelExtension.text);
  const byLabel = new Map(parsed.blobs.map((b) => [b.label, b]));
  const blob = (label, what) => {
    const found = byLabel.get(label);
    if (!found) fail('archive.directory', `${what} ${label} is not a content blob of this archive`);
    return found;
  };

  const layers = Array.isArray(directory.layers) ? directory.layers : [];
  const wasmLayer = layers.find((l) => l.kind === 'wasm');
  const viewLayer = layers.find((l) => l.kind === 'view');
  if (!wasmLayer) fail('archive.directory', 'application directory has no wasm layer');
  if (!viewLayer) fail('archive.directory', 'application directory has no view layer');
  if (wasmLayer.entry !== 'holo_run') fail('archive.directory', `wasm layer entry is ${wasmLayer.entry}, expected holo_run`);
  if (typeof provenance.model_content_kappa !== 'string') fail('archive.provenance', 'model extension names no model_content_kappa');

  const guest = blob(wasmLayer.content_kappa, 'wasm layer');
  const view = blob(viewLayer.content_kappa, 'view layer');
  const model = blob(provenance.model_content_kappa, 'model document');
  const capabilities = blob(directory.requires_kappa, 'capability set');

  const consistent =
    provenance.guest_content_kappa === wasmLayer.content_kappa &&
    parsed.manifest.labels.includes(wasmLayer.content_kappa) &&
    parsed.manifest.labels.includes(viewLayer.content_kappa) &&
    parsed.manifest.labels.includes(directory.requires_kappa) &&
    parsed.manifest.uri === APP_MANIFEST_URI;

  let modelDocument;
  try {
    modelDocument = JSON.parse(decoder.decode(model.content));
  } catch (error) {
    fail('archive.model', `model document is not JSON: ${error.message}`);
  }

  return {
    directory,
    provenance,
    modelDocument,
    guest,
    view,
    model,
    capabilities,
    identities: {
      archiveFingerprint: parsed.fingerprint,
      footer: parsed.footer,
      guestKappa: guest.label,
      viewKappa: view.label,
      modelKappa: model.label,
      capabilitiesKappa: capabilities.label,
      applicationKappa: provenance.application_kappa ?? null,
      verified: parsed.verification.footer && parsed.verification.labels && consistent,
      consistent,
    },
  };
}

function resolveArchiveV5(parsed) {
  const manifest = parsed.holoManifest;
  const provenance = JSON.parse(parsed.extensions.find((e) => e.name === MODEL_EXTENSION).text);
  const [capabilities, guest, view, model] = parsed.blobs;
  const wasmLayer = manifest.layers?.find((l) => l.kind === 'wasm');
  const viewLayer = manifest.layers?.find((l) => l.kind === 'view');
  // A session-world guest (#629, HO-47) is entered at holo_step; every other guest at holo_run.
  // Spelled here rather than imported from session.mjs, so the archive reader stays inside the verify module's closure (proposal 440).
  const entry = ['hologram:guest/core-wasm@2', 'hologram:guest/core-wasm@3'].includes(wasmLayer?.contract) ? 'holo_step' : 'holo_run';
  if (!wasmLayer || wasmLayer.entry !== entry) fail('archive.directory', `the manifest has no wasm layer entered at ${entry}`);
  if (!viewLayer) fail('archive.directory', 'the manifest has no view layer');
  const applicationKappa = labelOf(parsed.format, parsed.sections[0].body);
  const consistent =
    canonicalJson(manifest) === decoder.decode(parsed.sections[0].body) &&
    manifest.requires === capabilities.label &&
    wasmLayer.kappa === guest.label &&
    viewLayer.kappa === view.label &&
    provenance.schema === PROVENANCE_SCHEMA[parsed.format] &&
    provenance.guest_content_kappa === guest.label &&
    provenance.model_content_kappa === model.label &&
    provenance.view_binding?.view_content_kappa === view.label &&
    provenance.application_kappa === applicationKappa &&
    canonicalJson(provenance) === parsed.extensions.find((e) => e.name === MODEL_EXTENSION).text &&
    !parsed.optionalProblem;
  let modelDocument;
  try {
    modelDocument = JSON.parse(decoder.decode(model.content));
  } catch (error) {
    fail('archive.model', `model document is not JSON: ${error.message}`);
  }
  return {
    directory: { schema_version: parsed.format, primary_layer: 0, requires_kappa: manifest.requires, layers: manifest.layers.map((l) => ({ ...l, content_kappa: l.kappa })) },
    manifest,
    provenance,
    modelDocument,
    guest,
    view,
    model,
    capabilities,
    identities: {
      archiveFingerprint: parsed.fingerprint,
      footer: parsed.footer,
      archiveKappa: parsed.kappa,
      basis: manifest.basis ?? null,
      guestKappa: guest.label,
      viewKappa: view.label,
      modelKappa: model.label,
      capabilitiesKappa: capabilities.label,
      applicationKappa,
      verified: parsed.verification.seal && parsed.verification.labels && consistent,
      consistent,
    },
  };
}

const encoder = new TextEncoder();
const SHA256_KAPPA = /^sha256:[0-9a-f]{64}$/;

/** `value` with every string `labels` maps replaced, and whether any `sha256:` κ is left unmapped. */
function relabel(value, labels) {
  let unmapped = null;
  const walk = (v) => {
    if (typeof v === 'string') {
      if (labels.has(v)) return labels.get(v);
      if (SHA256_KAPPA.test(v)) unmapped ??= v;
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), unmapped };
}

/**
 * The holo v6 of a verified, unsigned holo v5 (ADR-018): the same seven objects, in the same order, with every
 * object's bytes kept except the manifest's and the provenance's. Those two are v5's documents with every κ
 * relabelled `blake3:` over the same bytes, under schemas `prism/holo/6` and `prismpm/model-provenance/3`; the
 * provenance's `application_kappa` names the new manifest. The build's `*_sha256` fields and LexLean's ids are kept
 * as they are (ADR-018 §7), and so is a `basis`, the SDK image's OCI digest (ADR-018 §3). Any other κ that names bytes
 * outside the holo cannot be relabelled, so it is refused. A signed holo is refused: its statements name v5 subjects; sign the v6 holo again.
 *
 * @param {Uint8Array | ArrayBuffer | object} source the holo's bytes, or a parsed archive
 * @returns {Uint8Array} the holo v6, sealed with BLAKE3
 */
export function upgradeToV6(source) {
  const parsed = source && typeof source === 'object' && Array.isArray(source.sections) ? source : parseArchive(asBytes(source));
  if (parsed.format === 6) return parsed.bytes.slice();
  if (parsed.format !== 5) fail('archive.version', `only a holo v5 is upgraded to v6; this is a holo v${parsed.format}`);
  if (parsed.sections.length !== ROLES_V5.length) fail('attestation.format', 'a signed holo v5 is not upgraded: its statements name v5 subjects; strip them, upgrade, and sign the holo v6');
  const resolved = resolveArchive(parsed);
  if (!resolved.identities.verified) fail('archive.manifest', 'only a holo v5 that verifies is upgraded to v6');
  const objects = parsed.sections.map((section) => section.body);
  const labels = new Map([1, 3, 4, 5, 6].map((index) => [labelOf(5, objects[index]), labelOf(6, objects[index])]));
  // The basis names the SDK image by its OCI digest, not bytes of the holo (ADR-018 §3): it is kept as it is.
  const { basis, ...rest } = resolved.manifest;
  const manifest = relabel({ ...rest, schema: MANIFEST_SCHEMA_V6 }, labels);
  if (basis !== undefined) manifest.value.basis = basis;
  if (manifest.unmapped) fail('archive.manifest', `the manifest names ${manifest.unmapped}, which is not an object of this holo, so it has no blake3 label here`);
  const manifestBytes = encoder.encode(canonicalJson(manifest.value));
  labels.set(resolved.identities.applicationKappa, labelOf(6, manifestBytes));
  const provenance = relabel({ ...resolved.provenance, schema: PROVENANCE_SCHEMA_V6 }, labels);
  if (provenance.unmapped) fail('archive.manifest', `the provenance names ${provenance.unmapped}, which is not an object of this holo, so it has no blake3 label here`);
  objects[0] = manifestBytes;
  objects[2] = encoder.encode(canonicalJson(provenance.value));
  return writeObjects(objects, 6);
}

/**
 * A verified, unsigned holo v6 with its model's semantic snapshot and sources added (ADR-018): the snapshot and the
 * sources object after `model`, listed in the manifest's rows; the source manifest's lexlean-semantic-snapshot row
 * set to the snapshot's sha256; the provenance naming the new manifest. Either may be left out. Every other object
 * keeps its bytes. A holo that already carries either, or is signed, is refused: build it again.
 *
 * @param {Uint8Array | ArrayBuffer | object} source a holo v6
 * @param {{ snapshot?: Uint8Array, sources?: Array<{ path: string, bytes: Uint8Array }> }} added
 * @returns {Uint8Array}
 */
export function withModelFiles(source, { snapshot, sources } = {}) {
  const parsed = source && typeof source === 'object' && Array.isArray(source.sections) ? source : parseArchive(asBytes(source));
  if (parsed.format !== 6) fail('archive.version', 'only a holo v6 carries a snapshot or sources');
  if (parsed.sections.length !== ROLES_V5.length) fail('attestation.format', 'a signed holo, or one that already carries a snapshot or sources, is not changed: build it again');
  const resolved = resolveArchive(parsed);
  if (!resolved.identities.verified) fail('archive.manifest', 'only a holo v6 that verifies is given a snapshot or sources');
  const objects = parsed.sections.map((section) => section.body);
  const extra = [];
  const source_ = JSON.parse(decoder.decode(objects[1]));
  if (snapshot) {
    const row = { kind: SNAPSHOT_SOURCE_KIND, sha256: sha256HexSync(snapshot) };
    source_.files = [...(source_.files ?? []).filter((file) => file.kind !== SNAPSHOT_SOURCE_KIND), row];
    extra.push(['snapshot', snapshot]);
  }
  if (sources) extra.push(['sources', sourcesArchive(sources)]);
  if (extra.length === 0) return parsed.bytes.slice();
  objects[1] = encoder.encode(canonicalJson(source_));
  const row = (role, bytes) => ({ kappa: labelOf(6, bytes), length: bytes.length, role });
  const manifest = {
    ...resolved.manifest,
    objects: [row('source-manifest', objects[1]), ...[3, 4, 5, 6].map((i) => row(ROLES_V5[i], objects[i])), ...extra.map(([role, bytes]) => row(role, bytes))],
  };
  objects[0] = encoder.encode(canonicalJson(manifest));
  objects[2] = encoder.encode(canonicalJson({ ...resolved.provenance, application_kappa: labelOf(6, objects[0]) }));
  return writeObjects([...objects, ...extra.map(([, bytes]) => bytes)], 6);
}
