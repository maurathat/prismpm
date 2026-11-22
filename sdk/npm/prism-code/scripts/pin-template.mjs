#!/usr/bin/env node
/**
 * Bundle the canonical template, UOR-Foundation/template, into this package: templates/canonical/index.json names
 * every file of a template checkout by its path and the BLAKE3 label of its bytes, and templates/canonical/objects/
 * holds each distinct file once, named by that label. `init` writes a new app from exactly these bytes
 * (src/journey/template.mjs), so starting an app reads nothing from the network.
 *
 *   node scripts/pin-template.mjs <template checkout>           write the bundle from the checkout's committed tree
 *   node scripts/pin-template.mjs <template checkout> --check   exit 1 when the bundle is not that tree's
 *
 * Only files git tracks at HEAD are bundled, read from the commit, so build output and an unclean working tree never
 * enter it; the index records the commit they were read from.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../src/blake3.mjs';

const [checkout, flag] = process.argv.slice(2);
if (!checkout) {
  console.error('usage: node scripts/pin-template.mjs <template checkout> [--check]');
  process.exit(2);
}
const OUT = fileURLToPath(new URL('../templates/canonical/', import.meta.url));
const git = (...args) => {
  const r = spawnSync('git', ['-C', checkout, ...args], { encoding: 'buffer', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout;
};
const commit = git('rev-parse', 'HEAD').toString().trim();
const paths = git('ls-tree', '-r', '--name-only', '-z', 'HEAD').toString().split('\0').filter(Boolean).sort();
const files = {};
const objects = new Map();
for (const path of paths) {
  const bytes = new Uint8Array(git('show', `HEAD:${path}`));
  const label = kappa(bytes);
  files[path] = label;
  objects.set(label, bytes);
}
// The template's own label: of its index of paths and labels, as canonical JSON.
const label = kappa(new TextEncoder().encode(JSON.stringify(files)));
const index = { schema: 'prism/template-bundle/1', repository: 'UOR-Foundation/template', commit, label, files };
const text = `${JSON.stringify(index, null, 2)}\n`;
const objectName = (l) => l.replace(/^blake3:/, '');

if (flag === '--check') {
  const same = existsSync(join(OUT, 'index.json')) && readFileSync(join(OUT, 'index.json'), 'utf8') === text
    && [...objects].every(([l, b]) => existsSync(join(OUT, 'objects', objectName(l))) && Buffer.compare(readFileSync(join(OUT, 'objects', objectName(l))), Buffer.from(b)) === 0)
    && readdirSync(join(OUT, 'objects')).length === objects.size;
  console.log(same ? `template bundle ok: ${paths.length} files, ${label}, from ${commit}` : 'templates/canonical is not the bundle of that checkout');
  process.exit(same ? 0 : 1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'objects'), { recursive: true });
for (const [l, b] of objects) writeFileSync(join(OUT, 'objects', objectName(l)), b);
writeFileSync(join(OUT, 'index.json'), text);
const bytes = [...objects.values()].reduce((n, b) => n + b.length, 0);
console.log(`bundled ${paths.length} files (${objects.size} objects, ${bytes} bytes) of ${index.repository} at ${commit}: ${label}`);
