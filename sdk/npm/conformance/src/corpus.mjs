/**
 * The archives the scenarios name. A scenario says `"archive": "footer-flipped"`
 * and the harness writes that file and hands the shim its path, so a runtime in
 * any language reads the same bytes and needs no code from this package.
 *
 * Every archive derives from one committed file, the reference Calculator holo,
 * by a recipe below. `corpus/archives.lock.json` pins the sha256 of each result,
 * so a changed recipe is a visible change in review, and `corpus --out <dir>`
 * writes them all for a runtime author to read.
 *
 * Rows of the reference table: 0 manifest, 1 metadata, 2 directory, 3 model
 * extension, 4 guest, 5 view, 6 capability set, 7 model document. A content blob
 * starts with a 71-byte `blake3:<hex>` label, and the blobs are in label order;
 * an archive with another guest re-sorts them, so its guest may be another row.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake3 } from './vendor/blake3.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export const REFERENCE_PATH = here('../corpus/Calculator.holo');
export const REFERENCE_V5_PATH = here('../corpus/Calculator.v5.holo');
export const REFERENCE_V6_PATH = here('../corpus/Calculator.v6.holo');
export const LOCK_PATH = here('../corpus/archives.lock.json');

const KIND_EXTENSION = 14;
const KIND_BLOB = 16;
const LABEL = 71;
const GUEST = 4;
const VIEW = 5;
const CAPABILITY_SET = 6;
const MODEL = 7;
const ATTESTATION_EXTENSION = 'https://uor.foundation/extension/attestation-bundle/v1';

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function leb(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Uint8Array.from(out);
}

const reference = () => new Uint8Array(readFileSync(REFERENCE_PATH));

function table(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint16(8, true) }, (_, i) => {
    const at = 10 + i * 24;
    return { kind: Number(view.getBigUint64(at, true)), offset: Number(view.getBigUint64(at + 8, true)), length: Number(view.getBigUint64(at + 16, true)) };
  });
}

/** Rewrite the footer as a forger who can hash would, so only the named damage remains. */
function reseal(bytes) {
  const end = bytes.length - 32;
  bytes.set(blake3(bytes.subarray(0, end)), end);
  return bytes;
}

/** The reference archive with `edit(bytes, rows)` applied, footer not recomputed. */
function damaged(edit) {
  const bytes = reference();
  edit(bytes, table(bytes));
  return bytes;
}

const resealed = (edit) => reseal(damaged(edit));

/** An archive from whole section rows: header, table, contiguous bodies, BLAKE3 footer. */
function assemble(rows) {
  const head = new Uint8Array(10 + rows.length * 24);
  head.set(enc.encode('HOLO'));
  const view = new DataView(head.buffer);
  view.setUint16(4, 4, true);
  view.setUint16(8, rows.length, true);
  let offset = head.length;
  rows.forEach((row, i) => {
    view.setBigUint64(10 + i * 24, BigInt(row.kind), true);
    view.setBigUint64(18 + i * 24, BigInt(offset), true);
    view.setBigUint64(26 + i * 24, BigInt(row.body.length), true);
    offset += row.body.length;
  });
  return reseal(concat([head, ...rows.map((row) => row.body), new Uint8Array(32)]));
}

const rowsOf = (bytes) => table(bytes).map((row) => ({ kind: row.kind, body: bytes.slice(row.offset, row.offset + row.length) }));

function extensionBody(name, payload) {
  const nameBytes = enc.encode(name);
  return concat([Uint8Array.of(nameBytes.length & 0xff, nameBytes.length >> 8), nameBytes, payload]);
}

/** One line of an attestation section: an unsigned bundle whose statement claims P3. */
function unsignedClaimLine() {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'guest', digest: { sha256: '0'.repeat(64), blake3: '0'.repeat(64) } }],
    predicateType: 'https://uor.foundation/prism/proof/v1',
    predicate: { verifiedLevels: ['P3'] },
  };
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ keyid: '', sig: 'AA==' }],
    },
  };
  return enc.encode(`${JSON.stringify(bundle)}\n`);
}

