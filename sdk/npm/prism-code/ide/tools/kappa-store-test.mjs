// The site's store by label (tools/build-kappa-store.mjs): an earlier build keeps resolving by its label after the
// next is published. Usage: node ide/tools/kappa-store-test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { kappa } from '../../src/blake3.mjs';
import { ideLabel, offlineListing } from './build-offline-site.mjs';
import { STORE, buildKappaStore, readerOf } from './build-kappa-store.mjs';

const root = mkdtempSync(join(tmpdir(), 'kappa-store-'));
const hex = (label) => label.slice(7);

/** A site folder with these files, its listing and its label written as build-offline-site.mjs writes them. */
function site(name, files, commit) {
  const out = join(root, name);
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), text); }
  const bytes = new TextEncoder().encode(JSON.stringify(offlineListing(out, commit)) + '\n');
  writeFileSync(join(out, 'offline.json'), bytes);
  writeFileSync(join(out, 'ide.json'), JSON.stringify(ideLabel(bytes, commit)) + '\n');
  return out;
}
/** Open a build by its label from a published folder, as a loader does: the listing, then each file, all by label. */
function openByLabel(out, label) {
  const listingBytes = new Uint8Array(readFileSync(join(out, STORE, hex(label))));
  assert.equal(kappa(listingBytes), label, 'the listing is the bytes its label names');
  const listing = JSON.parse(new TextDecoder().decode(listingBytes));
  const opened = {};
  for (const [path, entry] of Object.entries(listing.files)) {
    const bytes = new Uint8Array(readFileSync(join(out, STORE, hex(entry.kappa))));
    assert.equal(kappa(bytes), entry.kappa, `${path} is the bytes its label names`);
    opened[path] = new TextDecoder().decode(bytes);
  }
  return { commit: listing.commit, files: opened };
}

const common = { 'edit/ide/index.html': '<p>ide</p>', 'edit/pin.json': '{"pin":1}' };

// The first build: no site is published yet, so there is no history, and that is not a failure.
const first = site('one', { ...common, 'edit/ide/assets/model.js': 'console.log(1)' }, 'c1');
const made1 = await buildKappaStore(first, { read: readerOf(join(root, 'nothing-published')) });
assert.equal(made1.builds, 1);
assert.equal(JSON.parse(readFileSync(join(first, 'ide.json'), 'utf8')).store, 'kappa/');
assert.equal(JSON.parse(readFileSync(join(first, 'ide.json'), 'utf8')).kappa, made1.label);
assert.equal(openByLabel(first, made1.label).files['edit/ide/assets/model.js'], 'console.log(1)');

// The second build changes one file. Published over the first, it still answers for the first by its label.
const second = site('two', { ...common, 'edit/ide/assets/model.js': 'console.log(2)' }, 'c2');
const made2 = await buildKappaStore(second, { read: readerOf(first) });
assert.notEqual(made2.label, made1.label);
assert.equal(made2.builds, 2);
assert.equal(made2.carried, 1, 'only the file the two builds do not share is carried');
assert.equal(openByLabel(second, made2.label).files['edit/ide/assets/model.js'], 'console.log(2)');
const old = openByLabel(second, made1.label);
assert.equal(old.commit, 'c1');
assert.equal(old.files['edit/ide/assets/model.js'], 'console.log(1)', 'the earlier build opens by its label, as it was');
assert.equal(old.files['edit/pin.json'], '{"pin":1}', 'a file both builds have is kept once and serves both');
assert.deepEqual(JSON.parse(readFileSync(join(second, STORE, 'index.json'), 'utf8')).builds.map((b) => b.label), [made2.label, made1.label]);
// By path the site holds only the new build: this is what stopped an earlier label resolving.
assert.equal(readFileSync(join(second, 'edit/ide/assets/model.js'), 'utf8'), 'console.log(2)');

// Only so many builds are kept by count; one named to be kept stays however old.
const third = site('three', { ...common, 'edit/ide/assets/model.js': 'console.log(3)' }, 'c3');
const made3 = await buildKappaStore(third, { read: readerOf(second), keep: 2 });
assert.deepEqual(JSON.parse(readFileSync(join(third, STORE, 'index.json'), 'utf8')).builds.map((b) => b.commit), ['c3', 'c2']);
assert.throws(() => openByLabel(third, made1.label), 'a build past the count is gone');
const thirdPinned = site('three-pinned', { ...common, 'edit/ide/assets/model.js': 'console.log(3)' }, 'c3');
await buildKappaStore(thirdPinned, { read: readerOf(second), keep: 2, pinned: [made1.label] });
assert.equal(openByLabel(thirdPinned, made1.label).commit, 'c1', 'a named build is kept beyond the count');
assert.equal(made3.label, JSON.parse(readFileSync(join(thirdPinned, 'ide.json'), 'utf8')).kappa);

// History is not dropped quietly: a published site that lists a build and has lost a file of it stops the build,
// and so does one that answers a label with other bytes, and a label named to be kept that is not there.
const broken = site('broken', { ...common, 'edit/ide/assets/model.js': 'console.log(2)' }, 'c2');
await buildKappaStore(broken, { read: readerOf(first) });
rmSync(join(broken, STORE, hex(kappa(new TextEncoder().encode('console.log(1)')))));
await assert.rejects(() => buildKappaStore(site('four', { ...common, 'edit/ide/assets/model.js': 'console.log(4)' }, 'c4'), { read: readerOf(broken) }), /does not hold/);
const altered = site('altered', { ...common, 'edit/ide/assets/model.js': 'console.log(2)' }, 'c2');
await buildKappaStore(altered, { read: readerOf(first) });
writeFileSync(join(altered, STORE, hex(kappa(new TextEncoder().encode('console.log(1)')))), 'console.log("other")');
await assert.rejects(() => buildKappaStore(site('five', { ...common, 'edit/ide/assets/model.js': 'console.log(5)' }, 'c5'), { read: readerOf(altered) }), /bytes offered for/);
await assert.rejects(() => buildKappaStore(site('six', { ...common, 'edit/ide/assets/model.js': 'console.log(6)' }, 'c6'), { read: readerOf(second), pinned: ['blake3:' + '0'.repeat(64)] }), /does not keep/);
// A site that cannot be read at all is a failure, not an empty history.
await assert.rejects(() => buildKappaStore(site('seven', { ...common, 'edit/ide/assets/model.js': 'console.log(7)' }, 'c7'), { read: async () => { throw new Error('the site answered HTTP 503'); } }), /503/);

rmSync(root, { recursive: true, force: true });
console.log('kappa-store: an earlier build opens by its label after the next is published; shared files are kept once; a named build outlives the count; lost or altered history stops the build');
