// Where the LexLean project is found for check, build and verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexleanProjectDir } from '../src/tiers.mjs';

const template = fileURLToPath(new URL('../templates/text-request', import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-tiers-'));

test('the LexLean project is the root, or found between the model sources and the root', () => {
  assert.equal(lexleanProjectDir(template, 'src'), '.');
  const nested = scratch();
  mkdirSync(join(nested, 'app', 'src'), { recursive: true });
  writeFileSync(join(nested, 'app', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  assert.equal(lexleanProjectDir(nested, 'app/src'), 'app');
  assert.equal(lexleanProjectDir(nested, 'app'), 'app');
  assert.equal(lexleanProjectDir(nested), 'app', 'with no [model] source, the one project directly under the root');
  assert.throws(() => lexleanProjectDir(scratch()), (e) => e.code === 'tier.project' && /no lexlean\.toml/.test(e.message));
  assert.throws(() => lexleanProjectDir(nested, 'elsewhere/src'), (e) => e.code === 'tier.project');
  assert.throws(() => lexleanProjectDir(nested, '../outside'), (e) => e.code === 'tier.project', 'a source outside the root is never searched');
});

test('a template instance: no prism.toml, the one LexLean project directly under the root; two need --project', () => {
  const instance = scratch();
  mkdirSync(join(instance, 'app'));
  writeFileSync(join(instance, 'app', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  mkdirSync(join(instance, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(instance, 'node_modules', 'x', 'lexlean.toml'), '');
  assert.equal(lexleanProjectDir(instance), 'app', 'node_modules is never a project');
  mkdirSync(join(instance, 'gateway'));
  writeFileSync(join(instance, 'gateway', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  assert.throws(() => lexleanProjectDir(instance), (e) => e.code === 'tier.project' && /2 LexLean projects here \(app, gateway\); name one with --project/.test(e.message));
  assert.equal(lexleanProjectDir(instance, null, 'gateway'), 'gateway');
  assert.throws(() => lexleanProjectDir(instance, null, 'missing'), (e) => e.code === 'tier.project');
  assert.throws(() => lexleanProjectDir(instance, null, '..'), (e) => e.code === 'tier.project' && /outside/.test(e.message));
});