const attestationRow = () => ({ kind: KIND_EXTENSION, body: extensionBody(ATTESTATION_EXTENSION, unsignedClaimLine()) });

function wasmSections(wasm) {
  const sections = [];
  let at = 8;
  const readLeb = () => {
    let result = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = wasm[at++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
    }
  };
  while (at < wasm.length) {
    const id = wasm[at++];
    const size = readLeb();
    sections.push({ id, start: at, payload: wasm.slice(at, at + size) });
    at += size;
  }
  return sections;
}

const assembleWasm = (sections) => concat([Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0), ...sections.flatMap((s) => [Uint8Array.of(s.id), leb(s.payload.length), s.payload])]);

function referenceGuest() {
  const bytes = reference();
  const row = table(bytes)[GUEST];
  return bytes.slice(row.offset + LABEL, row.offset + row.length);
}

/**
 * The archive with another guest module, every fingerprint recomputed: the label
 * in the manifest, the directory and the provenance, the directory's byte length,
 * the application kappa, the table and the footer. Only the guest is wrong.
 * With `contract`, the directory and the provenance also name that guest
 * contract. The manifest suffix is a constant of the format and the model
 * document has its own schema, so both keep naming @1.
 */
function withGuest(wasm, contract = null) {
  const bytes = reference();
  const rows = rowsOf(bytes);
  const oldLabel = dec.decode(rows[GUEST].body.subarray(0, LABEL));
  const newLabel = `blake3:${hex(blake3(wasm))}`;
  const named = (text) => (contract === null ? text : text.replaceAll(CORE_WASM_1, contract));
  rows[GUEST].body = concat([enc.encode(newLabel), wasm]);
  rows[0].body = enc.encode(dec.decode(rows[0].body).replace(oldLabel, newLabel));
  const editJson = (body, edit) => {
    const nameLength = body[0] | (body[1] << 8);
    const json = JSON.parse(named(dec.decode(body.subarray(2 + nameLength))));
    edit(json);
    return concat([body.subarray(0, 2 + nameLength), enc.encode(JSON.stringify(json))]);
  };
  rows[2].body = editJson(rows[2].body, (directory) => {
    for (const layer of directory.layers) if (layer.content_kappa === oldLabel) layer.content_kappa = newLabel;
    for (const blob of directory.blobs) {
      if (blob.kappa === oldLabel) {
        blob.kappa = newLabel;
        blob.byte_length = wasm.length;
      }
    }
  });
  rows[3].body = editJson(rows[3].body, (provenance) => {
    provenance.guest_content_kappa = newLabel;
    provenance.application_kappa = `blake3:${hex(blake3(rows[0].body))}`;
  });
  return assemble(canonicalBlobOrder(rows));
}

/**
 * The content blobs in the order Holo/1 requires: by label, ascending. A new
 * guest has a new label, which may sort before or after the other blobs; the
 * Wire codec (`wireCanonicalRowsValid`) refuses any other order as a table it
 * cannot read, so without this a world check would test the table instead.
 */
function canonicalBlobOrder(rows) {
  const first = rows.findIndex((row) => row.kind === KIND_BLOB);
  const blobs = rows.slice(first).sort((a, b) => Buffer.compare(Buffer.from(a.body.subarray(0, LABEL)), Buffer.from(b.body.subarray(0, LABEL))));
  return [...rows.slice(0, first), ...blobs];
}

function mutateGuest(edit) {
  const sections = wasmSections(referenceGuest());
  edit(sections, (id) => sections.findIndex((s) => s.id === id));
  return withGuest(assembleWasm(sections));
}

const name = (text) => concat([leb(enc.encode(text).length), enc.encode(text)]);

const CORE_WASM_1 = 'hologram:guest/core-wasm@1';
/** A guest of the session world (#629): the session ABI probe of prism-code, the generated shim around a test entry. */
const SESSION_PROBE = here('../corpus/session-probe.wasm');
/** A guest of the checkpoint world (HO-47): the checkpoint ABI probe of prism-code, the generated @3 shim around the same entry. */
const CHECKPOINT_PROBE = here('../corpus/checkpoint-probe.wasm');

