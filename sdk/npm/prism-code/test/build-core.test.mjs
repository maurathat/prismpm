// The build with no disk of its own (src/journey/build-core.mjs, lexlean-core.mjs, toolchain.mjs): files in, and
// out come diagnostics, the theorems a prover judged, and the holo with its κ-label. It is what `prism_build` runs
// in Node and what a browser worker runs, so the cases here hold for both. The cases that run LexLean itself need
// its 19 MB module, which is not in the repository; with no module they say they did not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { kappa } from '../src/blake3.mjs';
import { buildFromFiles, holoFromSnapshot, readBack, serveBuild } from '../src/journey/build-core.mjs';
import { admitModule, blobStore, compileAdmitted, memoryStore } from '../src/journey/toolchain.mjs';
import { decoded } from '../src/journey/kappa-store.mjs';
import { hasLexleanWasm, lexleanWasmFile, projectFiles, wasmSnapshot } from '../src/journey/lexlean-wasm.mjs';
import { EVALUATOR_GUEST } from '../src/journey/model-guest.mjs';
import { buildHolo } from '../src/journey/model-holo.mjs';
import { appDir, startApp } from '../src/journey/project.mjs';

const journey = fileURLToPath(new URL('../src/journey/', import.meta.url));
const evaluator = () => new Uint8Array(readFileSync(join(journey, EVALUATOR_GUEST.file)));
const models = new URL('../../lean-prover/kernel-path/test/model/', import.meta.url);
const noSnapshots = !existsSync(fileURLToPath(new URL('loan-snapshot.json', models))) && 'no lean-prover package beside this one';
const snapshot = (name) => JSON.parse(readFileSync(new URL(`${name}-snapshot.json`, models), 'utf8'));
const noLexlean = !hasLexleanWasm({}) && 'LexLean as WebAssembly is not on this machine';
let compiled = null;
const lexlean = () => (compiled ??= WebAssembly.compile(decoded(readFileSync(lexleanWasmFile({})))));
const started = (name) => {
  const dir = appDir(mkdtempSync(join(tmpdir(), `prism-build-core-${name}-`)));
  startApp(dir, name);
  return dir;
};
const enc = new TextEncoder();

