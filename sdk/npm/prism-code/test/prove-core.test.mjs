// Lean's kernel judging a model's theorems with no disk of its own (src/journey/prove-core.mjs): what the Node
// prover (model-prove.mjs) and a browser worker both run. Here the kernel's three files come through the build's
// ports, a store and a fetch, as they do in a page, and the prover is asked by the build (build-core.mjs). The
// kernel files come from the lean-prover package beside this one; LexLean's 19 MB module is not in the repository,
// and with neither the cases that need them say they did not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFromFiles } from '../src/journey/build-core.mjs';
import { decoded } from '../src/journey/kappa-store.mjs';
import { hasLexleanWasm, lexleanWasmFile, projectFiles } from '../src/journey/lexlean-wasm.mjs';
import { EVALUATOR_GUEST } from '../src/journey/model-guest.mjs';
import { MODEL_KERNEL_FILES } from '../src/journey/model-prove.mjs';
import { appDir, startApp } from '../src/journey/project.mjs';
import { ModelKernelMissing, kernelProver, openKernelFrom, proveSnapshot, reported, verdictOf } from '../src/journey/prove-core.mjs';
import { memoryStore } from '../src/journey/toolchain.mjs';

const journey = fileURLToPath(new URL('../src/journey/', import.meta.url));
const kernelPath = fileURLToPath(new URL('../../lean-prover/kernel-path/', import.meta.url));
const noKernel = !existsSync(join(kernelPath, 'library', 'base.ndjson.gz')) && 'no lean-prover package beside this one';
const noLexlean = noKernel || (!hasLexleanWasm({}) && 'LexLean as WebAssembly is not on this machine');
const snapshot = (name) => JSON.parse(readFileSync(join(kernelPath, 'test', 'model', `${name}-snapshot.json`), 'utf8'));
const evaluator = () => new Uint8Array(readFileSync(join(journey, EVALUATOR_GUEST.file)));

// The pins a page is given: each file's label, and where it is served. Here they are served from the package.
const served = { 'https://kernel.invalid/lean-kernel.mjs': join(kernelPath, 'kernel', 'lean-kernel.mjs'), 'https://kernel.invalid/lean-kernel.wasm.gz': join(kernelPath, 'kernel', 'lean-kernel.wasm.gz'), 'https://kernel.invalid/base.ndjson.gz': join(kernelPath, 'library', 'base.ndjson.gz') };
const pin = (name) => ({ kappa: MODEL_KERNEL_FILES[name].kappa, url: `https://kernel.invalid/${name}`, encoding: MODEL_KERNEL_FILES[name].encoding });
const pins = { loader: pin('lean-kernel.mjs'), kernel: pin('lean-kernel.wasm.gz'), library: pin('base.ndjson.gz') };
const serving = (change = (bytes) => bytes) => {
  const asked = [];
  return { asked, fetch: async (url) => { asked.push(url); return new Response(change(new Uint8Array(readFileSync(served[url])), url)); } };
};
// Node imports a module from a file, where a page imports it from a blob (`loaderFromBlob`).
const load = async (glue) => {
  const file = join(mkdtempSync(join(tmpdir(), 'prove-core-loader-')), 'lean-kernel.mjs');
  writeFileSync(file, glue);
  return (await import(pathToFileURL(file).href)).default;
};
const store = memoryStore();
let opened = null;
const kernel = () => (opened ??= openKernelFrom(pins, { store, fetch: serving().fetch, load }));

