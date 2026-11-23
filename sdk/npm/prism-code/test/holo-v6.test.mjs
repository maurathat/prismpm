// Holo v6 (ADR-018): upgrading a v5 holo, reading it, signing it with blake3 and sha256 subjects, and pushing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_SCHEMA_V6, PROVENANCE_SCHEMA_V6, ROLES_V5, canonicalJson, holoDigest, parseArchive, resolveArchive, upgradeToV6,
} from '../src/archive.mjs';
import { appendAttestations, BUNDLE_MEDIA_TYPE, DSSE_PAYLOAD_TYPE, readAttestations, STATEMENT_TYPE, stripAttestations } from '../src/attestations.mjs';
import { checkSubjects, experimental_verifyAttestations } from '../src/attest.mjs';
import { experimental_attest, resolveSubjects } from '../src/attest-write.mjs';
import { blake3Hex } from '../src/blake3.mjs';
import { ANNOTATION, holoManifest } from '../src/oci-manifest.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';
import { formatOf, readObjects, writeObjects } from '../src/uorc.mjs';
import { startRegistry } from './support/registry.mjs';

process.env.PRISM_IMAGES ??= mkdtempSync(join(tmpdir(), 'prism-images-store-'));

const v5 = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.v5.holo', import.meta.url)));
const v4 = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const v6 = upgradeToV6(v5);
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const PROOF = 'https://uor.foundation/prism/proof/v1';

const dir = mkdtempSync(join(tmpdir(), 'prism-v6-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fresh = () => join(dir, `store-${counter++}`);

const sigstore = await import('@sigstore/sign').then(() => true, () => false);
const needsSigstore = { skip: sigstore ? false : 'the optional sigstore packages are not installed' };
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });

/** An unsigned placeholder bundle over `subjects`: the shape is real, the signature is not. */
function placeholder(subjects) {
  const statement = { _type: STATEMENT_TYPE, subject: subjects, predicateType: PROOF, predicate: {} };
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64'), payloadType: DSSE_PAYLOAD_TYPE, signatures: [{ keyid: '', sig: '' }] },
  };
}

test('a v5 holo upgrades to a v6 that keeps every content object and verifies', () => {
  assert.equal(formatOf(v6), 6);
  const parsed = parseArchive(v6);
  const resolved = resolveArchive(parsed);
  assert.equal(parsed.format, 6);
  assert.deepEqual(parsed.verification, { footer: true, seal: true, labels: true, labelMismatches: [] });
  assert.equal(resolved.identities.verified, true);
  assert.equal(parsed.kappa, `blake3:${blake3Hex(v6)}`, 'a v6 holo is named by the blake3 of its file');
  assert.equal(holoDigest(parsed), parsed.kappa);

  const before = parseArchive(v5);
  assert.equal(parsed.sections.length, ROLES_V5.length);
  for (const index of [1, 3, 4, 5, 6]) assert.ok(same(parsed.sections[index].body, before.sections[index].body), `${ROLES_V5[index]} keeps its bytes`);
  for (const blob of parsed.blobs) assert.equal(blob.label, `blake3:${blake3Hex(blob.content)}`);

  assert.equal(resolved.manifest.schema, MANIFEST_SCHEMA_V6);
  assert.equal(resolved.provenance.schema, PROVENANCE_SCHEMA_V6);
  assert.equal(resolved.provenance.application_kappa, `blake3:${blake3Hex(parsed.sections[0].body)}`);
  assert.equal(resolved.identities.guestKappa, resolved.provenance.guest_content_kappa);
  const documents = new TextDecoder().decode(parsed.sections[0].body) + parsed.extensions[0].text;
  assert.doesNotMatch(documents, /"sha256:[0-9a-f]{64}"/, 'no κ in the manifest or the provenance is left sha256');
  assert.equal(resolved.provenance.model_id, resolveArchive(before).provenance.model_id, 'the build\'s ids are kept (ADR-018 §7)');
});

test('the upgrade is deterministic, a v6 is left as it is, and a v4 or a signed v5 is refused', () => {
  assert.ok(same(upgradeToV6(v5), v6));
  assert.ok(same(upgradeToV6(v6), v6));
  assert.throws(() => upgradeToV6(v4), { code: 'archive.version' });
  const guest = parseArchive(v5).blobs[1];
  const signed = appendAttestations(v5, [placeholder([{ name: 'guest', digest: { sha256: sha256Hex(guest.content) } }])]);
  assert.throws(() => upgradeToV6(signed), { code: 'attestation.format' });
});

