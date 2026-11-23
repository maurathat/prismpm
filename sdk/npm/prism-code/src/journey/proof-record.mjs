/**
 * A holo's proof record, written and checked again (ADR-018; the `reproved` and `sources` claims of
 * `ASSURANCE.CLAIMS`).
 *
 * A holo v6 that a build writes carries the model's semantic snapshot, the sources LexLean read, and one unsigned
 * in-toto statement whose predicate is `https://uor.foundation/prism/kernel-proof/v1`: Lean's kernel's verdict on
 * every theorem the snapshot states. The statement is a record, never evidence. `reprove` gives the evidence: it
 * runs Lean's kernel again, on the snapshot the holo carries, and says whether a proof of every theorem was just
 * accepted. `relex` runs LexLean again on the sources the holo carries and says whether they give that snapshot.
 *
 * Both are the functions `verify` and `check` take as their `reprove` and `relex` options, once the caller has
 * bound the kernel and LexLean: `reprove: (holo) => reprove(holo, { kernel })`. Neither throws for a holo it
 * cannot judge; it answers that the claim did not pass, and why.
 *
 * Nothing here is Node's: a page loads this module, opens the kernel with `openKernelFrom` (prove-core.mjs) and
 * LexLean with `admitModule` (toolchain.mjs), and re-proves a holo it was handed. reprove-here.mjs binds the
 * copies on this machine.
 */
import { asBytes, canonicalJson, parseArchive, readSources, resolveArchive } from '../archive.mjs';
import { BUNDLE_MEDIA_TYPE, DSSE_PAYLOAD_TYPE, STATEMENT_TYPE, appendAttestations, readAttestations } from '../attestations.mjs';
import { fail } from '../errors.mjs';
import { blake3Hex } from '../blake3.mjs';
import { sha256HexSync } from '../sha256.mjs';
import { ASSURANCE } from '../vendor/spec/assurance-levels.mjs';
import { lexleanSnapshot } from './lexlean-core.mjs';
import { kernelRecord } from './prove-core.mjs';

