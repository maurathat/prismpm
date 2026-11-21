// The journey with one source of truth: an app's LexLean model, started from a content-addressed starter and
// written by the agent. There is no spec file, no step runs a local image, and there is no server: with no LexLean
// as WebAssembly every step is refused and names what is missing, and nothing is sent. The semantic snapshot here
// comes from the journey's `snapshot` option, a stand-in for LexLean that answers in this process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appDir, sourceFiles, startApp, starters } from '../src/journey/project.mjs';
import { build, check, prove, tryRequest } from '../src/journey/engine.mjs';
import { INSTRUCTIONS, TOOLS, createServer } from '../src/journey/mcp.mjs';
import { ruleTable } from '../src/journey/rule-table.mjs';
import { PARKING, ruleAppSnapshot } from './support/snapshot.mjs';
import { snapshotOf, startedApp } from './support/started-app.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));
// LexLean as WebAssembly is never fetched by these tests; a test that needs it names it with PRISM_LEXLEAN_WASM.
process.env.PRISM_LEXLEAN_FETCH = '0';
process.env.PRISM_KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));

const STARTERS = fileURLToPath(new URL('../templates/starters/', import.meta.url));
// The env a step is given is the whole environment it sees: it names this test's home, never the user's.
const HOME = { PRISM_HOME: process.env.PRISM_HOME };
// The old opt-in to the hosted verifier: it is ignored now.
const HOSTED = { PRISM_CODE_TIER: 'hosted', PRISM_HOME: process.env.PRISM_HOME };
const OFFLINE = { PRISM_CODE_TIER: 'offline', PRISM_HOME: process.env.PRISM_HOME };
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('every starter file is the bytes its index names, and no starter names a spec', () => {
  const all = starters();
  assert.deepEqual(Object.keys(all).sort(), ['decision-app', 'rule-app', 'stateful-app']);
  for (const [name, s] of Object.entries(all)) {
    assert.ok(s.files[`src/${s.module}.lex.tex`], `${name} carries its module`);
    for (const [path, want] of Object.entries(s.files)) {
      const bytes = readFileSync(join(STARTERS, name, path));
      assert.equal(sha(bytes), want, `${name}/${path}`);
      assert.ok(!/prism\/spec|spec\.json/.test(bytes.toString('utf8')), `${name}/${path} names a spec`);
    }
    const onDisk = readdirSync(join(STARTERS, name), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
    assert.equal(onDisk, Object.keys(s.files).length, `${name} holds only what its index names`);
  }
});

test('an app starts from a starter, and Prism never writes over the model after that', () => {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-start-')));
  const made = startApp(dir, 'rule-app');
  assert.equal(made.module, 'App');
  // The model, and the template's foundation modules every app shares.
  assert.deepEqual(sourceFiles(dir), ['src/App.lex.tex', 'src/Foundation/Bytes.lex.tex', 'src/Foundation/View/Text/V1/Model.lex.tex']);
  assert.match(readFileSync(join(dir, 'lexlean.toml'), 'utf8'), /entrypoints = \["src\/App\.lex\.tex"\]/);
  writeFileSync(join(dir, 'src', 'App.lex.tex'), 'the author changed this');
  assert.throws(() => startApp(dir, 'decision-app'), { code: 'start.exists' });
  assert.equal(readFileSync(join(dir, 'src', 'App.lex.tex'), 'utf8'), 'the author changed this');
  assert.throws(() => startApp(appDir(mkdtempSync(join(tmpdir(), 'prism-start-'))), 'no-such'), { code: 'start.starter' });
});

test('planted defect: a starter whose bytes are not the ones its index names is refused, and nothing is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-starters-'));
  cpSync(STARTERS, root, { recursive: true });
  const file = join(root, 'rule-app', 'src', 'App.lex.tex');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-start-')));
  assert.throws(() => startApp(dir, 'rule-app', { root: pathToFileURL(`${root}/`) }), { code: 'start.starter' });
  assert.equal(existsSync(join(dir, 'src')), false);
});

test('offline, with no LexLean as WebAssembly, every step fails with build.frontend-unavailable naming Phase 3, and no snapshot is taken', async () => {
  for (const starter of ['rule-app', 'decision-app']) {
    const { dir, session } = startedApp(starter);
    const lexlean = snapshotOf(ruleAppSnapshot());
    for (const step of [check, prove, build]) {
      const r = await step(dir, session, { env: OFFLINE, snapshot: lexlean.snapshot, wasm: () => false });
      assert.equal(r.ok, false, `${starter} ${step.name}`);
      assert.equal(r.code, 'build.frontend-unavailable', `${starter} ${step.name}`);
      assert.match(r.message, /Phase 3/);
      assert.match(r.message, /PRISM_CODE_TIER=offline fetches nothing/);
    }
    assert.deepEqual(lexlean.asked, [], 'no snapshot was taken');
  }
});

