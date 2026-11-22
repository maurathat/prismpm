// DK-51: every Prism app starts from one canonical template, UOR-Foundation/template, which this package carries and
// admits by BLAKE3 label, and a template/2 workspace is held to contract 2 by check: R3 by named theorems, R5 by
// registered refusals, and the universal policy by template.lock. Nothing here reaches the network or the kernel; the
// kernel's part is the standalone journeys (standalone.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../src/blake3.mjs';
import { canonicalTemplate, writeTemplate } from '../src/journey/template.mjs';
import { runInit } from '../src/init-cli.mjs';
import { checkContract, checkRefusals, checkTheorems, conformanceDocument } from '../src/contract.mjs';

const BUNDLE = fileURLToPath(new URL('../templates/canonical/', import.meta.url));
const fresh = () => mkdtempSync(join(tmpdir(), 'prism-template-'));
const sink = () => {
  const chunks = [];
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join('') };
};
const written = () => {
  const dir = fresh();
  writeTemplate(dir);
  return dir;
};
const edit = (dir, path, fn) => writeFileSync(join(dir, path), fn(readFileSync(join(dir, path), 'utf8')));
const codes = (r) => r.diagnostics.map((d) => d.code);

test('the package carries the canonical template, every file by its BLAKE3 label, and the template by the label of its index', () => {
  const t = canonicalTemplate();
  assert.equal(t.repository, 'UOR-Foundation/template');
  assert.match(t.commit, /^[0-9a-f]{40}$/);
  assert.equal(t.label, kappa(new TextEncoder().encode(JSON.stringify(t.files))));
  for (const must of ['app/lexlean.toml', 'app/src/Contract.lex.tex', 'model/ids.toml', 'features/suites/contract.feature', 'AGENTS.md', 'VERIFICATION.md', 'template-contract.json', 'template.lock', 'CONFORMANCE.md']) assert.ok(Object.hasOwn(t.files, must), must);
  for (const gone of ['prismpm.lock', '.devcontainer/devcontainer.json', '.github/workflows/bootstrap.yml', 'Cargo.toml', 'Justfile']) assert.ok(!Object.hasOwn(t.files, gone), `${gone} is not in the standalone frame`);
  for (const [path, label] of Object.entries(t.files)) assert.equal(kappa(new Uint8Array(readFileSync(join(BUNDLE, 'objects', label.slice('blake3:'.length))))), label, path);
});

test('writeTemplate writes every file byte for byte, keeps a file that has its bytes, and refuses other bytes before writing anything', () => {
  const t = canonicalTemplate();
  const dir = fresh();
  writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(BUNDLE, 'objects', t.files['AGENTS.md'].slice(7))));
  const made = writeTemplate(dir);
  assert.deepEqual([made.kept, made.written.length, made.label], [['AGENTS.md'], Object.keys(t.files).length - 1, t.label]);
  for (const [path, label] of Object.entries(t.files)) assert.equal(kappa(new Uint8Array(readFileSync(join(dir, ...path.split('/'))))), label, path);
  const other = fresh();
  writeFileSync(join(other, 'README.md'), '# my own readme\n');
  assert.throws(() => writeTemplate(other), (e) => e.code === 'template.exists' && /README\.md/.test(e.message));
  assert.deepEqual(readdirSync(other), ['README.md'], 'nothing was written');
  assert.equal(writeTemplate(other, { force: true }).written.includes('README.md'), true);
});

test('a bundle whose bytes are altered writes nothing', () => {
  const bundle = fresh();
  cpSync(BUNDLE, bundle, { recursive: true });
  const t = canonicalTemplate();
  writeFileSync(join(bundle, 'objects', t.files['AGENTS.md'].slice(7)), 'altered\n');
  const dir = fresh();
  assert.throws(() => writeTemplate(dir, { bundle }), (e) => e.code === 'template.altered' && /AGENTS\.md/.test(e.message));
  assert.deepEqual(readdirSync(dir), [], 'nothing was written');
  edit(bundle, 'index.json', (s) => s.replace('"AGENTS.md"', '"AGENTS2.md"'));
  assert.throws(() => canonicalTemplate({ bundle }), (e) => e.code === 'template.altered');
});

test('init writes the canonical template with no choice of another, names the app, and refuses --template', async () => {
  const dir = join(fresh(), 'my-app');
  const out = sink();
  assert.equal(await runInit([dir, '--no-skill'], { out, err: sink() }), 0);
  assert.match(out.text(), /the canonical template/);
  assert.match(readFileSync(join(dir, 'prism.toml'), 'utf8'), /^name = "my-app"$/m);
  assert.match(readFileSync(join(dir, 'prism.toml'), 'utf8'), /^source = "app\/src"$/m);
  assert.ok(existsSync(join(dir, 'app', 'src', 'Contract.lex.tex')));
  const err = sink();
  assert.equal(await runInit([fresh(), '--template', 'rule-app'], { out: sink(), err }), 64);
  assert.match(err.text(), /no longer takes --template/);
  const again = sink();
  assert.equal(await runInit([dir, '--no-skill'], { out: again, err: sink() }), 0, 'a folder that holds a model keeps it');
  assert.match(again.text(), /left as it is/);
});