// That it also runs in a page is shown by test/browser/run.mjs in three browsers, which is not part of this suite.
test('the build core and all it imports name no Node module', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    // What a page must load to load this file: its static imports. An `import()` is reached only where it is called.
    assert.ok(!/^\s*(?:import|export)\b[^'\n]*'node:/m.test(text), `${file} names a Node module`);
    for (const [, path] of text.matchAll(/^\s*(?:import|export)\b[^'\n]*'(\.[^']+)'/gm)) visit(resolve(dirname(file), path));
  };
  for (const name of ['build-core.mjs', 'lexlean-core.mjs', 'toolchain.mjs']) visit(join(journey, name));
  assert.ok(seen.size > 10, 'the walk followed the imports');
  // Planted: the Node engine, walked the same way, is seen to name Node modules.
  assert.throws(() => { seen.clear(); visit(join(journey, 'engine.mjs')); }, /names a Node module/);
});

test('a module is admitted only by its κ-label, decoded, hashed and compiled as it arrives', async () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const label = kappa(wasm);
  const gz = new Uint8Array(gzipSync(wasm));
  const got = await compileAdmitted(new Response(gz), { label, encoding: 'gzip' });
  assert.ok(got.module instanceof WebAssembly.Module);
  assert.deepEqual(got.bytes, wasm);
  assert.ok((await compileAdmitted(new Response(wasm), { label })).module instanceof WebAssembly.Module);
  // Planted: one changed byte, a label that is another's, and bytes that are not gzip.
  const changed = wasm.slice();
  changed[4] = 2;
  await assert.rejects(compileAdmitted(new Response(new Uint8Array(gzipSync(changed))), { label, encoding: 'gzip' }), { code: 'lexlean.wasm-mismatch' });
  await assert.rejects(compileAdmitted(new Response(gz), { label: kappa(changed), encoding: 'gzip' }), { code: 'lexlean.wasm-mismatch' });
  await assert.rejects(compileAdmitted(new Response(wasm), { label, encoding: 'gzip' }), { code: 'lexlean.wasm-mismatch' });
  // Bytes with the right label that are not a module are refused by the compiler, not admitted.
  const text = enc.encode('not a module');
  await assert.rejects(compileAdmitted(new Response(text), { label: kappa(text) }), WebAssembly.CompileError);
});

test('the toolchain is fetched once, kept under its label, and a store is not taken at its word', async () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const pin = { kappa: kappa(wasm), url: 'https://example.invalid/lexlean.wasm.gz' };
  let fetched = 0;
  const fetch = async (url) => { fetched += 1; assert.equal(url, pin.url); return new Response(new Uint8Array(gzipSync(wasm))); };
  const store = memoryStore();
  const first = await admitModule(pin, { store, fetch });
  assert.equal(first.from, 'fetch');
  assert.deepEqual(await store.get(pin.kappa), wasm);
  const second = await admitModule(pin, { store, fetch });
  assert.equal(second.from, 'store');
  assert.equal(fetched, 1);
  // Planted: a store that answers the label with other bytes. They are not compiled; the module is fetched again.
  const lying = { get: async () => new Uint8Array([0, 97, 115, 109, 2, 0, 0, 0]), put: async () => pin.kappa };
  assert.equal((await admitModule(pin, { store: lying, fetch })).from, 'fetch');
  assert.equal(fetched, 2);
  // Nothing kept and nowhere to fetch from, or a server that refuses.
  await assert.rejects(admitModule(pin, { store: memoryStore() }), { code: 'lexlean.wasm-unavailable' });
  await assert.rejects(admitModule(pin, { fetch: async () => new Response('', { status: 404 }) }), { code: 'lexlean.wasm-unavailable' });
  // A store that names its requests getBlob and putBlob serves through the same port.
  const blobs = new Map();
  const shaped = blobStore({ getBlob: async (l) => blobs.get(l) ?? null, putBlob: async (b) => { blobs.set(kappa(b), b); return { label: kappa(b) }; } });
  assert.equal((await admitModule(pin, { store: shaped, fetch })).from, 'fetch');
  assert.equal((await admitModule(pin, { store: shaped })).from, 'store');
});

test('a snapshot becomes the holo Node builds, and each refusal carries its registered code', { skip: noSnapshots }, async () => {
  for (const name of ['loan', 'seat']) {
    const made = await holoFromSnapshot(snapshot(name), { evaluator: evaluator() });
    assert.equal(made.ok, true, name);
    assert.equal(made.built.label, (await buildHolo(snapshot(name), { evaluator: evaluator() })).label);
    const back = await readBack(made.built.bytes);
    assert.equal(back.verified, true);
    assert.equal(back.failed, 0);
    assert.ok(back.total > 0);
  }
  // Planted: no vectors, and an evaluator that is not the pinned one.
  const bare = snapshot('loan');
  const fieldsOf = (model) => model.modules.find((m) => m.name === 'LoanApproval').semantic.declarations.find((d) => d.name === 'application').body.fields;
  fieldsOf(bare).find((f) => f.field === 'acceptanceVectors').value = { kind: 'nil', element: { kind: 'named', member: { name: 'AcceptanceVector' }, arguments: [] } };
  const none = await holoFromSnapshot(bare, { evaluator: evaluator() });
  assert.deepEqual([none.ok, none.code, none.reason, none.stage], [false, 'build.vectors', 'holo.no-vectors', 'build']);
  const other = evaluator();
  other[other.length - 1] ^= 1;
  const refused = await holoFromSnapshot(snapshot('loan'), { evaluator: other });
  assert.deepEqual([refused.ok, refused.code, refused.stage], [false, 'guest.evaluator', 'build']);
  // Planted: a model that asks for capabilities, which this builder does not build. The refusal says the theorems
  // were proved only when a prover said so.
  const asks = snapshot('loan');
  fieldsOf(asks).find((f) => f.field === 'capabilitiesEmpty').value = { kind: 'bool', value: false };
  const after = await holoFromSnapshot(asks, { evaluator: evaluator() });
  const without = await holoFromSnapshot(asks, { evaluator: evaluator(), proved: false });
  assert.deepEqual([after.code, after.reason, without.code], ['build.guest-uncovered', 'holo.capabilities', 'build.guest-uncovered']);
  assert.match(after.message, /proved every theorem/);
  assert.ok(!/proved every theorem/.test(without.message));
});

