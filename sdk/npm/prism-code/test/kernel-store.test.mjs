// Lean's kernel is not in the package: it is fetched once, by the address of its bytes, and kept (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_COMMIT, KERNEL_FILES, KernelMissing, ensureKernel, hasKernel, kernelFile, readKernelFile } from '../src/journey/kernel-store.mjs';
import { kappa } from '../src/blake3.mjs';
import { gunzipSync } from 'node:zlib';

const real = (name) => readFileSync(new URL(`./fixtures/kernel/${name}`, import.meta.url));
// A machine that holds nothing: an empty store, and the package's own copies set aside, so every file must be fetched.
const home = () => ({ PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-kernel-store-')), PRISM_CODE_BUNDLED: '0' });
/** A stand-in for the network that keeps every URL it is asked for. */
function network(answer = (name) => ({ ok: true, status: 200, bytes: real(name) })) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, init });
    const reply = answer(url.split('/').pop());
    if (reply.error) throw Object.assign(new Error('fetch failed'), { cause: { code: reply.error } });
    return { ok: reply.ok, status: reply.status, arrayBuffer: async () => reply.bytes.buffer.slice(reply.bytes.byteOffset, reply.bytes.byteOffset + reply.bytes.byteLength) };
  };
  return { asked, fetch };
}

test('the fixtures beside the tests are the pinned bytes, and the package ships them only by label, under wasm/pinned', () => {
  // Each is named by the label of its decoded bytes, and kept as served.
  for (const [name, want] of Object.entries(KERNEL_FILES)) assert.deepEqual([real(name).length, kappa(want.encoding === 'gzip' ? gunzipSync(real(name)) : real(name))], [want.encodedBytes ?? want.bytes, want.kappa], name);
  // The manifest names the loader, the module and the library by the same labels, and so does its record that this
  // kernel judged this library whole: a reader admits the three by BLAKE3 with nothing else to trust.
  const manifest = JSON.parse(readFileSync(new URL('../src/journey/kernel/manifest.json', import.meta.url), 'utf8'));
  for (const [part, bound] of [['glue', 'loaderKappa'], ['wasm', 'kernelKappa'], ['library', 'libraryKappa']]) {
    const label = kappa(gunzipSync(real(manifest[part].file)));
    assert.deepEqual([manifest[part].kappa, manifest.binding[bound], KERNEL_FILES[manifest[part].file].kappa], [label, label, label], part);
  }
  assert.equal(hasKernel({ env: { PRISM_KERNEL_DIR: fileURLToPath(new URL('./fixtures/kernel/', import.meta.url)) } }), true);
  assert.deepEqual(readdirSync(new URL('../src/journey/kernel/', import.meta.url)).sort(), ['NOTICE.md', 'manifest.json']);
  const shipped = JSON.parse(readFileSync(new URL('./fixtures/package-files.json', import.meta.url), 'utf8'));
  assert.ok(!shipped.some((p) => /\.(gz|holo)$/.test(p) && p.includes('kernel')));
});

test('the first use fetches four public files by commit, sends nothing else, and keeps them', async () => {
  const env = home();
  const { asked, fetch } = network();
  const lines = [];
  assert.equal(hasKernel({ env }), false);
  assert.throws(() => readKernelFile('kernel.holo', { env }), KernelMissing);
  assert.deepEqual(await ensureKernel({ env, fetch, log: (l) => lines.push(l) }), Object.keys(KERNEL_FILES));
  assert.equal(hasKernel({ env }), true);
  // Kept once per machine in the pinned store, by the BLAKE3 label of each file's bytes.
  for (const [name, want] of Object.entries(KERNEL_FILES)) assert.equal(kernelFile(name, env), join(env.PRISM_HOME, 'kappa', 'pinned', want.kappa.slice(7, 9), want.kappa.slice(9)));
  assert.equal(asked.length, 4);
  for (const { url, init } of asked) {
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/UOR-Foundation/foundry/${KERNEL_COMMIT}/studio/shell/kernel/`), url);
    assert.ok(Object.values(KERNEL_FILES).some((f) => url.endsWith(`/${f.path}`)), url);
    // A plain GET: no body, no header, no query, so nothing of the user's or the app's can ride on it. The one option
    // is the boundary's own: it follows redirects itself, so every hop is checked (hosts.mjs, planted defect B2).
    assert.deepEqual(init, { redirect: 'manual' });
    assert.ok(!url.includes('?'));
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Fetching Lean's kernel once .* checked against its BLAKE3 digest\. Nothing about the app is sent\.$/);
  // The second use asks the network for nothing.
  const again = network();
  assert.deepEqual(await ensureKernel({ env, fetch: again.fetch }), []);
  assert.equal(again.asked.length, 0);
});

test('planted defects S1 to S4: bytes that are not the pinned ones are never kept or used', async () => {
  // S1: the network answers other bytes.
  const env = home();
  const wrong = network((name) => ({ ok: true, status: 200, bytes: name === 'kernel.holo' ? real('lean-kernel.mjs.gz') : real(name) }));
  await assert.rejects(ensureKernel({ env, fetch: wrong.fetch }), (e) => e instanceof KernelMissing && e.code === 'kernel.unavailable' && /decodes to blake3:[0-9a-f]{64}, not the pinned blake3:9a264023/.test(e.message));
  assert.equal(existsSync(kernelFile('kernel.holo', env)), false);
  assert.equal(hasKernel({ env }), false);
  // S2: the network is down, or answers an error. Neither is a verdict on any app.
  await assert.rejects(ensureKernel({ env: home(), fetch: network(() => ({ error: 'ENOTFOUND' })).fetch }), /did not answer: ENOTFOUND/);
  await assert.rejects(ensureKernel({ env: home(), fetch: network(() => ({ ok: false, status: 404, bytes: Buffer.alloc(0) })).fetch }), /answered HTTP 404/);
  // S3: a kept file is altered on disk: it is refused, then fetched again.
  const kept = home();
  await ensureKernel({ env: kept, fetch: network().fetch });
  const file = kernelFile('library.ndjson.gz', kept);
  // A byte inside the compressed data: it no longer decodes, or decodes to other bytes. (Bytes after the gzip member
  // are ignored by decoding, and are no defect: a file is admitted by what it decodes to.)
  const altered = readFileSync(file);
  altered[Math.floor(altered.length / 2)] ^= 0xff;
  writeFileSync(file, altered);
  assert.throws(() => readKernelFile('library.ndjson.gz', { env: kept }), /is not the pinned library\.ndjson\.gz/);
  const repair = network();
  assert.deepEqual(await ensureKernel({ env: kept, fetch: repair.fetch }), ['library.ndjson.gz']);
  assert.equal(hasKernel({ env: kept }), true);
  // S4: a name that is not pinned is not read at all.
  assert.throws(() => readKernelFile('../config.json', { env: kept }), /is not a pinned kernel file/);
});

test('the package ships every file it pins, so a machine that holds nothing fetches nothing', async () => {
  const env = { PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-kernel-bundled-')) };
  const { asked, fetch } = network();
  assert.equal(hasKernel({ env }), true);
  assert.deepEqual(await ensureKernel({ env, fetch }), []);
  assert.deepEqual(asked, []);
  // The store was not written: the bytes are read from the package, each admitted by its label.
  for (const name of Object.keys(KERNEL_FILES)) assert.equal(existsSync(kernelFile(name, env)), false, name);
  // With the package's copies set aside, the same machine has no kernel.
  assert.equal(hasKernel({ env: { ...env, PRISM_CODE_BUNDLED: '0' } }), false);
});
