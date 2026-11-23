// The hints that make one pass enough: where a name LexLean quotes is written, and the names in scope nearest to it.
// And the lock a new app starts with, which must be current for LexLean as WebAssembly, which cannot rewrite it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUILTIN, declaredNames, distance, hintFor, hints, nearest } from '../src/journey/hints.mjs';
import { startApp } from '../src/journey/project.mjs';

const MODEL = `\\begin{lexlean}{Gate}
\\useglossary{lexlean.std.bool@1.2.0}
\\title{Boolean}
\\begin{semanticmodule}
structure{
  name: Skill,
  type_parameters: [],
  parameters: [],
  fields: [
    {name: network, type: Nat},
    {name: secrets, type: Nat}
  ]
}

definition{
  name: quiet,
  parameters: [s : Skill],
  result: Boolean,
  body: ((project s netwrk) =? 0)
}
\\end{semanticmodule}
\\end{lexlean}
`;
const app = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-hints-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'Gate.lex.tex'), MODEL);
  return dir;
};

test('names in scope: the model\'s own declarations and fields, and the built-in types', () => {
  const names = declaredNames([{ text: MODEL }]);
  for (const n of ['Gate', 'Skill', 'network', 'secrets', 'quiet']) assert.ok(names.has(n), n);
  assert.ok(BUILTIN.includes('Bool') && BUILTIN.includes('Nat'));
});

test('the nearest names: an edit or two away, or one begins the other; none for a name in scope', () => {
  const scope = new Set([...BUILTIN, 'network', 'secrets', 'Skill']);
  assert.deepEqual(nearest('netwrk', scope), ['network']);
  assert.deepEqual(nearest('Boolean', scope), ['Bool']);
  assert.deepEqual(nearest('Natural', scope), ['Nat']);
  assert.deepEqual(nearest('Skill::netwrk', scope), ['network']);
  assert.deepEqual(nearest('network', scope), []);
  // A namespace is where a name was looked for, never a replacement for it.
  assert.deepEqual(nearest('Bool.not_eq_true', scope), []);
  assert.deepEqual(nearest('zzzzzz', scope), []);
  assert.equal(distance('kitten', 'sitting'), 3);
});

test('a misspelled type: the line where it is written, not where the phase began, and the type to write', () => {
  const dir = app();
  const [h] = hints([{ code: 'LLT4001', message: 'phase link: forward or missing type `Boolean`', span: { file: 'src/Gate.lex.tex', line: 4 } }], dir);
  assert.equal(h.name, 'Boolean');
  assert.equal(h.at, 'src/Gate.lex.tex:18');
  assert.equal(h.line, 'result: Boolean,');
  assert.deepEqual(h.didYouMean, ['Bool']);
});

test('a misspelled field: the name not in scope is the one hinted, though the record named first is', () => {
  const dir = app();
  const [h] = hints([{ code: 'LLT4001', message: 'phase link: record `Skill` has no field `netwrk`', span: { file: 'src/Gate.lex.tex', line: 4 } }], dir);
  assert.equal(h.name, 'netwrk');
  assert.equal(h.at, 'src/Gate.lex.tex:19');
  assert.deepEqual(h.didYouMean, ['network']);
});

test('a diagnostic that quotes nothing gets no hint, and a hint never replaces what LexLean said', () => {
  const diagnostic = { code: 'LLP2001', message: 'phase link: semantic notation: expected an operator', span: { file: 'src/Gate.lex.tex', line: 19 } };
  assert.deepEqual(hintFor(diagnostic, [{ path: 'src/Gate.lex.tex', text: MODEL }], new Set(BUILTIN)), {});
});

test('a new app\'s lock records the SHA-256 of the files the starter renamed, as lexlean lock writes it', () => {
  for (const starter of ['rule-app', 'decision-app', 'stateful-app']) {
    const dir = mkdtempSync(join(tmpdir(), 'prism-start-'));
    startApp(dir, starter);
    const lock = readFileSync(join(dir, 'lexlean.lock'), 'utf8');
    const sha = (file) => createHash('sha256').update(readFileSync(join(dir, file))).digest('hex');
    assert.match(lock, new RegExp(`^project_config_sha256 = "${sha('lexlean.toml')}"$`, 'm'), `${starter}: lexlean.toml`);
    for (const [, file, hash] of lock.matchAll(/\[\[workspace_file\]\]\npath = "([^"]+)"\nsha256 = "([0-9a-f]{64})"/g)) assert.equal(hash, sha(file), `${starter}: ${file}`);
  }
});