// ---- holo v5 variants (ADR-017, HO-49) ----
// A UORC archive is its header (magic, two zero bytes, ULEB128 object count,
// each object's length and their total), the objects, and the
// UORC-SHA256-CHAIN-v1 seal of everything before it.
const UORC_MAGIC = Uint8Array.of(0x55, 0x4f, 0x52, 0x43, 0x02, 0x01);
const UORC_TAG = enc.encode('UORC-SHA256-CHAIN-v1\0');
const sha256Bytes = (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest());
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const kappaV5 = (bytes) => `sha256:${sha256Hex(bytes)}`;
const ulebV5 = (n) => {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return Uint8Array.from(out);
};
function chainV5(preimage) {
  let c = sha256Bytes(concat([UORC_TAG, Uint8Array.of(0)]));
  const whole = preimage.length - (preimage.length % 64);
  for (let at = 0; at < whole; at += 64) c = sha256Bytes(concat([UORC_TAG, Uint8Array.of(1), c, preimage.subarray(at, at + 64)]));
  const tail = preimage.subarray(whole);
  return sha256Bytes(concat([UORC_TAG, Uint8Array.of(2), c, Uint8Array.of(tail.length), tail]));
}
function writeV5(objects) {
  const header = [UORC_MAGIC, Uint8Array.of(0, 0), ulebV5(objects.length), ...objects.map((o) => ulebV5(o.length)), ulebV5(objects.reduce((n, o) => n + o.length, 0))];
  const preimage = concat([...header, ...objects]);
  return concat([preimage, chainV5(preimage)]);
}
function readV5(bytes) {
  let at = UORC_MAGIC.length + 2;
  const uleb = () => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      scale *= 0x80;
      if (byte < 0x80) return value;
    }
  };
  const count = uleb();
  const lengths = Array.from({ length: count }, uleb);
  uleb();
  return lengths.map((length) => {
    const object = bytes.slice(at, at + length);
    at += length;
    return object;
  });
}
// A holo v6 is the same framing with profile 2, sealed by plain BLAKE3, its κ-labels `blake3:` (ADR-018).
const UORC_MAGIC_V6 = Uint8Array.of(0x55, 0x4f, 0x52, 0x43, 0x02, 0x02);
const kappaV6 = (bytes) => `blake3:${hex(blake3(bytes))}`;
function writeV6(objects) {
  const header = [UORC_MAGIC_V6, Uint8Array.of(0, 0), ulebV5(objects.length), ...objects.map((o) => ulebV5(o.length)), ulebV5(objects.reduce((n, o) => n + o.length, 0))];
  const preimage = concat([...header, ...objects]);
  return concat([preimage, blake3(preimage)]);
}
const canonicalV5 = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonicalV5).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalV5(value[k])}`).join(',')}}`
      : JSON.stringify(value);

/**
 * The reference holo v6 carrying its model's semantic snapshot and sources after `model` (ADR-018), as a v6 build
 * writes them: the snapshot named by the source manifest's lexlean-semantic-snapshot row, the sources a nested v6
 * container with a prism/model-sources/1 index, both listed in the manifest's rows, the provenance naming the new
 * manifest. `wrongSnapshot` puts other bytes in the snapshot object than its row names; `outsideSources` lists a file
 * that does not decide the model. Every κ, length and seal is recomputed, so each is otherwise well formed.
 */