test('one changed byte anywhere in a v6 holo breaks its BLAKE3 seal', () => {
  for (const at of [0x10, Math.floor(v6.length / 2), v6.length - 1]) {
    const planted = v6.slice();
    planted[at] ^= 1;
    assert.throws(() => readObjects(planted), { name: 'DigestMismatchError' });
  }
  const planted = v6.slice();
  planted[Math.floor(v6.length / 2)] ^= 1;
  assert.equal(parseArchive(planted).verification.seal, false);
});

test('a subject of a v6 holo carries blake3 and sha256 over the same bytes, and both are checked', () => {
  const parsed = parseArchive(v6);
  const [subject] = resolveSubjects(parsed, ['guest']);
  const guest = parsed.blobs.find((b) => b.label === resolveArchive(parsed).identities.guestKappa);
  assert.deepEqual(subject, { name: 'guest', digest: { blake3: blake3Hex(guest.content), sha256: sha256Hex(guest.content) } });
  assert.deepEqual(resolveSubjects(parsed, [guest.label]), [{ name: guest.label, digest: subject.digest }]);

  const signed = appendAttestations(v6, [placeholder([subject])]);
  assert.equal(formatOf(signed), 6, 'appending keeps the holo v6');
  const [attestation] = readAttestations(signed);
  assert.equal(attestation.resolved, true);
  checkSubjects(parseArchive(signed), attestation);
  assert.ok(same(stripAttestations(signed), v6), 'stripping returns the unsigned v6 byte for byte');

  // sha256 alone, as a v5 subject would be, is refused in a v6 holo.
  assert.throws(() => appendAttestations(v6, [placeholder([{ name: 'guest', digest: { sha256: subject.digest.sha256 } }])]), { code: 'attestation.subject' });
  // A sha256 that is not the blob's fails even though its blake3 is.
  const wrong = appendAttestations(v6, [placeholder([{ name: 'guest', digest: { ...subject.digest, sha256: '0'.repeat(64) } }])]);
  assert.throws(() => checkSubjects(parseArchive(wrong), readAttestations(wrong)[0]), { name: 'SubjectMismatchError' });
});

test('a v6 holo signed with a key verifies, and its subjects carry both digests', needsSigstore, async () => {
  const { holo, statement } = await experimental_attest(v6, { type: PROOF, predicate: { accepted: true }, key: privateKey });
  assert.equal(formatOf(holo), 6);
  assert.deepEqual(Object.keys(statement.subject[0].digest).sort(), ['blake3', 'sha256']);
  const verdict = await experimental_verifyAttestations(holo, { key: publicKey, type: PROOF });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.error, null);
  assert.ok(same(stripAttestations(holo), v6));
});

test('the OCI manifest of a v6 holo carries its κ beside the sha256 layer digest', async () => {
  const built = await holoManifest(v6);
  const kappa = `blake3:${blake3Hex(v6)}`;
  assert.equal(built.layer.digest, `sha256:${sha256Hex(v6)}`);
  assert.equal(built.layer.annotations[ANNOTATION.BLAKE3], blake3Hex(v6));
  assert.equal(built.fingerprint, kappa);
  assert.equal(built.manifest.annotations[ANNOTATION.FINGERPRINT], kappa);
});

test('a v6 holo pushes and pulls back byte for byte, by tag and by its blake3 κ', async () => {
  const store = fresh();
  const pushed = await experimental_push(v6, `dir://${store}:v1`);
  assert.equal(pushed.fingerprint, `blake3:${blake3Hex(v6)}`);
  assert.ok(same((await experimental_pull(`dir://${store}:v1`)).holo, v6));
  assert.ok(same((await experimental_pull(`dir://${store}@${pushed.fingerprint}`)).holo, v6));
});

test('a push of a v6 holo to a registry stores its layer under its κ too (?also=), and tags its κ', async () => {
  const registry = await startRegistry();
  try {
    const pushed = await experimental_push(v6, `${registry.host}/prism/app:1`, { credentials: null });
    const kappa = `blake3:${blake3Hex(v6)}`;
    assert.equal(registry.state.also.get(kappa), pushed.layer.digest);
    assert.ok(pushed.tags.includes(`blake3-${blake3Hex(v6)}`));
    const pulled = await experimental_pull(`${registry.host}/prism/app:blake3-${blake3Hex(v6)}`, { credentials: null });
    assert.ok(same(pulled.holo, v6));
    assert.equal(pulled.fingerprint ?? holoDigest(parseArchive(pulled.holo)), kappa);

    // A v5 push sends no second address: its κ is the layer digest itself.
    await experimental_push(v5, `${registry.host}/prism/app:2`, { credentials: null });
    assert.equal(registry.state.also.size, 1);
  } finally {
    await registry.close();
  }
});

test('the canonical documents of a v6 are what the reader re-encodes', () => {
  const resolved = resolveArchive(parseArchive(v6));
  assert.equal(canonicalJson(resolved.manifest), new TextDecoder().decode(parseArchive(v6).sections[0].body));
});

