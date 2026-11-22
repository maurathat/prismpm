// The kernel path in prism-code (src/journey/model-prove.mjs): a model's semantic snapshot proved by Lean's kernel in
// this process. The kernel files come from the lean-prover package beside this one, by PRISM_MODEL_KERNEL_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureModelKernel, modelProve, modelProveDeclared, openModelKernel, MODEL_KERNEL_FILES } from '../src/journey/model-prove.mjs';
import { gunzipSync } from 'node:zlib';
import { proverWhere } from '../src/journey/frontend.mjs';
import { plan } from '../src/vendor/kernel-path/plan.mjs';

const kernelPath = fileURLToPath(new URL('../../lean-prover/kernel-path/', import.meta.url));
const here = existsSync(join(kernelPath, 'library', 'base.ndjson.gz'));
const kernelDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'model-kernel-'));
  copyFileSync(join(kernelPath, 'kernel', 'lean-kernel.mjs'), join(dir, 'lean-kernel.mjs'));
  copyFileSync(join(kernelPath, 'kernel', 'lean-kernel.wasm.gz'), join(dir, 'lean-kernel.wasm.gz'));
  copyFileSync(join(kernelPath, 'library', 'base.ndjson.gz'), join(dir, 'base.ndjson.gz'));
  return dir;
};
const storeDir = () => mkdtempSync(join(tmpdir(), 'kappa-'));
const snapshot = (name) => JSON.parse(readFileSync(join(kernelPath, 'test', 'model', `${name}-snapshot.json`), 'utf8'));
const noFetch = async (url) => { throw new Error(`a request was made: ${url}`); };

test('an app is always proved in this process: PRISM_CODE_TIER=hosted no longer names a hosted verifier', () => {
  assert.equal(proverWhere(), 'kernel');
  assert.equal(proverWhere({ env: { PRISM_CODE_TIER: 'offline' } }), 'kernel');
  assert.equal(proverWhere({ env: { PRISM_CODE_TIER: 'hosted' } }), 'kernel');
});

test('the lowering and proof finder here are byte for byte the ones the sealed browser prover runs', { skip: !here && 'no lean-prover package beside this one' }, () => {
  for (const name of ['emit.mjs', 'lower.mjs', 'plan.mjs', 'declarations.mjs']) {
    assert.ok(readFileSync(new URL(`../src/vendor/kernel-path/${name}`, import.meta.url)).equals(readFileSync(join(kernelPath, 'src', name))), name);
  }
});

test('the pinned files are the ones the lean-prover package carries', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  await ensureModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir() }, fetch: noFetch });
  assert.deepEqual(Object.keys(MODEL_KERNEL_FILES), ['lean-kernel.mjs', 'lean-kernel.wasm.gz', 'base.ndjson.gz']);
});

test('a file that is not the pinned bytes is refused', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  const dir = kernelDir();
  writeFileSync(join(dir, 'base.ndjson.gz'), 'not the base library');
  await assert.rejects(ensureModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: dir }, fetch: noFetch }), /pinned bytes/);
});

test("a loan app and a seat-booking app are proved by Lean's kernel, sending nothing", { skip: !here && 'no lean-prover package beside this one' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const loan = await modelProve(snapshot('loan'), { env, fetch: noFetch });
  assert.equal(loan.ok, true);
  assert.equal(loan.theorems.length, 3);
  assert.ok(loan.theorems.every((t) => t.status === 'proved'));
  const seat = await modelProve(snapshot('seat'), { env, fetch: noFetch });
  assert.equal(seat.ok, true);
  assert.equal(seat.theorems.length, 8);
  // Fewer axioms than declared is proved, and said.
  assert.ok(seat.theorems.some((t) => t.status === 'proved, on fewer axioms than declared'));
});

test('a theorem whose proof kind is not covered is not proved, and says why', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  const s = snapshot('loan');
  const th = s.modules.flatMap((m) => m.semantic.declarations).find((d) => d.kind === 'theorem');
  th.proof = { kind: 'induction' };
  const r = await modelProve(s, { kernel: await openModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() } }) });
  assert.equal(r.ok, false);
  assert.match(r.theorems.find((t) => t.name.endsWith(`.${th.name}`)).status, /proof kind induction is not covered/);
});

test('a false statement is not proved', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  const s = snapshot('seat');
  const th = s.modules.flatMap((m) => m.semantic.declarations).find((d) => d.kind === 'theorem' && d.name === 'startInBounds');
  th.statement.right.value = true; // breaksStartInBounds = true: false of this model
  const r = await modelProve(s, { kernel: await openModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() } }) });
  assert.equal(r.ok, false);
  assert.match(r.theorems.find((t) => t.name.endsWith('.startInBounds')).status, /^not proved/);
  // The other seven are still judged, and proved.
  assert.equal(r.theorems.filter((t) => t.status.startsWith('proved')).length, 7);
});

