// The template contract's ratchet (src/contract.mjs): what `check` refuses in a workspace that keeps the template's
// registers. Each rule has a planted defect here that only it refuses, and the repository this package lives in, which
// keeps the same registers and passes its own gate, must pass this one whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, checkContract, contractRoot, lexiconEntries, parseRegister, scenarios, testNameOf } from '../src/contract.mjs';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** A workspace with the files given, as `{ path: text }`. */
function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), 'prism-contract-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const id = (name, level = 'build') => `[[id]]\nid = "${name}"\nsuite = "app"\nlevel = "${level}"\nstatement = "${name} holds."\n`;
const scenario = (name, level = 'build') => `  @${name} @${level}\n  Scenario: ${name} holds.\n    Given a request\n`;

/** A workspace that keeps the contract: two IDs, each with a scenario, a test and a row of the conformance document. */
const clean = () => ({
  'model/ids.toml': `spec = "template/1"\n\n${id('TC-01')}\n${id('TC-02', 'open')}`,
  'model/authorities.toml': 'spec = "template/1"\n\n[[authority]]\nid = "RFC-8259"\nname = "JSON"\nrealized_by = ["TC-01"]\n',
  'model/ledger.toml': 'spec = "template/1"\n\n[[claim]]\nid = "AUTH-JSON"\nlevel = "some-true"\nstatement = "JSON is as RFC 8259 says."\nauthority = "RFC-8259"\n',
  'features/suites/app.feature': `Feature: app\n\n${scenario('TC-01')}\n${scenario('TC-02', 'open')}`,
  'tests/app.rs': '#[test]\nfn decides_tc_01() {}\n#[test]\nfn measures_tc_02() {}\n',
  'CONFORMANCE.md': '| `TC-01` | build |\n| `TC-02` | open |\n',
});
const codes = (root) => checkContract(root).diagnostics.map((d) => `${d.code} ${d.id ?? ''}`.trim()).sort();