function v6Carried({ wrongSnapshot = false, outsideSources = false } = {}) {
  const objects = readV5(new Uint8Array(readFileSync(REFERENCE_V6_PATH)));
  const json = (i) => JSON.parse(new TextDecoder().decode(objects[i]));
  const bytesOf = (value) => enc.encode(canonicalV5(value));
  const snapshotOf = (id) => bytesOf({ schema: 'lexlean/semantic-snapshot/2', semantic_id: id });
  const snapshot = snapshotOf('75956b94d3183b6a527cc8684de8410e0ad931f584a81b090223733e3e6791e4');
  const files = outsideSources
    ? [{ path: 'session.json', bytes: enc.encode('{}') }]
    : [
        { path: 'lexlean.toml', bytes: enc.encode('[package]\nname = "calculator"\n') },
        { path: 'prism.toml', bytes: enc.encode('name = "calculator"\n') },
        { path: 'src/Calculator.lex.tex', bytes: enc.encode('\\module{Calculator}\n') },
      ];
  const index = { files: files.map((f) => ({ kappa: kappaV6(f.bytes), length: f.bytes.length, path: f.path })), schema: 'prism/model-sources/1' };
  const sources = writeV6([bytesOf(index), ...files.map((f) => f.bytes)]);
  const source = json(1);
  source.files = [...source.files, { kind: 'lexlean-semantic-snapshot', sha256: sha256Hex(snapshot) }];
  objects[1] = bytesOf(source);
  const carried = [...objects, wrongSnapshot ? snapshotOf('0'.repeat(64)) : snapshot, sources];
  const roles = ['manifest', 'source-manifest', 'provenance', 'capabilities', 'guest', 'view', 'model', 'snapshot', 'sources'];
  const manifest = json(0);
  manifest.objects = [1, 3, 4, 5, 6, 7, 8].map((i) => ({ kappa: kappaV6(carried[i]), length: carried[i].length, role: roles[i] }));
  carried[0] = bytesOf(manifest);
  carried[2] = bytesOf({ ...json(2), application_kappa: kappaV6(carried[0]) });
  return writeV6(carried);
}

/**
 * The reference holo v5 with `guest` under `contract` and `modelDocument` in
 * place of its own, every κ, length, digest and seal recomputed, so only the
 * guest, its contract and the document differ. The wasm layer is entered
 * where the contract's world says: holo_step for the session worlds.
 */
function v5With({ guest, contract, modelDocument, entry = null }) {
  const objects = readV5(new Uint8Array(readFileSync(REFERENCE_V5_PATH)));
  const json = (i) => JSON.parse(new TextDecoder().decode(objects[i]));
  const bytesOf = (value) => enc.encode(canonicalV5(value));
  const model = bytesOf(modelDocument);
  objects[4] = guest;
  objects[6] = model;
  const source = json(1);
  source.files = source.files.map((file) => (file.kind === 'model-document' ? { ...file, sha256: sha256Hex(model) } : file));
  objects[1] = bytesOf(source);
  const manifest = json(0);
  const session = contract === 'hologram:guest/core-wasm@2' || contract === 'hologram:guest/core-wasm@3';
  manifest.layers[0] = { ...manifest.layers[0], contract, entry: entry ?? (session ? 'holo_step' : 'holo_run'), kappa: kappaV5(guest) };
  const roles = { 'source-manifest': 1, capabilities: 3, guest: 4, view: 5, model: 6 };
  manifest.objects = manifest.objects.map((row) => ({ ...row, kappa: kappaV5(objects[roles[row.role]]), length: objects[roles[row.role]].length }));
  objects[0] = bytesOf(manifest);
  const provenance = json(2);
  Object.assign(provenance, {
    application_kappa: kappaV5(objects[0]),
    core_wasm_contract: contract,
    guest_content_kappa: kappaV5(guest),
    model_content_kappa: kappaV5(model),
    model_id: sha256Hex(model),
  });
  objects[2] = bytesOf(provenance);
  return writeV5(objects);
}

/** The checkpoint-world counter document of @prism-code/spec, the binary application profile (#630). */
const COUNTER_CHECKPOINT = here('../../spec/test/fixtures/documents/model-document-v9/counter-checkpoint.json');
/** That document with the bounds the checkpoint probe is generated with: request 64, state 256, response 256, four responses. */
function probeDocument() {
  const document = JSON.parse(readFileSync(COUNTER_CHECKPOINT, 'utf8'));
  Object.assign(document.application, { request_maximum: 64, response_maximum: 256, session: { state_maximum: 256, response_count_maximum: 4 } });
  return document;
}

/**
 * Every archive by name. A name is part of the suite's contract: scenarios refer
 * to it, so rename one only together with the scenarios that use it.
 */