test("the canonical template's theorem, proved by simplify, is proved on the axioms it declares", { skip: !here && 'no lean-prover package beside this one' }, async () => {
  // conformant_decides states a Boolean test equals its proposition. Every digest equation it needs is given by a
  // hypothesis; before, each was proved again through LexReflect.nat_eq_of, whose proof rests on Quot.sound, so the
  // theorem was refused for an axiom it does not declare. Snapshot: UOR-Foundation/template at 3fa228d7, app/.
  const r = await modelProve(snapshot('template-contract'), { kernel: await openModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() } }), fetch: noFetch });
  const th = r.theorems.find((t) => t.name.endsWith('.conformant_decides'));
  assert.match(th.status, /^proved/, th.status);
  assert.deepEqual(th.axioms, ['propext']);
  assert.equal(r.ok, true);
});

test('the proof finder finds the same proofs with no process, as in a browser worker', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  // A worker has no `process`. The finder read process.env for two debugging switches, so there every candidate
  // proof threw and a theorem Node proves was "not settled" in a page.
  const k = await openModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() } });
  const found = (name) => { const p = plan(snapshot(name), k.library); return { status: p.theorems.map((t) => [t.name, t.status]), file: p.file(p.theorems.filter((t) => !t.status).map((t) => t.name)) }; };
  for (const name of ['template-contract', 'loan', 'seat', 'or']) {
    const inNode = found(name);
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'process');
    Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true, writable: true });
    let inWorker;
    try { inWorker = found(name); } finally { Object.defineProperty(globalThis, 'process', saved); }
    assert.deepEqual(inWorker.status, inNode.status, name);
    assert.equal(inWorker.file, inNode.file, `${name}: the same proofs, byte for byte`);
  }
});

test('a theorem judged once is not judged again, in this app or in another app with the same theorem', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const first = await modelProve(snapshot('seat'), { env, fetch: noFetch });
  assert.equal(first.ok, true);
  assert.equal(first.judged, 8);
  const again = await modelProve(snapshot('seat'), { env, fetch: noFetch });
  assert.equal(again.ok, true);
  assert.deepEqual([again.judged, again.remembered], [0, 8]);
  assert.deepEqual(again.theorems.map((t) => t.status), first.theorems.map((t) => t.status));
  // The same model in another project: other Lean names, the same keys.
  const other = snapshot('seat');
  for (const m of other.modules) m.lean_module = m.lean_module.replace(/^[^.]+/, 'AnotherApp');
  const elsewhere = await modelProve(other, { env, fetch: noFetch });
  assert.equal(elsewhere.ok, true);
  assert.deepEqual([elsewhere.judged, elsewhere.remembered], [0, 8]);
  // An edit is judged, and only it.
  const edited = snapshot('seat');
  const th = edited.modules.flatMap((m) => m.semantic.declarations).find((d) => d.kind === 'theorem' && d.name === 'inv002Holds');
  th.statement = { kind: 'eq', left: { kind: 'bool', value: false }, right: { kind: 'bool', value: false } };
  th.proof = { kind: 'reflexivity' }; th.axioms = [];
  const after = await modelProve(edited, { env, fetch: noFetch });
  assert.deepEqual([after.ok, after.judged, after.remembered], [true, 1, 7]);
});

test('statements with || are proved, in a hypothesis, nested, and as the goal; a false one is not', { skip: !here && 'no lean-prover package beside this one' }, async () => {
  // Before, every proof through `||` cited Init's Bool.or_eq_true, which the base library does not hold, and the
  // kernel refused it as an unknown constant.
  const r = await modelProve(snapshot('or'), { kernel: await openModelKernel({ env: { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() } }) });
  const status = Object.fromEntries(r.theorems.map((t) => [t.name.slice(t.name.lastIndexOf('.') + 1), t.status]));
  for (const name of ['aSkillInstallsOnlyAsTheBytesItsPinnedModelRenders', 'aSkillInstallsOnlyWithNoNetworkSecretsOrExecution', 'everyNetworkCountIsZeroOrNot']) {
    assert.match(status[name], /^proved/, `${name}: ${status[name]}`);
  }
  assert.match(status.notEveryCountIsZero, /^not proved/);
  assert.doesNotMatch(Object.values(status).join('\n'), /unknown constant/);
});