test('inspect describes a v6 holo with blake3 labels and both digests, and verifies it', async () => {
  const { inspect } = await import('../src/inspect.mjs');
  const inspection = await inspect(v6);
  assert.equal(inspection.physical_version, 6);
  assert.deepEqual(inspection.verification, { footer: true, labels: true, cross_references: true });
  assert.deepEqual(inspection.digest, { sha256: sha256Hex(v6), blake3: blake3Hex(v6) });
  for (const section of inspection.sections) assert.equal(section.label, `blake3:${section.digest.blake3}`);
  assert.equal(inspection.provenance.schema, PROVENANCE_SCHEMA_V6);
  assert.equal(inspection.revision, (await inspect(v5)).revision, 'the same application is of the same format revision in v5 and v6');
});

test('check reaches the same verdict on a v6 holo as on its v5, and names the v6 by its κ', async () => {
  const { check } = await import('../src/check.mjs');
  const [five, six] = [await check(v5), await check(v6)];
  assert.equal(six.level, five.level);
  assert.equal(six.passed, five.passed);
  assert.deepEqual(six.reasons.map((r) => r.check), five.reasons.map((r) => r.check));
  assert.equal(six.holo, `blake3:${blake3Hex(v6)}`);

  const planted = v6.slice();
  planted[Math.floor(v6.length / 2)] ^= 1;
  const broken = await check(planted);
  assert.equal(broken.level, 'P0');
  assert.match(broken.reasons[0].message, /BLAKE3/);
});

// The optional snapshot and sources objects, and the claims beside the level (ADR-018).
const { OPTIONAL_ROLES_V6, readSources, sourcesArchive, withModelFiles } = await import('../src/archive.mjs');
const enc = new TextEncoder();
const snapshotBytes = enc.encode('{"schema":"lexlean/semantic-snapshot/2","semantic_id":"75956b94d3183b6a527cc8684de8410e0ad931f584a81b090223733e3e6791e4"}');
const files = [
  { path: 'src/Calculator.lex.tex', bytes: enc.encode('\module{Calculator}\n') },
  { path: 'prism.toml', bytes: enc.encode('name = "calculator"\n') },
  { path: 'lexlean.toml', bytes: enc.encode('[package]\nname = "calculator"\n') },
  { path: 'lean-toolchain', bytes: enc.encode('leanprover/lean4:v4.19.0') },
  { path: 'session.json', bytes: enc.encode('{}') },
];
const carried = withModelFiles(v6, { snapshot: snapshotBytes, sources: files });

/** The objects of a v6 put back together with the manifest's rows and the provenance's application κ made true again. */
function reassemble(objects, optional) {
  const label = (bytes) => `blake3:${blake3Hex(bytes)}`;
  const manifest = JSON.parse(new TextDecoder().decode(objects[0]));
  manifest.objects = [1, 3, 4, 5, 6, ...optional.map((_, i) => 7 + i)].map((i) => ({ kappa: label(objects[i]), length: objects[i].length, role: [...ROLES_V5, ...optional][i] }));
  objects[0] = enc.encode(canonicalJson(manifest));
  const provenance = JSON.parse(new TextDecoder().decode(objects[2]));
  objects[2] = enc.encode(canonicalJson({ ...provenance, application_kappa: label(objects[0]) }));
  return writeObjects(objects, 6);
}

test('a v6 carries its snapshot and sources after the model, listed in its rows, and still verifies', () => {
  const parsed = parseArchive(carried);
  assert.deepEqual(parsed.optional, OPTIONAL_ROLES_V6);
  assert.equal(parsed.sections.length, ROLES_V5.length + 2);
  assert.equal(parsed.optionalProblem, null);
  assert.equal(resolveArchive(parsed).identities.verified, true);
  // The snapshot is the source manifest's row; every other content object keeps its bytes.
  const row = JSON.parse(parsed.metadata.text).files.find((f) => f.kind === 'lexlean-semantic-snapshot');
  assert.equal(row.sha256, sha256Hex(snapshotBytes));
  for (const i of [3, 4, 5, 6]) assert.ok(same(parsed.sections[i].body, parseArchive(v6).sections[i].body));
  // The writer keeps the Lake workspace LexLean needs, leaves out a file that does not decide the model, and sorts by bytes.
  assert.deepEqual(readSources(parsed.sections[8].body).map((f) => f.path), ['lean-toolchain', 'lexlean.toml', 'prism.toml', 'src/Calculator.lex.tex']);
  // The snapshot and the sources are blobs a statement may name.
  assert.ok(parsed.blobs.some((b) => b.label === `blake3:${blake3Hex(snapshotBytes)}`));
});