export const ARCHIVES = Object.freeze({
  reference,
  // The reference application as a holo v5, a UORC archive named by κ (ADR-017). Committed, not derived:
  // its bytes come from compose_application, and a v4 recipe cannot write them.
  'reference-v5': () => new Uint8Array(readFileSync(REFERENCE_V5_PATH)),
  // The same application as a holo v6, sealed and named by BLAKE3 (ADR-018). Committed, not derived: prism-code's
  // upgradeToV6 wrote it from reference-v5, keeping every content object and relabelling every κ blake3:.
  'reference-v6': () => new Uint8Array(readFileSync(REFERENCE_V6_PATH)),
  // Carrying the model's snapshot and sources after `model` (ADR-018); then with a snapshot its row does not name,
  // and with sources naming a file that does not decide the model.
  'reference-v6-carried': () => v6Carried(),
  'reference-v6-wrong-snapshot': () => v6Carried({ wrongSnapshot: true }),
  'reference-v6-outside-sources': () => v6Carried({ outsideSources: true }),
  // One byte of its model object flipped: the BLAKE3 seal no longer matches.
  'reference-v6-seal-broken': () => {
    const bytes = new Uint8Array(readFileSync(REFERENCE_V6_PATH));
    bytes[bytes.length - 64] ^= 1;
    return bytes;
  },

  // Not a holo at all, or a structure no reader may accept.
  empty: () => new Uint8Array(0),
  'too-short': () => new Uint8Array(10),
  'bad-magic': () => damaged((b) => (b[0] ^= 1)),
  'bad-version': () => damaged((b) => (b[4] = 3)),
  'bad-flags': () => damaged((b) => (b[6] = 1)),
  'truncated-table': () => reference().slice(0, 100),
  'section-overrun': () => resealed((b) => new DataView(b.buffer).setBigUint64(26, 999999n, true)),
  'unknown-kind': () => resealed((b) => (b[10] = 99)),
  'manifest-uri': () => resealed((b, rows) => (b[rows[0].offset + 2] ^= 1)),

  // Readable, with one fingerprint that no longer agrees.
  'footer-flipped': () => damaged((b) => (b[b.length - 1] ^= 1)),
  'guest-undecodable': () => resealed((b, rows) => (b[rows[GUEST].offset + LABEL + 10] ^= 0xff)),
  // The last byte of the data section: the guest still compiles and only its label is wrong.
  'guest-data-flipped': () =>
    resealed((b, rows) => {
      const guest = b.subarray(rows[GUEST].offset + LABEL, rows[GUEST].offset + rows[GUEST].length);
      const data = wasmSections(guest).find((s) => s.id === 11);
      if (!data) throw new Error('the reference guest has no data section');
      guest[data.start + data.payload.length - 1] ^= 0x01;
    }),
  'label-flipped': () => resealed((b, rows) => (b[rows[CAPABILITY_SET].offset + 10] = b[rows[CAPABILITY_SET].offset + 10] === 97 ? 98 : 97)),
  'view-flipped': () => resealed((b, rows) => (b[rows[VIEW].offset + LABEL + 10] ^= 0xff)),
  'model-flipped': () => resealed((b, rows) => (b[rows[MODEL].offset + LABEL + 10] ^= 0x01)),

  // A guest whose interface differs from the world it names, with every fingerprint correct.
  'guest-extra-import': () =>
    mutateGuest((sections, at) => {
      const payload = concat([Uint8Array.of(1), name('env'), name('g'), Uint8Array.of(3, 0x7f, 0)]);
      sections.splice(at(1) + 1, 0, { id: 2, payload });
    }),
  'guest-extra-export': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      section.payload = concat([Uint8Array.of(section.payload[0] + 1), section.payload.subarray(1), name('extra'), Uint8Array.of(0, 0)]);
    }),
  'guest-renamed-export': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      section.payload = enc.encode(dec.decode(section.payload).replace('holo_run', 'holo_rux'));
    }),
  'guest-changed-signature': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(1)];
      const p = Uint8Array.from(section.payload);
      const i = p.findIndex((_, k) => p[k] === 0x60 && p[k + 1] === 1 && p[k + 2] === 0x7f && p[k + 3] === 1 && p[k + 4] === 0x7f);
      if (i < 0) throw new Error('no (i32) -> i32 type');
      p[i + 2] = 0x7e;
      section.payload = p;
    }),
  'guest-changed-kind': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      const p = Uint8Array.from(section.payload);
      const marker = enc.encode('memory');
      const i = p.findIndex((_, k) => marker.every((b, j) => p[k + j] === b));
      p[i + 6] = 3;
      section.payload = p;
    }),
  // A table import shifts no function or global index, so the guest compiles and the import is all a runtime can refuse.
  'guest-table-import': () =>
    mutateGuest((sections, at) => {
      const payload = concat([Uint8Array.of(1), name('env'), name('host'), Uint8Array.of(1, 0x70, 0, 0)]);
      sections.splice(at(1) + 1, 0, { id: 2, payload });
    }),

  // A guest of the session world hologram:guest/core-wasm@2 (#629), named as such by the directory and the
  // provenance. The manifest suffix and the model document keep @1 until a format revision admits the session world (#630).
  'session-world': () => withGuest(new Uint8Array(readFileSync(SESSION_PROBE)), 'hologram:guest/core-wasm@2'),

  // A guest of the checkpoint world hologram:guest/core-wasm@3 (HO-47), named as such like the session world above.
  'checkpoint-world': () => withGuest(new Uint8Array(readFileSync(CHECKPOINT_PROBE)), 'hologram:guest/core-wasm@3'),

  // A holo v5 of revision 2026-11-18 (HO-49): the checkpoint probe as its guest, entered at holo_step, and the
  // binary application document of a checkpoint-world counter. Wrong: the same holo entered at holo_run.
  'checkpoint-world-v5': () =>
    v5With({ guest: new Uint8Array(readFileSync(CHECKPOINT_PROBE)), contract: 'hologram:guest/core-wasm@3', modelDocument: probeDocument() }),
  'checkpoint-world-v5-entered-at-run': () =>
    v5With({ guest: new Uint8Array(readFileSync(CHECKPOINT_PROBE)), contract: 'hologram:guest/core-wasm@3', modelDocument: probeDocument(), entry: 'holo_run' }),

  // The attestation section.
  'unsigned-p3-claim': () => assemble([...rowsOf(reference()), attestationRow()]),
  'attestation-not-last': () => {
    const rows = rowsOf(reference());
    rows.splice(rows.length - 1, 0, attestationRow());
    return assemble(rows);
  },
  'attestation-duplicate': () => assemble([...rowsOf(reference()), attestationRow(), attestationRow()]),
});