test('the template keeps contract 2 as it is written, and its CONFORMANCE.md is its register\'s generation', () => {
  const dir = written();
  const r = checkContract(dir);
  assert.deepEqual([r.applies, r.summary.spec, r.summary.idsRegistered, r.summary.contractViolations], [true, 'template/2', 2, 0], JSON.stringify(r.diagnostics));
  assert.equal(readFileSync(join(dir, 'CONFORMANCE.md'), 'utf8'), conformanceDocument(dir));
});

test('contract 2 refuses each planted defect of R1, R2, R3, R5 and the universal policy with its own code', () => {
  const planted = [
    ['contract.conformance', (d) => edit(d, 'CONFORMANCE.md', (s) => `${s}\nAn edit by hand.\n`)],
    ['contract.level', (d) => edit(d, 'model/ids.toml', (s) => s.replace('id = "TC-01"\nlevel = "build"', 'id = "TC-01"\nlevel = "built"'))],
    ['contract.untested', (d) => edit(d, 'model/ids.toml', (s) => s.replace('theorems = ["Contract.conformant_decides"]\n', ''))],
    ['contract.unregistered', (d) => edit(d, 'features/suites/contract.feature', (s) => s.replace('@TC-02 @build @rejects', '@TC-09 @build @rejects'))],
    ['contract.rejects-scenario', (d) => edit(d, 'features/suites/contract.feature', (s) => s.replace('@TC-02 @build @rejects', '@TC-02 @build'))],
    ['contract.negative', (d) => edit(d, 'model/ids.toml', (s) => s.replace('negative = "TC-02"', 'negative = "TC-09"'))],
    ['contract.policy-drift', (d) => edit(d, 'AGENTS.md', (s) => `${s}\nAn edit.\n`)],
    ['contract.spec', (d) => edit(d, 'model/ids.toml', (s) => s.replace('spec = "template/2"', 'spec = "template/3"'))],
  ];
  for (const [code, apply] of planted) {
    const dir = written();
    apply(dir);
    const r = checkContract(dir);
    assert.ok(codes(r).includes(code), `${code}: ${JSON.stringify(codes(r))}`);
    assert.equal(r.summary.contractViolations, r.diagnostics.length);
  }
});

test('R3: a named theorem the model does not state, or the kernel did not prove, is refused', () => {
  const dir = written();
  const proved = (status = 'proved') => new Map([['Contract.conformant_decides', { theorem: 'conformant_decides', status }], ['Contract.accepts_exactly_a_request', { theorem: 'accepts_exactly_a_request', status: 'proved' }]]);
  assert.deepEqual(codes(checkTheorems(dir, proved())), []);
  assert.deepEqual(codes(checkTheorems(dir, proved('not proved: no proof found'))), ['contract.theorem-unproved']);
  const unstated = proved();
  unstated.delete('Contract.accepts_exactly_a_request');
  assert.deepEqual(codes(checkTheorems(dir, unstated)), ['contract.theorem-unstated']);
  assert.deepEqual(codes(checkTheorems(dir, new Map([['conformant_decides', { status: 'proved' }]]))).length, 2, 'a short name is not a qualified one');
});

test('R5: a registered failure needs a vector whose response is exactly its refusal', () => {
  const dir = written();
  const bytes = (s) => new TextEncoder().encode(s);
  assert.deepEqual(codes(checkRefusals(dir, [{ request: bytes(''), response: bytes('invalid request') }])), []);
  assert.deepEqual(codes(checkRefusals(dir, [{ request: bytes(''), response: bytes('invalid request.') }, { request: bytes('x'), response: bytes('conformant') }])), ['contract.refusal-unreplayed']);
  assert.deepEqual(codes(checkRefusals(dir, [])), ['contract.refusal-unreplayed']);
});

test('a template/1 register keeps contract 1: a test named for each ID, and nothing of contract 2 is asked', () => {
  const dir = written();
  edit(dir, 'model/ids.toml', (s) => s.replace('spec = "template/2"', 'spec = "template/1"'));
  const r = checkContract(dir);
  assert.ok(codes(r).includes('contract.untested'), 'no test is named for TC-01 or TC-02');
  for (const code of ['contract.policy-drift', 'contract.rejects-scenario', 'contract.negative']) assert.ok(!codes(r).includes(code), code);
  assert.deepEqual(codes(checkTheorems(dir, new Map())), [], 'checkTheorems asks nothing of contract 1');
});