/** The predicate type of the statement a build writes and `reprove` reads. */
export const KERNEL_PROOF_PREDICATE_TYPE = ASSURANCE.CLAIM_PREDICATES.reproved;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const LABEL = /^blake3:[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{64}$/;
const STATUSES = ['proved', 'refused', 'unsupported'];

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const parsedOf = (source) => (source && typeof source === 'object' && Array.isArray(source.sections) ? source : parseArchive(asBytes(source)));
/** The bytes of the object in `role`, or null. */
const objectOf = (parsed, role) => parsed.sections.find((section) => section.kind === role)?.body ?? null;
const digestOf = (bytes) => ({ blake3: blake3Hex(bytes), sha256: sha256HexSync(bytes) });
const sameDigest = (a, b) => a?.blake3 === b.blake3 && a?.sha256 === b.sha256;
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** The objects a kernel-proof statement names, in order: the model document, the snapshot, and the sources when carried. */
function subjectsOf(parsed) {
  return ['model', 'snapshot', 'sources'].flatMap((role) => {
    const bytes = objectOf(parsed, role);
    return bytes ? [{ name: role, digest: digestOf(bytes) }] : [];
  });
}

/**
 * The kernel-proof statement of a holo v6 for `record`, what `kernelRecord` (prove-core.mjs) resolves: an in-toto
 * Statement v1 whose subjects are the model document, the snapshot and, when carried, the sources, each by blake3
 * and sha256. It holds no clock, so the same judgment of the same holo writes the same bytes.
 */
export function proofStatement(source, record) {
  const parsed = parsedOf(source);
  if (parsed.format !== 6) fail('attestation.format', 'only a holo v6 carries a kernel-proof statement');
  if (!objectOf(parsed, 'snapshot')) fail('attestation.input', 'a kernel-proof statement names the snapshot its theorems were judged from, and this holo carries none');
  if (!ID.test(record?.semantic_id ?? '') || ![record.kernel, record.library, record.lowering].every((label) => LABEL.test(label ?? ''))) {
    fail('attestation.input', 'a kernel-proof record names the snapshot by its semantic_id, and the kernel, its library and the lowering by their blake3 labels');
  }
  if (!Array.isArray(record.theorems) || record.theorems.some((t) => typeof t?.name !== 'string' || !STATUSES.includes(t.status) || !Array.isArray(t.axioms))) {
    fail('attestation.input', `a kernel-proof record lists theorems as { name, status, axioms }, status one of ${STATUSES.join(', ')}`);
  }
  const theorems = record.theorems
    .map((t) => ({ axioms: [...new Set(t.axioms)].sort(), name: t.name, status: t.status }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    _type: STATEMENT_TYPE,
    subject: subjectsOf(parsed),
    predicateType: KERNEL_PROOF_PREDICATE_TYPE,
    predicate: { kernel: record.kernel, library: record.library, lowering: record.lowering, semantic_id: record.semantic_id, theorems },
  };
}

/**
 * The holo with its kernel-proof statement, unsigned, in its attestations object: one bundle line whose envelope's
 * payload is the statement's canonical JSON and whose signature is empty. The input is not modified.
 */
export function withProofRecord(source, record) {
  const parsed = parsedOf(source);
  const statement = proofStatement(parsed, record);
  const line = canonicalJson({
    dsseEnvelope: { payload: base64(enc.encode(canonicalJson(statement))), payloadType: DSSE_PAYLOAD_TYPE, signatures: [{ sig: '' }] },
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: { publicKey: {} },
  });
  return appendAttestations(parsed, [line]);
}

/**
 * What of a proof record a holo carries: `{ statement, snapshot, sources }`, each a boolean. A holo that does not
 * read carries none. A caller tells a holo with no record, which says nothing, from one whose record fails.
 */
export function proofRecordOf(source) {
  try {
    const parsed = parsedOf(source);
    let statement = false;
    try {
      statement = readAttestations(parsed).some((a) => a.predicateType === KERNEL_PROOF_PREDICATE_TYPE);
    } catch {
      // An attestations object that does not read is one that is there: the re-proof says why it fails.
      statement = true;
    }
    return { statement, snapshot: objectOf(parsed, 'snapshot') !== null, sources: objectOf(parsed, 'sources') !== null };
  } catch {
    return { statement: false, snapshot: false, sources: false };
  }
}

/** The holo read for a claim: `{ parsed, resolved }`, or `{ problem }` for one that does not read or does not verify. */
function opened(holoBytes) {
  let parsed;
  let resolved;
  try {
    parsed = parseArchive(asBytes(holoBytes));
    if (parsed.format !== 6) return { problem: `The holo is a holo v${parsed.format}; only a holo v6 carries its snapshot and sources.` };
    resolved = resolveArchive(parsed);
  } catch (error) {
    return { problem: `The holo does not read: ${error?.message ?? error}.` };
  }
  if (!resolved.identities.verified) {
    return { problem: parsed.optionalProblem ? `The holo does not verify: ${parsed.optionalProblem}.` : 'The holo does not verify: its seal, or the labels its manifest and provenance give its objects, do not match its bytes.' };
  }
  return { parsed, resolved };
}

/**
 * Run Lean's kernel again on the snapshot a holo carries: the `reprove` function of `verify` and `check`.
 * `kernel` is an open kernel, as `openKernel` and `openKernelFrom` resolve one (prove-core.mjs), or a function
 * that resolves one, which is called only for a holo that carries something to judge; the caller binds it.
 *
 * Resolves `{ passed, theorems: [{ name, status, axioms }], semantic_id, kernel, library, reason }`. `passed` is
 * true only when all of these hold: the holo verifies; it carries one kernel-proof statement and a snapshot; the
 * statement names that snapshot and the holo's model document by their digests; the model document is the
 * snapshot's (its semantic_id, and its snapshot_id when it names one); the statement lists every theorem the
 * snapshot states and no other; and the kernel just accepted a proof of each, within its declared axioms. Nothing
 * kept from an earlier proof is used. `theorems` is what the kernel answered now, never what the statement says.
 * `reason` is null when it passed, and otherwise the first thing that failed. It does not throw for a holo it
 * cannot judge.
 */
export async function reprove(holoBytes, { kernel } = {}) {
  const refused = (reason, more = {}) => ({ passed: false, theorems: [], semantic_id: null, kernel: null, library: null, reason, ...more });
  if (!kernel || (typeof kernel !== 'function' && typeof kernel.check !== 'function')) return refused("No kernel was given: reprove(holo, { kernel }) takes Lean's kernel, opened.");
  const holo = opened(holoBytes);
  if (holo.problem) return refused(holo.problem);
  const { parsed, resolved } = holo;

  const snapshotBytes = objectOf(parsed, 'snapshot');
  if (!snapshotBytes) return refused('The holo carries no semantic snapshot, so there is nothing to prove again.');
  let statements;
  try {
    statements = readAttestations(parsed).filter((a) => a.predicateType === KERNEL_PROOF_PREDICATE_TYPE);
  } catch (error) {
    return refused(`The holo's statements do not read: ${error?.message ?? error}.`);
  }
  if (statements.length === 0) return refused('The holo carries no kernel-proof statement.');
  if (statements.length > 1) return refused(`The holo carries ${statements.length} kernel-proof statements; a build writes one.`);
  const [{ statement, subjects }] = statements;
  for (const role of ['model', 'snapshot', 'sources']) {
    const bytes = objectOf(parsed, role);
    if (bytes && !subjects.some((subject) => sameDigest(subject.digest, digestOf(bytes)))) return refused(`The kernel-proof statement does not name this holo's ${role === 'model' ? 'model document' : role}: it is the record of another.`);
  }
  const predicate = statement.predicate;
  if (!predicate || typeof predicate !== 'object' || !Array.isArray(predicate.theorems) || predicate.theorems.some((t) => typeof t?.name !== 'string' || !STATUSES.includes(t.status))) {
    return refused('The kernel-proof statement does not have the shape of its predicate.');
  }

  let snapshot;
  try {
    snapshot = JSON.parse(dec.decode(snapshotBytes));
  } catch {
    return refused('The snapshot the holo carries is not JSON.');
  }
  const semanticId = typeof snapshot?.semantic_id === 'string' && ID.test(snapshot.semantic_id) ? snapshot.semantic_id : null;
  if (!semanticId) return refused('The snapshot the holo carries names no semantic_id.');
  const more = { semantic_id: semanticId };
  if (predicate.semantic_id !== semanticId) return refused(`The kernel-proof statement is of the model ${predicate.semantic_id}, and the snapshot is of ${semanticId}.`, more);
  const built = resolved.modelDocument?.provenance ?? {};
  if (built.semantic_id !== semanticId) return refused(`The model document is of the model ${built.semantic_id}, and the snapshot is of ${semanticId}.`, more);
  if (built.snapshot_id !== undefined && built.snapshot_id !== sha256HexSync(snapshotBytes)) return refused('The model document names another snapshot than the one the holo carries.', more);

  let record;
  try {
    record = await kernelRecord(snapshot, typeof kernel === 'function' ? await kernel() : kernel);
  } catch (error) {
    return refused(`Lean's kernel did not finish: ${error?.message ?? error}.`, more);
  }
  if (record.refusal) return refused(`The snapshot could not be put to Lean's kernel: ${record.refusal}.`, more);
  const { theorems } = record;
  const answer = (reason) => ({ passed: reason === null, theorems, semantic_id: semanticId, kernel: record.kernel, library: record.library, reason });
  if (theorems.length === 0) return answer('The snapshot states no theorem, so nothing was proved.');
  const claimed = new Map(predicate.theorems.map((t) => [t.name, t.status]));
  const missing = theorems.filter((t) => !claimed.has(t.name));
  if (missing.length) return answer(`The kernel-proof statement leaves out ${missing.length} of the ${theorems.length} theorems the snapshot states: ${missing.slice(0, 3).map((t) => t.name).join(', ')}.`);
  const stated = new Set(theorems.map((t) => t.name));
  const extra = predicate.theorems.filter((t) => !stated.has(t.name));
  if (extra.length) return answer(`The kernel-proof statement lists ${extra.length} theorems the snapshot does not state: ${extra.slice(0, 3).map((t) => t.name).join(', ')}.`);
  const unproved = theorems.filter((t) => t.status !== 'proved');
  if (unproved.length) {
    const overclaimed = unproved.filter((t) => claimed.get(t.name) === 'proved');
    const names = (list) => list.slice(0, 3).map((t) => `${t.name} (${t.status})`).join(', ');
    return answer(
      overclaimed.length
        ? `The kernel-proof statement claims ${overclaimed.length} theorems proved that Lean's kernel does not accept now: ${names(overclaimed)}.`
        : `Lean's kernel did not accept a proof of ${unproved.length} of the ${theorems.length} theorems: ${names(unproved)}.`,
    );
  }
  return answer(null);
}

/**
 * Run LexLean again on the sources a holo carries: the `relex` function of `verify` and `check`. `lexlean` is
 * `{ module, kappa }`: LexLean's front end as a compiled WebAssembly module, and the κ-label it was admitted by; or
 * a function that resolves that, which is called only for a holo that carries sources and a snapshot.
 *
 * Resolves `{ matchesSnapshot, semantic_id, lexlean, reason }`. `matchesSnapshot` is true only when the holo
 * verifies, carries its sources and its snapshot, and LexLean, reading those sources and nothing else, writes the
 * snapshot's exact bytes. `semantic_id` is the one LexLean gave now. It does not throw for a holo it cannot judge.
 */
export async function relex(holoBytes, { lexlean } = {}) {
  let label = null;
  const refused = (reason, semantic_id = null) => ({ matchesSnapshot: false, semantic_id, lexlean: label, reason });
  if (!lexlean || (typeof lexlean !== 'function' && !lexlean.module)) return refused('No LexLean was given: relex(holo, { lexlean }) takes its compiled module and its label.');
  const holo = opened(holoBytes);
  if (holo.problem) return refused(holo.problem);
  const sources = objectOf(holo.parsed, 'sources');
  if (!sources) return refused('The holo carries no sources object.');
  const snapshotBytes = objectOf(holo.parsed, 'snapshot');
  if (!snapshotBytes) return refused('The holo carries no semantic snapshot to compare its sources with.');
  let taken;
  try {
    const files = new Map(readSources(sources).map((file) => [`/${file.path}`, file.bytes]));
    const bound = typeof lexlean === 'function' ? await lexlean() : lexlean;
    label = typeof bound?.kappa === 'string' && LABEL.test(bound.kappa) ? bound.kappa : null;
    taken = await lexleanSnapshot(bound.module, files);
  } catch (error) {
    return refused(`LexLean did not finish on the sources: ${error?.message ?? error}.`);
  }
  if (!taken.ok) {
    const first = (taken.check?.diagnostics ?? []).find((d) => d.severity !== 'warning');
    return refused(`LexLean refuses the sources the holo carries${first ? `: ${first.code ? `${first.code}: ` : ''}${String(first.message ?? '').split('\n')[0]}` : ''}.`);
  }
  const given = typeof taken.snapshot?.semantic_id === 'string' && ID.test(taken.snapshot.semantic_id) ? taken.snapshot.semantic_id : null;
  if (!sameBytes(taken.bytes, snapshotBytes)) {
    return refused(`LexLean, reading the sources the holo carries, writes the snapshot sha256:${sha256HexSync(taken.bytes)}, and the holo carries sha256:${sha256HexSync(snapshotBytes)}.`, given);
  }
  return { matchesSnapshot: true, semantic_id: given, lexlean: label, reason: null };
}
