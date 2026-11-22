// The canonical path: an app's one source of truth is its LexLean model, started from a content-addressed starter
// and written by the agent. There is no spec file, and the skill teaches this path with the CLI alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LexLean as WebAssembly is never fetched by these tests; a test that needs it names it with PRISM_LEXLEAN_WASM.
process.env.PRISM_LEXLEAN_FETCH = '0';
const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const skill = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-canonical-'));
const run = (args, { cwd = scratch(), env = {} } = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 120000, cwd, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

test('the skill teaches the one path, with the CLI alone, and says what runs where', () => {
  assert.match(skill, /Every Prism app starts with one command:\n\n```bash\nnpx prism-code@latest init <app-name>\n```/);
  for (const verb of ['manifest', 'check', 'build', 'verify', 'generate']) assert.match(skill, new RegExp('npx prism-code ' + verb + ' '), verb);
  assert.match(skill, /with `npx prism-code` as the only dependency/);
  assert.match(skill, /Nothing about a model leaves the machine/);
  assert.match(skill, /a first run needs no network/);
  // No server tool, no hosted verifier, and none of the routes that competed with the model.
  assert.doesNotMatch(skill, /prism_[a-z]+|hosted|--remote/);
  assert.doesNotMatch(skill, /spec\.json|prism\/spec\//);
});

test('a scaffolded LexLean project says a Prism app is one too, started from a starter', () => {
  const r = run(['init', join(scratch(), 'proj'), '--template', 'text-request']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /A Prism app is a LexLean project too/);
  assert.doesNotMatch(r.out, /spec\.json/);
});

test('check takes no --spec: there is no spec to hold a holo to', () => {
  const dir = scratch();
  const policy = join(dir, 'p0.json');
  writeFileSync(policy, '{"minimum":"P0"}');
  const holo = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
  const asked = run(['check', holo, '--policy', policy, '--spec', join(dir, 'spec.json')]);
  assert.equal(asked.code, 64, asked.err || asked.out);
  const plain = run(['check', holo, '--policy', policy]);
  assert.equal(plain.code, 0, plain.err);
  assert.doesNotMatch(plain.out, /^spec /m);
});
