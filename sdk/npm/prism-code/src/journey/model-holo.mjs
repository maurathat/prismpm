/**
 * A text application's holo, built from its model's semantic snapshot with nothing compiled: the evaluator guest
 * with the model's program (model-guest.mjs), the page (text-view.mjs), the model document, and the seal.
 *
 * The result is a holo v5 (ADR-017, `src/uorc.mjs`): the seven objects PrismPM's own build writes, in its order,
 * named and sealed the same way, so every reader of a holo reads it. Two things differ from a holo the SDK image
 * builds, and the provenance object says both: the guest is the evaluator guest and the model's program, not Rust
 * compiled from Lean's export, so there is no Cargo crate and no browser adapter to name; and `builder` names
 * what built it, by the evaluator guest's κ-label.
 *
 * A build is refused unless the guest answers every one of the model's own acceptance vectors, and every request
 * made from them, as the reference evaluator does (`holo.guest-differs`), and unless the model has vectors at all
 * (`holo.no-vectors`). That is tested, not proved. What Lean proved about the model is a separate question, which
 * this file does not answer or record.
 *
 * It is a pure function of the snapshot and the evaluator guest: the same model gives the same bytes anywhere.
 * It imports nothing of Node, so a browser and a worker run it.
 */
import { canonicalJson } from '../archive.mjs';
import { compileGuest, runGuest } from '../core.mjs';
import { sha256HexSync } from '../sha256.mjs';
import { kappa, writeObjects } from '../uorc.mjs';
import { kappa as label } from '../blake3.mjs';
import { ModelEvalRefused, modelProgram } from './model-eval.mjs';
import { EVALUATOR_GUEST, admitEvaluator, encodeProgram, guestAgrees, linkGuest } from './model-guest.mjs';
import { textViewBundle } from './text-view.mjs';

/** What built the holo: this path, and its revision. */
export const HOLO_BUILDER = 'prism-code/evaluator-guest/1';
export const TEXT_PROFILE = 'prismpm/text-application/1';
const CORE_CONTRACT = 'hologram:guest/core-wasm@1';
const MODEL_DOCUMENT_SCHEMA = 'prismpm/model-document/2';
const PROVENANCE_SCHEMA = 'prismpm/model-provenance/2';
const MANIFEST_SCHEMA = 'prism/holo/5';

/** The empty capability set, as a holo carries it: Hologram's capability-set realization with nothing granted. */
export const NO_CAPABILITIES_OBJECT = (() => {
  const out = new Uint8Array(104);
  out.set(new TextEncoder().encode('https://hologram.foundation/realization/capability-set'));
  out[59] = 0x29;
  return out;
})();

const refuse = (code, message) => { throw new ModelEvalRefused(code, message); };
const enc = new TextEncoder();
const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const whole = (n, what) => (n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : refuse('holo.model', `${what} is too large`));
const EMPTY = Object.freeze({
  architecture: ['component_kinds', 'components', 'concerns', 'edge_kinds', 'edges', 'model_kinds', 'stakeholders', 'viewpoints', 'views'],
  quality: ['characteristics', 'measures', 'requirements', 'subcharacteristics'],
  security: ['activities', 'assets', 'controls', 'impacts', 'likelihoods', 'measurements', 'risks', 'threats'],
});

/**
 * The model document of a text application: its `TextApplication` record as the SDK's own document names it.
 * A model that states architecture, quality or security facets is refused: this builder does not carry them yet.
 */
export function modelDocument(snapshot, application, { snapshotId = null } = {}) {
  if (snapshot.modules.some((m) => (m.linked_ir?.blocks ?? []).length > 0)) refuse('holo.facets', 'the model states blocks beside its definitions, which this builder does not carry yet');
  const doc = {};
  for (const [name, value] of Object.entries(application)) {
    if (name === 'acceptanceVectors') doc.acceptance_vectors = value.map((v) => ({ request: [...v.request], response: [...v.response] }));
    else if (name === 'view') doc.view = Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), v]));
    else doc[snake(name)] = typeof value === 'bigint' ? whole(value, name) : value;
  }
  const empty = (keys) => Object.fromEntries(keys.map((k) => [k, []]));
  return {
    application: doc,
    architecture: empty(EMPTY.architecture),
    provenance: { compiler_semantics_id: snapshot.compiler_semantics_id, facet_packages: [], semantic_id: snapshot.semantic_id, ...(snapshotId ? { snapshot_id: snapshotId } : {}), source_id: snapshot.source_id },
    quality: empty(EMPTY.quality),
    schema: MODEL_DOCUMENT_SCHEMA,
    security: empty(EMPTY.security),
    standards_profile: [],
  };
}