test('the prover core and all it imports name no Node module', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    assert.ok(!/^\s*(?:import|export)\b[^'\n]*'node:/m.test(text), `${file} names a Node module`);
    for (const [, path] of text.matchAll(/^\s*(?:import|export)\b[^'\n]*'(\.[^']+)'/gm)) visit(resolve(dirname(file), path));
  };
  visit(join(journey, 'prove-core.mjs'));
  assert.ok(seen.size > 5, 'the walk followed the imports');
  assert.throws(() => { seen.clear(); visit(join(journey, 'model-prove.mjs')); }, /names a Node module/);
});

test('three answers, never two: proved, not proved, and not settled', () => {
  const th = (status) => reported({ name: 'App.rule', proof: 'decide', status, axioms: null, remembered: false });
  assert.equal(th('proved').status, 'proved');
  assert.equal(th('proved, on fewer axioms than declared').status, 'proved');
  // The kernel accepted a proof, and it rests on what the theorem does not declare: the guarantee as stated fails.
  assert.equal(th(verdictOf({ axioms: ['propext'], declared: [] })).status, 'not proved');
  assert.equal(th(verdictOf({ axioms: ['sorryAx'], declared: ['sorryAx'] })).status, 'not proved');
  // No proof was accepted. That says nothing about the statement.
  assert.equal(th(verdictOf({ axioms: null, declared: [] })).status, 'not settled');
  assert.equal(th("not proved: Lean's kernel refused the proof found (type mismatch)").status, 'not settled');
  assert.equal(th('not proved: the proof kind induction is not covered here yet').status, 'not settled');
  assert.equal(th('proved').theorem, 'rule');
});

test("the kernel's files come through a store and a fetch, each held to its label", { skip: noKernel }, async () => {
  const first = serving();
  const kept = memoryStore();
  const k = await openKernelFrom(pins, { store: kept, fetch: first.fetch, load });
  assert.equal(first.asked.length, 3);
  assert.equal(k.resumed, false);
  assert.equal(k.check('').exit, 0, 'a kernel over its library accepts checking nothing');
  // Kept: opened again with no fetch at all.
  const again = await openKernelFrom(pins, { store: kept, load });
  assert.equal(again.check('').exit, 0);
  // Planted: one changed byte in each file as served. Nothing is opened, and it says nothing about an app.
  for (const target of Object.keys(served)) {
    const bad = serving((bytes, url) => { if (url === target) bytes[bytes.length >> 1] ^= 1; return bytes; });
    await assert.rejects(openKernelFrom(pins, { store: memoryStore(), fetch: bad.fetch, load }), (e) => e instanceof ModelKernelMissing && e.code === 'kernel.unavailable', target);
  }
  // Nothing kept and nowhere to fetch from; and a server that refuses.
  await assert.rejects(openKernelFrom(pins, { store: memoryStore(), load }), ModelKernelMissing);
  await assert.rejects(openKernelFrom(pins, { fetch: async () => new Response('', { status: 503 }), load }), ModelKernelMissing);
});

test('a snapshot is proved on that kernel, a false statement is not, and a verdict kept is not judged again', { skip: noKernel }, async () => {
  const k = await kernel();
  const known = new Map();
  let keeps = 0;
  const loan = await proveSnapshot(snapshot('loan'), k, { known, keep: () => { keeps += 1; } });
  assert.equal(loan.ok, true);
  assert.ok(loan.theorems.length > 0 && loan.theorems.every((t) => t.status.startsWith('proved') && Number.isInteger(t.ms)));
  assert.equal(keeps, 1);
  const again = await proveSnapshot(snapshot('loan'), k, { known, keep: () => { keeps += 1; } });
  assert.deepEqual([again.ok, again.judged, again.remembered, keeps], [true, 0, loan.theorems.length, 1]);
  // Planted: a statement that is false of the model. It is not settled; the other seven are still proved.
  const seat = snapshot('seat');
  seat.modules.flatMap((m) => m.semantic.declarations).find((d) => d.kind === 'theorem' && d.name === 'startInBounds').statement.right.value = true;
  const judged = (await proveSnapshot(seat, k)).theorems.map(reported);
  assert.equal(judged.find((t) => t.theorem === 'startInBounds').status, 'not settled');
  assert.equal(judged.filter((t) => t.status === 'proved').length, 7);
});

test('a resettable kernel is laid back to its just-loaded state, and a kept memory resumes another', { skip: noKernel }, async () => {
  const k = await openKernelFrom(pins, { store, fetch: serving().fetch, load, resettable: true });
  const fresh = k.memory();
  assert.equal((await proveSnapshot(snapshot('seat'), k)).ok, true);
  const same = (a, b) => Buffer.compare(a, b) === 0;
  assert.equal(same(k.memory().subarray(0, fresh.length), fresh), false, "judging changed the kernel's memory");
  k.reset();
  // After the reset every byte is the just-loaded kernel's, whatever the memory grew to, and it proves as before.
  const back = k.memory();
  assert.equal(same(back.subarray(0, fresh.length), fresh), true);
  assert.ok(back.subarray(fresh.length).every((b) => b === 0));
  assert.equal(k.check('').exit, 0);
  assert.equal((await proveSnapshot(snapshot('loan'), k)).ok, true);
  // The memory, given to a second kernel as its image, resumes it with no library read; a damaged one is set aside.
  const resumed = await openKernelFrom(pins, { store, load, image: fresh });
  assert.equal(resumed.resumed, true);
  assert.equal((await proveSnapshot(snapshot('loan'), resumed)).ok, true);
  const damaged = await openKernelFrom(pins, { store, load, image: fresh.subarray(0, 4096) });
  assert.equal((await proveSnapshot(snapshot('loan'), damaged)).ok, true, 'a kernel is always had: an image only saves time');
  // A kernel not opened resettable says so, and holds no copy.
  await assert.rejects(kernel().then((plain) => plain.reset()), /not opened resettable/);
});

test('the build asks the prover, reports each theorem, and builds the same holo as without one', { skip: noLexlean }, async () => {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-prove-core-')));
  startApp(dir, 'decision-app');
  const files = projectFiles(dir);
  const lexlean = await WebAssembly.compile(decoded(readFileSync(lexleanWasmFile({}))));
  const stages = [];
  const built = await buildFromFiles({ files, lexlean, evaluator: evaluator(), prove: kernelProver(await kernel()), onStage: (stage) => stages.push(stage) });
  assert.equal(built.ok, true, built.message);
  assert.deepEqual(stages, ['check', 'prove', 'build']);
  assert.equal(built.proved, true);
  assert.ok(built.theorems.length > 0);
  for (const t of built.theorems) assert.deepEqual([t.status, typeof t.theorem, Array.isArray(t.axioms)], ['proved', 'string', true], t.name);
  assert.match(built.message, new RegExp(`Proved: Lean's kernel accepted every one of the model's ${built.theorems.length} theorems`));
  const bare = await buildFromFiles({ files, lexlean, evaluator: evaluator() });
  assert.equal(built.holo.label, bare.holo.label, 'proving changes no byte of the holo');
  assert.equal(bare.proved, false);
});