export const archiveNames = () => Object.keys(ARCHIVES).sort();

/** The bytes of one named archive, checked against the lock when one is given. */
export function archiveBytes(archive, lock = null) {
  const recipe = ARCHIVES[archive];
  if (!recipe) throw new Error(`no archive named ${archive}`);
  const bytes = recipe();
  if (lock) {
    const digest = sha256(bytes);
    if (lock[archive] !== digest) throw new Error(`archive ${archive} is sha256 ${digest}; corpus/archives.lock.json pins ${lock[archive] ?? 'nothing'}`);
  }
  return bytes;
}

export const readLock = () => JSON.parse(readFileSync(LOCK_PATH, 'utf8'));

/** The lock for the recipes as they are now. */
export function computeLock() {
  return Object.fromEntries(archiveNames().map((archive) => [archive, sha256(archiveBytes(archive))]));
}

export function writeLock() {
  writeFileSync(LOCK_PATH, `${JSON.stringify(computeLock(), null, 2)}\n`);
}

/** Write every locked archive into `dir` as `<name>.holo`; returns name to absolute path. */
export function writeCorpus(dir, names = archiveNames()) {
  mkdirSync(dir, { recursive: true });
  const lock = readLock();
  const paths = {};
  for (const archive of names) {
    const path = join(dir, `${archive}.holo`);
    writeFileSync(path, archiveBytes(archive, lock));
    paths[archive] = path;
  }
  return paths;
}

/** The model document of the reference archive, read here so a test can hold the scenario's vectors to it. */
export function referenceModel() {
  const bytes = reference();
  const row = table(bytes)[MODEL];
  return JSON.parse(dec.decode(bytes.subarray(row.offset + LABEL, row.offset + row.length)));
}