test('PRISM_CODE_TIER=hosted is ignored: with no LexLean as WebAssembly every step is refused, and nothing is fetched or sent', async () => {
  const fetched = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    throw new Error('nothing may be fetched');
  };
  try {
    for (const starter of ['rule-app', 'decision-app']) {
      const { dir, session } = startedApp(starter);
      for (const step of [check, prove, build]) {
        const r = await step(dir, session, { env: HOSTED, wasm: () => false });
        assert.equal(r.ok, false, `${starter} ${step.name}`);
        assert.equal(r.code, 'build.frontend-unavailable', `${starter} ${step.name}`);
        assert.ok(!/hosted/i.test(r.message), r.message);
      }
    }
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(fetched, []);
});

test('with nothing set and no LexLean as WebAssembly here, a rule app is refused, never sent, and an app that needs a holo is refused before anything is sent', { timeout: 120000 }, async () => {
  const rule = startedApp('rule-app');
  const lexlean = snapshotOf(ruleAppSnapshot());
  const r = await prove(rule.dir, rule.session, { env: {}, snapshot: lexlean.snapshot, wasm: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'build.frontend-unavailable');
  assert.deepEqual(lexlean.asked, [], 'no snapshot was taken');
  const other = startedApp('decision-app');
  const none = snapshotOf(ruleAppSnapshot());
  const b = await build(other.dir, other.session, { env: {}, snapshot: none.snapshot, wasm: () => false });
  assert.equal(b.code, 'build.frontend-unavailable');
  assert.match(b.message, /LexLean as WebAssembly is not on this machine/);
  assert.deepEqual(none.asked, [], 'no snapshot was taken');
});

test('a rule app: its table comes from the semantic snapshot of its folder, and Lean\'s kernel here checks every guarantee, PRISM_CODE_TIER=hosted or not', { timeout: 120000 }, async () => {
  for (const env of [HOME, HOSTED]) {
    const { dir, session } = startedApp('rule-app');
    const lexlean = snapshotOf(ruleAppSnapshot());
    const r = await prove(dir, session, { env, snapshot: lexlean.snapshot, wasm: () => true });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.where, 'kernel');
    assert.deepEqual(r.guarantees.map((g) => g.status), ['proved', 'proved', 'proved']);
    assert.equal(r.semanticId, ruleTable(ruleAppSnapshot()).semanticId);
    assert.deepEqual(lexlean.asked, [dir]);
  }
});

test('planted defect: a guarantee the rules break is refused with the request that breaks it, before the kernel is opened', async () => {
  const { dir, session } = startedApp('rule-app');
  const broken = ruleAppSnapshot({ ...PARKING, rules: PARKING.rules.map((r, i) => (i === 1 ? { ...r, answer: 2 } : r)) }, { id: 'broken' });
  const kernel = { judge: () => assert.fail('the kernel was opened'), check: () => assert.fail('the kernel was opened') };
  const r = await prove(dir, session, { env: HOME, snapshot: snapshotOf(broken).snapshot, wasm: () => true, kernel });
  assert.equal(r.ok, false);
  assert.match(r.message, /guarantee 1 \(never premium\) is false: the request `\d+ motorcycle` meets its conditions and the rules answer premium \(rule 2\)/);
});

test('a rule app builds as the verified rule judge and the model\'s numbers, and answers only once built', { timeout: 120000 }, async () => {
  const { dir, session } = startedApp('rule-app');
  const before = await tryRequest(dir, session, '0 car');
  assert.deepEqual([before.ok, before.code], [false, 'try.unbuilt']);
  const r = await build(dir, session, { env: HOME, snapshot: snapshotOf(ruleAppSnapshot()).snapshot, wasm: () => true });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.vectors, { passed: 2, total: 2 });
  assert.equal(r.semanticId, ruleTable(ruleAppSnapshot()).semanticId);
  for (const [request, answer] of [['0 car', 'free'], ['3 car', 'standard'], ['10 truck', 'premium'], ['3 motorcycle', 'free'], ['25 car', 'invalid']]) {
    assert.equal((await tryRequest(dir, session, request)).answer, answer, request);
  }
});

test('publishing to GitHub is refused as unavailable until the claims are written from the snapshot', async () => {
  const { dir, session } = startedApp('decision-app');
  const r = await build(dir, session, { remote: 'github', env: HOME });
  assert.deepEqual([r.ok, r.code], [false, 'build.publish-unavailable']);
});

