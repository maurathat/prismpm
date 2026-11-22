// DK-51: every Prism app starts from one canonical template, UOR-Foundation/template, pinned at one commit with every
// file's SHA-256; prism_init writes it only when every fetched file has its pinned bytes, never over other bytes, and
// aligns the app's LexLean project to the LexLean this prism-code runs. The network is never reached here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restampLock } from '../src/journey/project.mjs';
import { LEXLEAN_COMPILER_SEMANTICS, LEXLEAN_TOOLCHAIN, TEMPLATE, alignToLexlean, instantiate } from '../src/journey/template.mjs';
import { templateFixture } from './support/template-fixture.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'prism-template-'));

test('the package pins the canonical template, UOR-Foundation/template, at one commit with every file by SHA-256', () => {
  assert.equal(TEMPLATE.repository, 'UOR-Foundation/template');
  assert.match(TEMPLATE.commit, /^[0-9a-f]{40}$/);
  const paths = Object.keys(TEMPLATE.files);
  assert.ok(paths.length > 100, 'the whole template, not a part of it');
  for (const must of ['app/lexlean.toml', 'app/lexlean.lock', '.github/workflows/build.yml', '.github/workflows/pages.yml', 'prismpm.lock', 'template-contract.json']) assert.ok(paths.includes(must), must);
  for (const [path, file] of Object.entries(TEMPLATE.files)) assert.match(file.sha256, /^[0-9a-f]{64}$/, path);
  assert.deepEqual(paths, [...paths].sort(), 'paths in order');
});

test('instantiate writes every pinned file, byte for byte, and keeps a file that already has its bytes', async () => {
  const { template, fetch, bytes } = templateFixture();
  const root = fresh();
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app', 'lexlean.toml'), bytes.get('app/lexlean.toml'));
  const made = await instantiate(root, { template, fetch });
  assert.equal(made.kept, 1);
  assert.equal(made.written.length, Object.keys(template.files).length - 1);
  for (const [path, b] of bytes) assert.deepEqual(new Uint8Array(readFileSync(join(root, path))), b, path);
});

test('an altered file or other bytes already there refuse the start, and nothing is written', async () => {
  const altered = templateFixture({ alter: 'README.md' });
  const root = fresh();
  await assert.rejects(instantiate(root, { template: altered.template, fetch: altered.fetch }), (e) => e.code === 'template.altered');
  assert.deepEqual(readdirSync(root), [], 'nothing was written');
  const { template, fetch } = templateFixture();
  writeFileSync(join(root, 'README.md'), '# my own readme\n');
  await assert.rejects(instantiate(root, { template, fetch }), (e) => e.code === 'template.exists' && /README\.md/.test(e.message));
  assert.ok(!existsSync(join(root, 'app')), 'nothing was written');
});

test('the app is aligned to the LexLean this prism-code runs: its toolchain, its compiler identity and the lock digests', async () => {
  const { template, fetch } = templateFixture();
  const root = fresh();
  await instantiate(root, { template, fetch });
  const app = join(root, 'app');
  writeFileSync(join(app, 'lean-toolchain'), 'leanprover/lean4:v4.32.1\n');
  writeFileSync(join(app, 'lexlean.toml'), readFileSync(join(app, 'lexlean.toml'), 'utf8').replace(/lean_toolchain = "[^"]*"/, 'lean_toolchain = "leanprover/lean4:v4.32.1"'));
  const changed = alignToLexlean(app, { restamp: restampLock });
  assert.ok(changed.includes('lean-toolchain') && changed.includes('lexlean.toml'));
  assert.equal(readFileSync(join(app, 'lean-toolchain'), 'utf8'), `${LEXLEAN_TOOLCHAIN}\n`);
  const lock = readFileSync(join(app, 'lexlean.lock'), 'utf8');
  assert.match(lock, new RegExp(`compiler_semantics = "${LEXLEAN_COMPILER_SEMANTICS}"`));
  assert.deepEqual(alignToLexlean(app, { restamp: restampLock }), [], 'an aligned app is left as it is');
});