test('files in, a holo out: the same label as the Node route gives, for a decision and a stateful app', { skip: noLexlean }, async () => {
  for (const name of ['decision-app', 'stateful-app']) {
    const dir = started(name);
    const result = await buildFromFiles({ files: projectFiles(dir), lexlean: await lexlean(), evaluator: evaluator() });
    assert.equal(result.ok, true, `${name}: ${result.message}`);
    assert.equal(result.stage, 'build');
    const taken = await wasmSnapshot(dir, {});
    // The holo carries the files that decide the model, so the Node route is given the same ones.
    const sources = [...projectFiles(dir)].map(([path, bytes]) => ({ path: path.slice(1), bytes }));
    const node = await buildHolo(taken.snapshot, { evaluator: evaluator(), snapshotBytes: taken.bytes, sources });
    assert.deepEqual(result.holo.carries, { snapshot: true, sources: true, proof: false });
    // Told to leave the sources out, it does, and that is another holo.
    const without = await buildFromFiles({ files: projectFiles(dir), lexlean: await lexlean(), evaluator: evaluator(), sources: false });
    assert.deepEqual(without.holo.carries, { snapshot: true, sources: false, proof: false });
    assert.equal(without.holo.label, (await buildHolo(taken.snapshot, { evaluator: evaluator(), snapshotBytes: taken.bytes })).label);
    assert.equal(result.holo.label, node.label);
    assert.equal(result.holo.label, kappa(result.holo.bytes));
    assert.equal(result.vectors.passed, result.vectors.total);
    // Given no prover, it proved nothing and says so.
    assert.equal(result.proved, false);
    assert.equal(result.theorems, null);
    assert.match(result.message, /Not proved here/);
    assert.ok(!/Proved:/.test(result.message));
    assert.equal(result.semanticId, result.holo.semanticId);
    // The same model as an editor holds it: paths with no leading slash, content as text.
    const asText = Object.fromEntries([...projectFiles(dir)].map(([path, bytes]) => [path.slice(1), new TextDecoder().decode(bytes)]));
    assert.equal((await buildFromFiles({ files: asText, lexlean: await lexlean(), evaluator: evaluator() })).holo.label, node.label);
  }
});

