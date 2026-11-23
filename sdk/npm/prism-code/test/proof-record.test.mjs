// A built holo carries its proof record, and anyone holding the holo alone proves it again (src/journey/proof-record.mjs,
// ADR-018): the model's semantic snapshot, the sources LexLean read, and one unsigned kernel-proof statement. `reprove`
// runs Lean's kernel on the carried snapshot and `relex` runs LexLean on the carried sources; the record is never the
// evidence. The cases build real holos, so they need LexLean and the kernel as the package ships them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES_V5, canonicalJson, parseArchive, readSources, resolveArchive } from '../src/archive.mjs';
import { readAttestations, stripAttestations } from '../src/attestations.mjs';
import { blake3Hex, kappa } from '../src/blake3.mjs';
import { check } from '../src/check.mjs';
import { loadArchive } from '../src/index.mjs';
import { sha256HexSync } from '../src/sha256.mjs';
import { writeObjects } from '../src/uorc.mjs';
import { experimental_verify } from '../src/verify.mjs';
import { build } from '../src/journey/engine.mjs';
import { hasLexleanWasm, lexleanModule, projectFiles, wasmSnapshot } from '../src/journey/lexlean-wasm.mjs';
import { EVALUATOR_GUEST } from '../src/journey/model-guest.mjs';
import { buildHolo } from '../src/journey/model-holo.mjs';
import { ensureModelKernel, openModelKernel } from '../src/journey/model-prove.mjs';
import { readSession, startApp } from '../src/journey/project.mjs';
import { KERNEL_PROOF_PREDICATE_TYPE, proofRecordOf, relex, reprove, withProofRecord } from '../src/journey/proof-record.mjs';
import { LOWERING_LABEL, kernelRecord } from '../src/journey/prove-core.mjs';
import { relexHere, reproveHere } from '../src/journey/reprove-here.mjs';
import { modelVerify } from '../src/model-cli.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const noToolchain = !hasLexleanWasm({}) && 'LexLean as WebAssembly is not on this machine';
const enc = new TextEncoder();
const dec = new TextDecoder();
const evaluator = () => new Uint8Array(readFileSync(new URL(`../src/journey/${EVALUATOR_GUEST.file}`, import.meta.url)));
const label = (bytes) => `blake3:${blake3Hex(bytes)}`;

/** The decision starter in a new folder, built by the engine: `{ dir, bytes, built }`. Built once for the cases that only read it. */
async function builtApp(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prism-proof-record-'));
  startApp(dir, 'decision-app');
  const built = await build(dir, readSession(dir), { root: dir, ...options });
  assert.equal(built.ok, true, built.message);
  return { dir, built, bytes: new Uint8Array(readFileSync(built.holo)) };
}
let shared = null;
const app = () => (shared ??= builtApp());
const kernel = async () => {
  await ensureModelKernel({});
  return openModelKernel({});
};

/** A holo's objects put back together, its statements left off: the manifest's rows and the provenance's application κ made true again. */
function reassemble(objects, optional) {
  const roles = [...ROLES_V5, ...optional];
  const manifest = JSON.parse(dec.decode(objects[0]));
  manifest.objects = [1, 3, 4, 5, 6, ...optional.map((_, i) => 7 + i)].map((i) => ({ kappa: label(objects[i]), length: objects[i].length, role: roles[i] }));
  objects[0] = enc.encode(canonicalJson(manifest));
  objects[2] = enc.encode(canonicalJson({ ...JSON.parse(dec.decode(objects[2])), application_kappa: label(objects[0]) }));
  return writeObjects(objects, 6);
}

/** Every module `entry` loads, by the names it imports and re-exports, followed to the end (as test/push-core.test.mjs walks it). */
function graphOf(entry) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      const name = m[1] ?? m[2];
      if (name.startsWith('.')) visit(resolve(dirname(file), name));
      else seen.set(`${file} -> ${name}`, null);
    }
  };
  visit(entry);
  return seen;
}