test('a workspace that keeps the contract passes, and its summary counts what was read', () => {
  const result = checkContract(workspace(clean()));
  assert.equal(result.applies, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual([result.summary.idsRegistered, result.summary.scenarios, result.summary.authorities, result.summary.claims, result.summary.contractViolations], [2, 2, 1, 1, 0]);
});

test('a folder with no model/ids.toml is not a template workspace, and nothing runs', () => {
  const root = workspace({ 'src/App.lex.tex': 'x' });
  assert.deepEqual(checkContract(root), { applies: false, summary: {}, diagnostics: [] });
  assert.equal(contractRoot(root, join(root, 'src')), null);
  const kept = workspace(clean());
  assert.equal(contractRoot(join(kept, 'app'), kept), kept, 'the model may live in a folder under the workspace');
});

test('R3: an ID with no scenario, a scenario with no ID, and an ID with no test are each refused by name', () => {
  const files = clean();
  assert.deepEqual(codes(workspace({ ...files, 'features/suites/app.feature': `Feature: app\n\n${scenario('TC-01')}` })), ['contract.unspecified TC-02']);
  assert.deepEqual(codes(workspace({ ...files, 'features/suites/app.feature': `${files['features/suites/app.feature']}\n${scenario('TC-09')}` })), ['contract.unregistered TC-09']);
  assert.deepEqual(codes(workspace({ ...files, 'tests/app.rs': '#[test]\nfn decides_tc_01() {}\n' })), ['contract.untested TC-02']);
  // A test is named for an ID only by the whole name: tc_010 is not a test of TC-01.
  assert.deepEqual(codes(workspace({ ...files, 'tests/app.rs': 'fn x_tc_010() {}\nfn measures_tc_02() {}\n' })), ['contract.untested TC-01']);
});

test('R2: a level that is not one of the three, a scenario of another level, and a duplicate are refused', () => {
  const files = clean();
  assert.deepEqual(LEVELS, ['some-true', 'build', 'open']);
  assert.deepEqual(codes(workspace({ ...files, 'model/ids.toml': `${id('TC-01', 'proved')}\n${id('TC-02', 'open')}` })), ['contract.level TC-01']);
  assert.deepEqual(codes(workspace({ ...files, 'features/suites/app.feature': `Feature: app\n\n${scenario('TC-01', 'open')}\n${scenario('TC-02', 'open')}` })), ['contract.level TC-01']);
  assert.deepEqual(codes(workspace({ ...files, 'model/ids.toml': `${id('TC-01')}\n${id('TC-01')}\n${id('TC-02', 'open')}` })), ['contract.duplicate TC-01']);
  assert.deepEqual(codes(workspace({ ...files, 'model/ledger.toml': '[[claim]]\nid = "TC-01"\nlevel = "open"\nstatement = "s"\n' })), ['contract.duplicate TC-01']);
});

test('R2: a some-true claim cites an authority the workspace names, and an authority is realized only by registered IDs', () => {
  const files = clean();
  assert.deepEqual(codes(workspace({ ...files, 'model/authorities.toml': 'authority = []\n' })), ['contract.authority AUTH-JSON']);
  assert.deepEqual(codes(workspace({ ...files, 'model/authorities.toml': '[[authority]]\nid = "RFC-8259"\nrealized_by = [\n  "TC-01",\n  "TC-77",\n]\n' })), ['contract.authority TC-77']);
});

test('R1: the generated conformance document lists every registered ID', () => {
  assert.deepEqual(codes(workspace({ ...clean(), 'CONFORMANCE.md': '| `TC-01` | build |\n' })), ['contract.conformance TC-02']);
});

test('a register that is not readable is refused, with the line', () => {
  const result = checkContract(workspace({ ...clean(), 'model/ledger.toml': 'this is not toml\n' }));
  assert.equal(result.diagnostics[0].code, 'contract.register');
  assert.match(result.diagnostics[0].message, /model\/ledger\.toml cannot be read: line 1/);
});

test('the register reader takes arrays of tables, arrays over several lines, comments and an empty array', () => {
  const read = parseRegister('# a register\nspec = "template/1"\nclaim = []\n\n[[id]]\nid = "A-1" # the first\nrealized_by = [\n  "X-1",\n  "X-2",\n]\ncount = 3\n\n[[id]]\nid = "A-2"\n');
  assert.deepEqual(read, { spec: 'template/1', id: [{ id: 'A-1', realized_by: ['X-1', 'X-2'], count: 3 }, { id: 'A-2' }] });
  assert.equal(testNameOf('FA-59'), 'fa_59');
  assert.equal(testNameOf('AUTH-LEAN-REL-4-32-2'), 'auth_lean_rel_4_32_2');
});

test('scenarios are read with their tags, and a Feature\'s own tags are not a scenario\'s', () => {
  const root = workspace({ 'features/suites/a.feature': '@wip\nFeature: a\n\n  @TC-01 @build\n  # a note\n  Scenario: one\n\n  @TC-02\n  @open\n  Scenario Outline: two\n' });
  assert.deepEqual(scenarios(root).map((s) => [s.line, s.ids, s.levels]), [[4, ['TC-01'], ['build']], [8, ['TC-02'], ['open']]]);
});

test('lexicon entries are counted from language/<lexicon>/entries', () => {
  const root = workspace({ 'language/prism.arch/entries/a.toml': '', 'language/prism.arch/entries/b.toml': '', 'language/prism.arch/lexicon.toml': '', 'language/prism.sec/entries/c.toml': '' });
  assert.equal(lexiconEntries(root), 3);
  assert.equal(lexiconEntries(workspace({})), 0);
});

test('this repository keeps the same registers and passes its own gate, so it passes this one whole', { skip: !existsSync(join(REPO, 'model', 'ids.toml')) && 'not inside the repository' }, () => {
  const result = checkContract(REPO);
  assert.deepEqual(result.diagnostics.map((d) => `${d.code} ${d.id}`), []);
  assert.ok(result.summary.idsRegistered > 200 && result.summary.scenarios >= result.summary.idsRegistered);
});