test('a prover is asked before anything is built, and a refused model gives its diagnostics', { skip: noLexlean }, async () => {
  const dir = started('decision-app');
  const files = projectFiles(dir);
  const asked = [];
  const yes = async (given) => { asked.push(Object.keys(given).sort().join()); return { ok: true, theorems: [{ theorem: 't', status: 'proved' }] }; };
  const proved = await buildFromFiles({ files, lexlean: await lexlean(), evaluator: evaluator(), prove: yes });
  assert.equal(proved.ok, true);
  assert.equal(proved.proved, true);
  assert.deepEqual(asked, ['files,lexlean,snapshot']);
  assert.match(proved.message, /Proved: Lean's kernel accepted every one of the model's 1 theorems/);
  // A prover that does not accept, and one that cannot run: nothing is built.
  const no = await buildFromFiles({ files, lexlean: await lexlean(), evaluator: evaluator(), prove: async () => ({ ok: false, theorems: [{ theorem: 't', status: 'not proved: no proof' }], message: '1 of 1 theorems are not proved' }) });
  assert.deepEqual([no.ok, no.stage, no.holo, no.proved], [false, 'prove', null, false]);
  const down = await buildFromFiles({ files, lexlean: await lexlean(), evaluator: evaluator(), prove: async () => { throw new Error('no kernel'); } });
  assert.deepEqual([down.ok, down.stage, down.holo, down.code], [false, 'prove', null, 'kernel.unavailable']);
  // Planted: the model's source is no longer a model. LexLean refuses it, with a line to go to.
  const broken = new Map(files);
  const source = [...broken.keys()].find((path) => path.endsWith('.lex.tex'));
  broken.set(source, enc.encode('\\begin{lexlean}{Main}\nthis is not a model\n\\end{lexlean}\n'));
  let called = false;
  const bad = await buildFromFiles({ files: broken, lexlean: await lexlean(), evaluator: evaluator(), prove: async () => { called = true; return { ok: true, theorems: [] }; } });
  assert.deepEqual([bad.ok, bad.stage, bad.holo], [false, 'check', null]);
  assert.equal(called, false, 'a model LexLean refuses is put to no prover');
  assert.ok(bad.diagnostics.length > 0);
  assert.ok(bad.diagnostics.some((d) => d.severity === 'error' && d.code));
  // Each is placed for an editor: the file it is in, and a 1-based line and column.
  const at = bad.diagnostics.find((d) => d.file);
  assert.ok(at, 'a diagnostic names its file');
  assert.ok(at.file.endsWith('.lex.tex') && Number.isInteger(at.line) && at.line >= 1 && Number.isInteger(at.column));
  assert.equal(bad.semanticId, null);
  // The stages are told as they begin, and a refused model reaches only the first.
  const stages = [];
  await buildFromFiles({ files, lexlean: await lexlean(), evaluator: evaluator(), prove: yes, onStage: (stage) => stages.push(stage) });
  await buildFromFiles({ files: broken, lexlean: await lexlean(), evaluator: evaluator(), prove: yes, onStage: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ['check', 'prove', 'build', 'check']);
});

test('a worker serves the same build: files in a message, the holo back under the same label', { skip: noLexlean }, async () => {
  const dir = started('stateful-app');
  const files = projectFiles(dir);
  const direct = await buildFromFiles({ files, lexlean: await lexlean(), evaluator: evaluator() });
  const out = [];
  let asked = 0;
  const scope = { onmessage: null, postMessage: (message, transfer) => out.push({ message, transfer }) };
  serveBuild(scope, { toolchain: async () => { asked += 1; return { lexlean: await lexlean(), evaluator: evaluator() }; } });
  await scope.onmessage({ data: { id: 1, files: [...files] } });
  await scope.onmessage({ data: { id: 2, files: Object.fromEntries(files) } });
  assert.equal(asked, 1, 'the toolchain is admitted once');
  assert.deepEqual(out.map((o) => `${o.message.id} ${o.message.stage ?? 'result'}`), ['1 check', '1 build', '1 result', '2 check', '2 build', '2 result']);
  for (const { message, transfer } of out.filter((o) => o.message.result)) {
    assert.equal(message.result.ok, true);
    assert.equal(message.result.holo.label, direct.holo.label);
    assert.equal(transfer.length, 1, 'the holo is transferred, not copied');
  }
  // A toolchain that cannot be had is an answer, not a silence, and is asked for again next time.
  const failing = { onmessage: null, postMessage: (message) => out.push({ message }) };
  serveBuild(failing, { toolchain: async () => { throw Object.assign(new Error('offline'), { code: 'x' }); } });
  await failing.onmessage({ data: { id: 3, files: [] } });
  assert.deepEqual(out.at(-1).message, { id: 3, error: { code: null, message: 'offline' } });
});