test('the kernel image only saves time: a process resumes from it, and an image that will not resume is set aside for a fresh kernel', { skip: !here && 'no lean-prover package beside this one', timeout: 180000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const { gzipSync, gunzipSync } = await import('node:zlib');
  // The store's own label, the UOR content-addressed BLAKE3 label: an image is admitted only under it.
  const { kappa } = await import('../src/blake3.mjs');
  const env = { ...process.env, PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  // One process per open: the kernel is opened once per process. setAside says why an image was not resumed.
  const open = () => {
    const script = `const m = await import(${JSON.stringify(new URL('../src/journey/model-prove.mjs', import.meta.url).href)}); const k = await m.openModelKernel(); console.log(JSON.stringify({ resumed: k.resumed, exit: k.check('').exit, setAside: k.setAside ?? null }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  };
  const first = open(), second = open();
  assert.deepEqual(first, { resumed: false, exit: 0, setAside: null }, 'the first process reads the library and keeps an image');
  assert.deepEqual(second, { resumed: true, exit: 0, setAside: null }, `the next resumes from it${second.setAside ? `; it was set aside: ${second.setAside}` : ''}`);
  const dir = join(env.PRISM_KAPPA_DIR, 'kernel-path');
  const pointer = readdirSync(dir).find((f) => f.startsWith('image-'));
  const real = readFileSync(join(dir, pointer), 'utf8').split('\n')[1].trim();
  const image = gunzipSync(readFileSync(join(dir, 'images', real.slice(7))));
  const keep = (bytes) => {
    const gz = gzipSync(bytes), label = kappa(gz);
    writeFileSync(join(dir, 'images', label.slice(7)), gz);
    writeFileSync(join(dir, pointer), `${kappa(new TextEncoder().encode(label))}\n${label}`);
  };
  // An image larger than a fresh kernel's memory, as a machine keeps whose library load grew it (80.5 MB on CI against
  // 64 MB): the kernel must grow to it, which asking malloc for the difference alone did not do.
  const larger = new Uint8Array(image.length + 16 * 1024 * 1024);
  larger.set(image);
  keep(larger);
  assert.deepEqual(open(), { resumed: true, exit: 0, setAside: null }, 'an image larger than a fresh kernel resumes');
  // An image that carries its own label but is not a working kernel's memory: the real image with its first 8 MiB
  // cleared. Resumed as it is, the kernel traps on every check (memory access out of bounds).
  image.fill(0, 0, 8 * 1024 * 1024);
  keep(image);
  const third = open();
  assert.deepEqual({ resumed: third.resumed, exit: third.exit }, { resumed: false, exit: 0 }, 'an image that will not resume gives a fresh kernel, never a failed proof');
  assert.match(third.setAside, /did not answer|grew to/, 'and says why it was set aside');
  assert.deepEqual(open(), { resumed: true, exit: 0, setAside: null }, 'and the fresh kernel keeps a good image again');
});

// LexLean's own declarations of the decision-app starter (`lexlean declare`, LexLean CL-29), with inv001Holds proved by
// `decide`: once true, once false. LexLean produces a `decide` proof of a statement over a variable, which the kernel
// refuses; it is set aside and the theorem found here like any other.
const declared = (name) => {
  const dir = join(kernelPath, 'test', 'fixtures', 'declarations', name);
  const meta = JSON.parse(readFileSync(join(dir, 'declarations.json'), 'utf8'));
  return { ...meta, suffix: gunzipSync(readFileSync(join(dir, 'declarations.ndjson.gz'))).toString('utf8') };
};
const hasDeclarations = here && existsSync(join(kernelPath, 'test', 'fixtures', 'declarations', 'decide-over-variable-true'));

test("an app LexLean declared is proved from its own declarations, a refused proof of LexLean's set aside", { skip: !hasDeclarations && 'no declaration fixtures beside this package' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const r = await modelProveDeclared(declared('decide-over-variable-true'), { env, fetch: noFetch });
  assert.equal(r.ok, true, r.refusal);
  assert.equal(r.theorems.length, 3);
  assert.ok(r.theorems.every((t) => t.status.startsWith('proved')), JSON.stringify(r.theorems.map((t) => t.status)));
  const inv1 = r.theorems.find((t) => t.name.endsWith('.inv001Holds'));
  assert.match(inv1.setAside, /the kernel refused LexLean's proof/);
  assert.equal(r.setAside, 1);
});

test('a false theorem LexLean declared stays not proved, and the true ones are proved', { skip: !hasDeclarations && 'no declaration fixtures beside this package' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const r = await modelProveDeclared(declared('decide-over-variable-false'), { env, fetch: noFetch });
  assert.equal(r.ok, false);
  const inv1 = r.theorems.find((t) => t.name.endsWith('.inv001Holds'));
  assert.match(inv1.status, /^not proved/);
  assert.deepEqual(r.theorems.filter((t) => t.status.startsWith('proved')).map((t) => t.name.split('.').pop()).sort(), ['inv002Holds', 'inv003Holds']);
});

test("declarations not written over this kernel's library are refused, never judged", { skip: !hasDeclarations && 'no declaration fixtures beside this package' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const self = { ...declared('decide-over-variable-true'), library: false };
  const r = await modelProveDeclared(self, { env, fetch: noFetch });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /no declarations over this kernel's library/);
});

test("a statement LexLean declared that no longer type-checks refuses the model; nothing is reported proved", { skip: !hasDeclarations && 'no declaration fixtures beside this package' }, async () => {
  const env = { PRISM_MODEL_KERNEL_DIR: kernelDir(), PRISM_KAPPA_DIR: storeDir() };
  const altered = declared('decide-over-variable-true');
  // A declaration line that names an expression index nothing defines: the kernel cannot read the declarations.
  altered.suffix = altered.suffix.replace(/("def":\{[^\n]*?"type":)(\d+)/, (m, head) => `${head}99999999`);
  assert.notEqual(altered.suffix, declared('decide-over-variable-true').suffix, 'the fixture holds a definition to alter');
  const r = await modelProveDeclared(altered, { env, fetch: noFetch });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /refused LexLean's declarations/);
  assert.equal(r.theorems.length, 0);
});