/**
 * Build the holo. `evaluator` is the evaluator guest's bytes, admitted only when they are the pinned ones.
 * `snapshotBytes`, LexLean's exact output, names the snapshot in the records when given.
 * Returns `{ bytes, label, kappa, name, semanticId, guest, vectors, compared, objects }`. `label` is the holo's
 * address, the UOR κ-label of its bytes (BLAKE3). `kappa` is the identity the holo v5 format gives itself and its
 * members, which is SHA-256 (ADR-017); it is kept because every reader of a holo checks it.
 */
export async function buildHolo(snapshot, { evaluator, snapshotBytes = null } = {}) {
  const program = modelProgram(snapshot);
  const app = program.application;
  if (app.profile !== TEXT_PROFILE) refuse('holo.profile', `the model's profile is ${JSON.stringify(app.profile)}, and this builder builds ${TEXT_PROFILE}`);
  if (app.coreContract !== CORE_CONTRACT) refuse('holo.profile', `the model's guest contract is ${JSON.stringify(app.coreContract)}, and the evaluator guest is ${CORE_CONTRACT}`);
  if (app.capabilitiesEmpty !== true) refuse('holo.capabilities', 'the model asks for capabilities, and this builder builds an app that has none');
  if (app.acceptanceVectors.length === 0) refuse('holo.no-vectors', 'the model has no acceptance vectors, so nothing shows the built app answers as the model does');

  // The reference evaluator first: a model whose own examples it does not answer is not built.
  const reference = program.acceptance();
  if (reference.failed.length) refuse('holo.vectors', `${reference.failed.length} of ${reference.total} acceptance vectors are not what the model's own rules answer`);

  const guest = linkGuest(admitEvaluator(evaluator), encodeProgram(snapshot).bytes);
  const module = await compileGuest(guest);
  const compared = await guestAgrees(snapshot, (request) => runGuest(module, request));
  if (compared.differ.length) refuse('holo.guest-differs', `the guest answers ${compared.differ.length} of ${compared.total} requests otherwise than the model does`);

  const view = textViewBundle(app.view, { requestMaximum: whole(app.requestMaximum, 'requestMaximum'), responseMaximum: whole(app.responseMaximum, 'responseMaximum') });
  const snapshotId = snapshotBytes ? sha256HexSync(new Uint8Array(snapshotBytes)) : null;
  const model = enc.encode(canonicalJson(modelDocument(snapshot, app, { snapshotId })));
  const modelId = sha256HexSync(model);
  const source = enc.encode(canonicalJson({
    files: [...(snapshotId ? [{ kind: 'lexlean-semantic-snapshot', sha256: snapshotId }] : []), { kind: 'model-document', sha256: modelId }],
    semantic_id: snapshot.semantic_id,
    source_id: snapshot.source_id,
    version: 4,
  }));
  const capabilities = NO_CAPABILITIES_OBJECT;
  const row = (role, bytes) => ({ kappa: kappa(bytes), length: bytes.length, role });
  const manifest = enc.encode(canonicalJson({
    layers: [
      { contract: CORE_CONTRACT, entry: 'holo_run', kappa: kappa(guest), kind: 'wasm' },
      { entry: 'index.html', kappa: kappa(view), kind: 'view', surface: 'portable' },
    ],
    name: app.name,
    objects: [row('source-manifest', source), row('capabilities', capabilities), row('guest', guest), row('view', view), row('model', model)],
    requires: kappa(capabilities),
    schema: MANIFEST_SCHEMA,
  }));
  const provenance = enc.encode(canonicalJson({
    application_kappa: kappa(manifest),
    builder: { evaluator_guest: EVALUATOR_GUEST.kappa, guest: label(guest), model: label(model), name: HOLO_BUILDER, ...(snapshotBytes ? { snapshot: label(new Uint8Array(snapshotBytes)) } : {}), view: label(view), vectors: { compared: compared.total, replayed: reference.total } },
    cargo_name: app.cargoName,
    cargo_version: app.cargoVersion,
    compiler_semantics_id: snapshot.compiler_semantics_id,
    core_wasm_contract: CORE_CONTRACT,
    guest_content_kappa: kappa(guest),
    model_content_kappa: kappa(model),
    model_id: modelId,
    schema: PROVENANCE_SCHEMA,
    semantic_id: snapshot.semantic_id,
    source_id: snapshot.source_id,
    view_binding: { tag: 'present', view_content_kappa: kappa(view) },
  }));
  const objects = [manifest, source, provenance, capabilities, guest, view, model];
  const bytes = writeObjects(objects);
  return { bytes, label: label(bytes), kappa: kappa(bytes), name: app.name, semanticId: snapshot.semantic_id, guest, vectors: { total: reference.total, passed: reference.passed }, compared: { total: compared.total, agreed: compared.agreed }, objects: objects.map((o) => o.length) };
}