test('a snapshot that is not a rule app\'s is refused by name, never guessed at', () => {
  const good = ruleAppSnapshot();
  assert.throws(() => ruleTable('{'), { code: 'rule-table.snapshot' });
  assert.throws(() => ruleTable({ ...good, spec: 'lexlean/semantic-snapshot/1' }), { code: 'rule-table.snapshot' });
  assert.throws(() => ruleTable({ ...good, semantic_id: 'x' }), { code: 'rule-table.snapshot' });
  assert.throws(() => ruleTable({ ...good, modules: [] }), { code: 'rule-table.module' });
  const edit = (app) => ruleAppSnapshot({ ...PARKING, ...app });
  assert.throws(() => ruleTable(edit({ rules: [{ conditions: [{ field: 7, op: 4, value: 0 }], answer: 1 }] })), { code: 'rule-table.index' });
  assert.throws(() => ruleTable(edit({ rules: [{ conditions: [{ field: 0, op: 9, value: 0 }], answer: 1 }] })), { code: 'rule-table.index' });
  assert.throws(() => ruleTable(edit({ otherwise: 3 })), { code: 'rule-table.index' });
  assert.throws(() => ruleTable(edit({ fields: [{ name: 'vehicle', least: 0, greatest: 5, values: ['car'] }] })), { code: 'rule-table.range' });
  assert.throws(() => ruleTable(edit({ guarantees: [{ always: 2, conditions: [], answer: 0 }] })), { code: 'rule-table.shape' });
  const lambda = structuredClone(good);
  lambda.modules[0].semantic.declarations[3].body = { kind: 'add', left: { kind: 'nat', value: '0' }, right: { kind: 'nat', value: '0' } };
  assert.throws(() => ruleTable(lambda), { code: 'rule-table.term' });
});

test('the server offers the LexLean path and no other: four tools named as Docker names them, no spec, and what runs without Docker said plainly', async () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['prism_init', 'prism_build', 'prism_run', 'prism_inspect', 'prism_push', 'prism_pull']);
  assert.deepEqual(TOOLS.find((t) => t.name === 'prism_run').inputSchema.required, ['request']);
  assert.ok(!/spec\.json|prism\/spec|prism_spec|prism_answer/.test(JSON.stringify(TOOLS) + INSTRUCTIONS));
  for (const name of ['prism_init', 'prism_build', 'prism_run', 'prism_inspect']) assert.ok(INSTRUCTIONS.includes(name), name);
  assert.match(INSTRUCTIONS, /No step needs Docker, an image or a server\. LexLean runs as WebAssembly/);
  assert.ok(!/hosted/i.test(JSON.stringify(TOOLS) + INSTRUCTIONS));
  assert.match(INSTRUCTIONS, /Never set PRISM_CODE_TIER yourself/);
  const sent = [];
  const server = createServer({ cwd: mkdtempSync(join(tmpdir(), 'prism-mcp-')), send: (m) => sent.push(m) });
  const call = async (name, args = {}) => {
    await server.handle({ jsonrpc: '2.0', id: sent.length + 1, method: 'tools/call', params: { name, arguments: args } });
    return sent.at(-1).result;
  };
  const list = (await call('prism_init')).structuredContent;
  assert.deepEqual(list.starters.map((s) => s.starter), ['rule-app', 'decision-app', 'stateful-app']);
  assert.match(list.next, /call prism_init again/);
  assert.match(list.nextSteps[0], /Phase 3/);
  assert.equal((await call('prism_build')).structuredContent.state, 'blocked');
  assert.match((await call('prism_run')).content[0].text, /prism_run needs `request`/);
  assert.match((await call('prism_init', { spec: {} })).content[0].text, /does not take `spec`/);
  const started = (await call('prism_init', { starter: 'rule-app' })).structuredContent;
  assert.equal(started.model, 'src/App.lex.tex');
  assert.match(started.next, /then call prism_build\.$/);
  const inspected = (await call('prism_inspect')).structuredContent;
  assert.deepEqual([inspected.starter, inspected.files, inspected.audit], ['rule-app', ['src/App.lex.tex', 'src/Foundation/Bytes.lex.tex', 'src/Foundation/View/Text/V1/Model.lex.tex'], null]);
  // The six tools are the only ones: an older name is not answered.
  for (const name of ['prism_start', 'prism_check', 'prism_prove', 'prism_verify', 'prism_try', 'prism_status']) {
    await server.handle({ jsonrpc: '2.0', id: sent.length + 1, method: 'tools/call', params: { name, arguments: {} } });
    assert.match(sent.at(-1).error?.message ?? '', new RegExp(`Unknown tool: ${name}`), name);
  }
  assert.equal((await call('prism_init')).structuredContent.greeting, 'Welcome back.');
});