test('a snapshot that is not its row, and sources naming a file outside the set, are refused', async () => {
  const objects = parseArchive(carried).sections.map((s) => s.body.slice());
  const wrongSnapshot = reassemble([...objects.slice(0, 7), enc.encode('{"another":"snapshot"}'), objects[8]], OPTIONAL_ROLES_V6);
  assert.match(parseArchive(wrongSnapshot).optionalProblem, /sha256 is not the source manifest/);
  assert.equal(resolveArchive(parseArchive(wrongSnapshot)).identities.verified, false);
  const index = { files: [{ kappa: `blake3:${blake3Hex(enc.encode('{}'))}`, length: 2, path: 'session.json' }], schema: 'prism/model-sources/1' };
  const outside = writeObjects([enc.encode(canonicalJson(index)), enc.encode('{}')], 6);
  assert.throws(() => readSources(outside), { code: 'archive.sources' });
  const wrongSources = reassemble([...objects.slice(0, 8), outside], OPTIONAL_ROLES_V6);
  assert.match(parseArchive(wrongSources).optionalProblem, /not a file that decides the model/);
  assert.throws(() => sourcesArchive([{ path: 'session.json', bytes: enc.encode('{}') }]), { code: 'archive.sources' }, 'an empty set is not a sources object');
  const { inspect } = await import('../src/inspect.mjs');
  assert.equal((await inspect(wrongSources)).verification.cross_references, false);
});

test('reproved and sources are claims beside the level: run again by the caller, required by name', async () => {
  const { check } = await import('../src/check.mjs');
  const policy = { minimum: 'P0', require: ['reproved'] };
  const without = await check(carried, { policy });
  assert.equal(without.passed, false);
  assert.equal(without.reproved, undefined);
  assert.ok(without.reasons.some((r) => r.check === 'policy.reproved'));
  assert.deepEqual(without.sources, { present: true, matchesSnapshot: null, semantic_id: null, lexlean: null, reason: null });

  const kernel = `blake3:${'1'.repeat(64)}`;
  const library = `blake3:${'2'.repeat(64)}`;
  const seen = [];
  const reprove = async (bytes) => {
    seen.push(bytes);
    return { passed: true, theorems: [{ name: 'Calculator.adds', status: 'proved', axioms: [] }], semantic_id: '7'.repeat(64), kernel, library, reason: null };
  };
  const proved = await check(carried, { policy, reprove });
  assert.equal(proved.passed, true);
  assert.deepEqual(proved.reproved, { passed: true, theorems: [{ name: 'Calculator.adds', status: 'proved', axioms: [] }], semantic_id: '7'.repeat(64), kernel, library, reason: null });
  assert.ok(same(seen[0], carried), 'the hook reads the holo as given');
  assert.equal(proved.level, without.level, 'a claim never moves the level');

  // A pass the theorems do not carry is not a pass, and a hook that throws gives a claim that did not pass.
  const refused = await check(carried, { policy, reprove: async () => ({ passed: true, theorems: [{ name: 'Calculator.adds', status: 'refused', axioms: [] }] }) });
  assert.equal(refused.passed, false);
  assert.equal(refused.reproved.passed, false);
  const thrown = await check(carried, { policy, reprove: async () => { throw new Error('no kernel'); } });
  assert.equal(thrown.reproved.passed, false);
  assert.match(thrown.reproved.reason, /no kernel/);

  const relex = async () => ({ matchesSnapshot: true, semantic_id: '7'.repeat(64), lexlean: `blake3:${'3'.repeat(64)}` });
  const matched = await check(carried, { policy: { minimum: 'P0', require: ['sources'] }, relex });
  assert.equal(matched.passed, true);
  assert.equal(matched.sources.matchesSnapshot, true);
  assert.equal((await check(v6, { policy: { minimum: 'P0', require: ['sources'] }, relex })).passed, false, 'no sources object, no sources claim');
  await assert.rejects(check(carried, { policy: { require: ['everything'] } }), { check: 'policy.invalid' });
});

test('a holo whose provenance fails its schema still has its sources checked and reported', async () => {
  const { check } = await import('../src/check.mjs');
  const objects = parseArchive(carried).sections.map((s) => s.body.slice());
  const provenance = JSON.parse(new TextDecoder().decode(objects[2]));
  objects[2] = enc.encode(canonicalJson({ ...provenance, unexpected_member: true }));
  const verdict = await check(reassemble(objects, OPTIONAL_ROLES_V6), { policy: { minimum: 'P0' } });
  assert.ok(verdict.reasons.some((r) => r.check === 'holo.documents'), 'the provenance fails its schema');
  assert.equal(verdict.sources?.present, true);
});