test('reprove and relex load nothing of Node, so a page can load them', () => {
  const graph = graphOf(resolve(src, 'journey/proof-record.mjs'));
  assert.deepEqual([...graph.keys()].filter((key) => key.includes(' -> ')), [], 'proof-record.mjs reaches a module that is not a file of this package');
  for (const [file, text] of graph) {
    // A comment says what a module does in words; only its code is held to this.
    const code = text.split('\n').filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line)).join('\n');
    assert.equal(/\bprocess\./.test(code), false, `${file} uses the process`);
    assert.equal(/\bBuffer\b/.test(code), false, `${file} uses Buffer`);
    assert.equal(/\bimport\(\s*['"]node:/.test(text), false, `${file} imports a node: module while running`);
  }
  // The label of the lowering is written in prove-core.mjs, since a page cannot read its modules' bytes: it is those bytes'.
  const lowering = ['emit.mjs', 'lower.mjs', 'plan.mjs'].map((name) => readFileSync(resolve(src, 'vendor/kernel-path', name)));
  assert.equal(LOWERING_LABEL, kappa(Buffer.concat(lowering)), 'vendor/kernel-path changed: write its new label in prove-core.mjs LOWERING_LABEL');
});

test('a build writes the snapshot, the sources and one unsigned kernel-proof statement into the holo, the same bytes twice', { skip: noToolchain, timeout: 600000 }, async () => {
  const { dir, built, bytes } = await app();
  assert.deepEqual(built.carries, { snapshot: true, sources: true, proof: true });
  assert.equal(built.address, kappa(bytes));
  const parsed = parseArchive(bytes);
  assert.deepEqual(parsed.sections.map((s) => s.kind), [...ROLES_V5, 'snapshot', 'sources', 'attestations']);
  assert.equal(resolveArchive(parsed).identities.verified, true);

  // The snapshot is LexLean's exact bytes, named by the source manifest's last row; the sources are the files that decide the model.
  const taken = await wasmSnapshot(dir, {});
  assert.deepEqual([...parsed.sections[7].body], [...taken.bytes]);
  assert.deepEqual(JSON.parse(parsed.metadata.text).files.map((f) => f.kind), ['model-document', 'lexlean-semantic-snapshot']);
  const carried = readSources(parsed.sections[8].body).map((f) => f.path);
  for (const path of ['lexlean.toml', 'lexlean.lock', 'lakefile.toml', 'lean-toolchain', 'lake-manifest.json', 'src/ParkingFeeTier.lex.tex', 'src/ParkingFeeTierProofs.lex.tex']) assert.ok(carried.includes(path), path);
  assert.equal(carried.includes('session.json'), false, 'a file that does not decide the model is left out');
  // prism.toml is the project's, not the model's: LexLean never reads it, and carried it made one model's address
  // depend on the folder it was started in. The project has one here, and the holo does not carry it.
  assert.equal(existsSync(join(dir, 'prism.toml')), true);
  assert.equal(carried.includes('prism.toml'), false);

  // One statement, unsigned, about the model document, the snapshot and the sources; its predicate is the kernel's verdict.
  const statements = readAttestations(parsed);
  assert.equal(statements.length, 1);
  const [{ statement, signed, resolved, subjects }] = statements;
  assert.deepEqual([statement.predicateType, signed, resolved], [KERNEL_PROOF_PREDICATE_TYPE, false, true]);
  assert.deepEqual(subjects.map((s) => s.name), ['model', 'snapshot', 'sources']);
  assert.deepEqual(subjects[1].digest, { blake3: blake3Hex(taken.bytes), sha256: sha256HexSync(taken.bytes) });
  const { predicate } = statement;
  assert.deepEqual(Object.keys(predicate), ['kernel', 'library', 'lowering', 'semantic_id', 'theorems']);
  assert.equal(predicate.semantic_id, taken.snapshot.semantic_id);
  assert.equal(predicate.lowering, LOWERING_LABEL);
  assert.deepEqual(predicate.theorems.map((t) => [t.name, t.status]), ['inv001Holds', 'inv002Holds', 'inv003Holds'].map((name) => [`PrismParkingFeeTier.ParkingFeeTierProofs.${name}`, 'proved']));
  assert.deepEqual(predicate, await kernelRecord(taken.snapshot, await kernel()).then(({ refusal, ...record }) => record));

  // It holds no clock: the same model, built again elsewhere, is the same holo.
  const again = await builtApp();
  assert.equal(again.built.address, built.address);
  // It is a holo like any other: it loads, runs and answers its own vectors, and its statement is a record that is set aside.
  const loaded = await loadArchive(bytes, {});
  assert.equal((await loaded.acceptance()).failed.length, 0);
  const verdict = await experimental_verify(bytes, { minimum: 'P0' });
  assert.deepEqual([verdict.passed, verdict.holo, verdict.reproved], [true, built.address, undefined]);
  assert.equal(verdict.reasons.some((r) => r.check === 'holo.documents'), false, 'the evaluator build\'s documents meet their schemas');
});

test('a built holo verifies alone: the kernel proves its snapshot again and LexLean reads its sources again', { skip: noToolchain, timeout: 600000 }, async () => {
  const { bytes, built } = await app();
  const reproved = await reprove(bytes, { kernel: await kernel() });
  assert.deepEqual([reproved.passed, reproved.reason, reproved.theorems.length], [true, null, 3]);
  assert.ok(reproved.theorems.every((t) => t.status === 'proved'));
  assert.match(reproved.kernel, /^blake3:[0-9a-f]{64}$/);
  const read = await relex(bytes, { lexlean: await lexleanModule({}) });
  assert.deepEqual([read.matchesSnapshot, read.reason, read.semantic_id], [true, null, reproved.semantic_id]);

  // As the claims beside the level: each required by name, and neither moves the level.
  const verdict = await check(bytes, { policy: { minimum: 'P0', require: ['reproved', 'sources'] }, reprove: reproveHere(), relex: relexHere() });
  assert.deepEqual([verdict.passed, verdict.level, verdict.reproved.passed, verdict.sources.present, verdict.sources.matchesSnapshot], [true, 'P0', true, true, true]);
  // Without the functions the record grants nothing.
  const unchecked = await check(bytes, { policy: { minimum: 'P0', require: ['reproved'] } });
  assert.deepEqual([unchecked.passed, unchecked.reproved], [false, undefined]);

  // `prism-code verify <app.holo>`: from the holo alone, each answer apart.
  const { code, report } = await modelVerify(built.holo);
  assert.equal(code, 0, JSON.stringify(report.diagnostics));
  const s = report.summary;
  assert.deepEqual([s.sealed.passed, s.vectors.passed, s.reproved.passed, s.sources.present, s.sources.matchesSnapshot], [true, true, true, true, true]);
  assert.equal(s.vectors.replayed, s.vectors.total);
});

test('a holo built without its sources says they are absent, which fails only a policy that requires them', { skip: noToolchain, timeout: 600000 }, async () => {
  const { bytes, built } = await builtApp({ sources: false });
  assert.deepEqual(built.carries, { snapshot: true, sources: false, proof: true });
  assert.deepEqual(proofRecordOf(bytes), { statement: true, snapshot: true, sources: false });
  const { code, report } = await modelVerify(built.holo);
  assert.equal(code, 0, JSON.stringify(report.diagnostics));
  assert.equal(report.summary.reproved.passed, true);
  assert.deepEqual([report.summary.sources.present, report.summary.sources.matchesSnapshot], [false, null]);
  const required = await modelVerify(built.holo, { policy: { minimum: 'P0', require: ['sources'] } });
  assert.equal(required.code, 1);
  assert.ok(required.report.diagnostics.some((d) => d.code === 'policy.sources'));
  assert.equal((await relex(bytes, { lexlean: await lexleanModule({}) })).matchesSnapshot, false);
});

test('a holo whose snapshot is altered is refused, however the rest is made to agree', { skip: noToolchain, timeout: 600000 }, async () => {
  const { bytes } = await app();
  const k = await kernel();
  const parsed = parseArchive(bytes);
  const objects = () => parsed.sections.slice(0, 9).map((s) => s.body.slice());
  const snapshot = JSON.parse(dec.decode(parsed.sections[7].body));
  const record = JSON.parse(dec.decode(Uint8Array.from(atob(readAttestations(parsed)[0].envelope.payload), (c) => c.charCodeAt(0)))).predicate;
  const altered = enc.encode(JSON.stringify({ ...snapshot, altered: true }));

  // Only the snapshot's bytes changed: its rows no longer name it, and the holo does not verify.
  const swapped = objects();
  swapped[7] = altered;
  const plain = await reprove(writeObjects([...swapped, parsed.sections[9].body], 6), { kernel: k });
  assert.equal(plain.passed, false);
  assert.match(plain.reason, /does not verify/);

  // The rows made true again: the holo verifies, and its statement is the record of another snapshot.
  const rows = objects();
  rows[7] = altered;
  rows[1] = enc.encode(canonicalJson({ ...JSON.parse(dec.decode(rows[1])), files: [JSON.parse(dec.decode(rows[1])).files[0], { kind: 'lexlean-semantic-snapshot', sha256: sha256HexSync(altered) }] }));
  const consistent = reassemble(rows, ['snapshot', 'sources']);
  assert.equal(resolveArchive(parseArchive(consistent)).identities.verified, true);
  const stale = await reprove(writeObjects([...parseArchive(consistent).sections.map((s) => s.body), parsed.sections[9].body], 6), { kernel: k });
  assert.equal(stale.passed, false);
  assert.match(stale.reason, /does not name this holo's snapshot/);

  // The statement written again for the altered snapshot, as anyone can, since it is unsigned: the model document still names the snapshot it was built from.
  const forged = await reprove(withProofRecord(consistent, record), { kernel: k });
  assert.equal(forged.passed, false);
  assert.match(forged.reason, /names another snapshot/);
  // And the sources no longer give it.
  const read = await relex(withProofRecord(consistent, record), { lexlean: await lexleanModule({}) });
  assert.deepEqual([read.matchesSnapshot, read.semantic_id], [false, snapshot.semantic_id]);

  // `prism-code verify` refuses each, by its own code.
  const file = join(mkdtempSync(join(tmpdir(), 'prism-proof-record-altered-')), 'altered.holo');
  writeFileSync(file, withProofRecord(consistent, record));
  const { code, report } = await modelVerify(file);
  assert.equal(code, 1);
  assert.deepEqual(report.diagnostics.map((d) => d.code).sort(), ['verify.reproved', 'verify.sources']);
  assert.deepEqual([report.summary.sealed.passed, report.summary.vectors.passed, report.summary.reproved.passed, report.summary.sources.matchesSnapshot], [true, true, false, false]);

  // A holo with no record at all says so and is not refused for it; a statement left without its snapshot is.
  const bare = stripAttestations(parseArchive(reassemble(parsed.sections.slice(0, 7).map((s) => s.body.slice()), [])));
  assert.deepEqual(proofRecordOf(bare), { statement: false, snapshot: false, sources: false });
  writeFileSync(file, bare);
  const none = await modelVerify(file);
  assert.equal(none.code, 0, JSON.stringify(none.report.diagnostics));
  assert.equal(none.report.summary.reproved.passed, false);
  assert.match(none.report.summary.reproved.reason, /carries no semantic snapshot/);
});

test('a holo whose statement claims a theorem the kernel does not accept is refused', { skip: noToolchain, timeout: 600000 }, async () => {
  // The decision starter with one guarantee turned into its opposite. LexLean reads it, and no kernel accepts it.
  const dir = mkdtempSync(join(tmpdir(), 'prism-proof-record-false-'));
  startApp(dir, 'decision-app');
  const proofs = join(dir, 'src', 'ParkingFeeTierProofs.lex.tex');
  const stated = '((breaksInv001 request) = false)';
  assert.ok(readFileSync(proofs, 'utf8').includes(stated));
  writeFileSync(proofs, readFileSync(proofs, 'utf8').replace(stated, '((breaksInv001 request) = true)'));
  const taken = await wasmSnapshot(dir, {});
  assert.equal(taken.ok, true);
  const k = await kernel();
  const honest = await kernelRecord(taken.snapshot, k);
  assert.deepEqual(honest.theorems.map((t) => t.status), ['unsupported', 'proved', 'proved']);
  const sources = [...projectFiles(dir)].map(([path, bytes]) => ({ path: path.slice(1), bytes }));
  const holo = (proof) => buildHolo(taken.snapshot, { evaluator: evaluator(), snapshotBytes: taken.bytes, sources, proof });

  // The engine builds nothing from this model: its theorems are not all proved.
  const refused = await build(dir, readSession(dir), { root: dir });
  assert.equal(refused.ok, false);
  assert.equal(refused.stage, 'prove');

  // A record that says every theorem was proved: the kernel, asked again, says otherwise.
  const lying = await holo({ ...honest, theorems: honest.theorems.map((t) => ({ ...t, status: 'proved' })) });
  const judged = await reprove(lying.bytes, { kernel: k });
  assert.equal(judged.passed, false);
  assert.match(judged.reason, /claims 1 theorems proved that Lean's kernel does not accept now: PrismParkingFeeTier\.ParkingFeeTierProofs\.inv001Holds/);
  assert.deepEqual(judged.theorems, honest.theorems, 'what is reported is what the kernel answered, never what the statement says');
  const verdict = await check(lying.bytes, { policy: { minimum: 'P0', require: ['reproved'] }, reprove: (bytes) => reprove(bytes, { kernel: k }) });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.reasons.some((r) => r.check === 'policy.reproved'));
  const file = join(dir, 'lying.holo');
  writeFileSync(file, lying.bytes);
  const { code, report } = await modelVerify(file);
  assert.equal(code, 1);
  assert.deepEqual(report.diagnostics.map((d) => d.code), ['verify.reproved']);
  // Its sources are the ones the snapshot came from, and that is a separate answer.
  assert.equal(report.summary.sources.matchesSnapshot, true);

  // An honest record of the same model does not pass either, and says which theorem; a record that leaves one out is refused for that.
  const truthful = await reprove((await holo(honest)).bytes, { kernel: k });
  assert.equal(truthful.passed, false);
  assert.match(truthful.reason, /did not accept a proof of 1 of the 3 theorems/);
  const partial = await reprove((await holo({ ...honest, theorems: honest.theorems.slice(1) })).bytes, { kernel: k });
  assert.match(partial.reason, /leaves out 1 of the 3 theorems/);
});

test('reprove and relex never throw for a holo they cannot judge, and open no kernel for one that carries nothing', async () => {
  let opened = 0;
  const never = async () => { opened++; throw new Error('the kernel was opened'); };
  const v5 = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  for (const bytes of [v5, enc.encode('not a holo'), new Uint8Array(0)]) {
    const judged = await reprove(bytes, { kernel: never });
    assert.deepEqual([judged.passed, judged.theorems, typeof judged.reason], [false, [], 'string']);
    const read = await relex(bytes, { lexlean: never });
    assert.deepEqual([read.matchesSnapshot, typeof read.reason], [false, 'string']);
  }
  assert.equal(opened, 0);
  assert.equal((await reprove(v5)).passed, false);
  assert.equal((await relex(v5)).matchesSnapshot, false);
});
