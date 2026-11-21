// The read-only client for kappa-registry's blob endpoint (ide/edit/kappa-registry.mjs) and the reading of a model's
// archive (readModelTar in ide/edit/model-tar.mjs), against a server on this machine that answers at the registry's
// own address shape. It is a stand-in: kappa-registry itself is not run here.
// Usage: node ide/tools/kappa-registry-test.mjs
//
// Both modules import prism-code as the published page lays it out (./prism-code/blake3.mjs), so this test loads
// them through a loader hook that points that one address at src/blake3.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { kappa } from '../../src/blake3.mjs';
import { modelFiles } from '../../src/journey/model-files.mjs';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === './prism-code/blake3.mjs') return next(new URL('../../src/blake3.mjs', context.parentURL).href, context);
  return next(specifier, context);
}`));
const { RegistryError, blobAddress, fetchBlob } = await import('../edit/kappa-registry.mjs');
const { modelTar, readModelTar } = await import('../edit/model-tar.mjs');

// ---- The archive, written and read back. ----
const gate = modelFiles(new URL('../../model/ide-capability-gate', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { skip: ['tools'] });
const files = Object.fromEntries([...gate.files].map(([path, body]) => [path, new TextDecoder().decode(body)]));
const archive = modelTar(files);
const back = readModelTar(archive.bytes);
assert.equal(back.folder, 'model');
assert.equal(back.entry, gate.entry);
assert.deepEqual(back.files, files);
// Read back and written again, it is the same bytes: the label names the model, not one writing of it.
assert.equal(modelTar(back.files).label, archive.label);

// Planted defects: archives a model's archive never is. Each is refused whole.
const altered = (change) => { const copy = archive.bytes.slice(); change(copy); return copy; };
assert.throws(() => readModelTar(archive.bytes.subarray(0, archive.bytes.length - 1)), /whole blocks/);
assert.throws(() => readModelTar(altered((b) => { b[0] ^= 1; })), /does not add up/);
assert.throws(() => readModelTar(new Uint8Array(1024)), /empty/);
assert.throws(() => readModelTar(modelTar({ 'notes.txt': 'x' }).bytes), /not a LexLean project/);
assert.throws(() => readModelTar(archive.bytes, { limit: 1024 }), /more than the 1024/);
// A header rewritten to leave the folder, with its checksum made right again, is still refused.
const escaping = altered((b) => {
  b.fill(0, 0, 100);
  b.set(new TextEncoder().encode('model/../../evil'), 0);
  b.fill(0x20, 148, 156);
  let sum = 0; for (let i = 0; i < 512; i++) sum += b[i];
  b.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
});
assert.throws(() => readModelTar(escaping), /is not a path inside a model's folder/);
// A link, or any entry that is not a plain file.
const link = altered((b) => { b[156] = 0x32; b.fill(0x20, 148, 156); let sum = 0; for (let i = 0; i < 512; i++) sum += b[i]; b.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148); });
assert.throws(() => readModelTar(link), /something other than plain files/);

// ---- The address. ----
const LABEL = archive.label;
assert.equal(blobAddress('https://registry.example', 'acme/models', LABEL), `https://registry.example/v2/acme/models/blobs/${LABEL}`);
assert.equal(blobAddress('https://registry.example/base/', 'acme', LABEL), `https://registry.example/base/v2/acme/blobs/${LABEL}`);
assert.equal(blobAddress('http://localhost:5000', 'example', LABEL), `http://localhost:5000/v2/example/blobs/${LABEL}`);
for (const [registry, namespace, label, why] of [
  ['http://registry.example', 'acme', LABEL, /by https, or by http on this machine/],
  ['ftp://registry.example', 'acme', LABEL, /by https/],
  ['https://user:secret@registry.example', 'acme', LABEL, /must not carry a name or a password/],
  ['not an address', 'acme', LABEL, /is not an address/],
  ['https://registry.example', '../etc', LABEL, /is not a registry namespace/],
  ['https://registry.example', 'Acme', LABEL, /is not a registry namespace/],
  ['https://registry.example', 'acme', 'sha256:' + LABEL.slice(7), /is not a BLAKE3 label/],
  ['https://registry.example', 'acme', LABEL.toUpperCase(), /is not a BLAKE3 label/],
  ['https://registry.example', 'acme', LABEL + '/../x', /is not a BLAKE3 label/],
]) assert.throws(() => blobAddress(registry, namespace, label), (error) => error instanceof RegistryError && error.code === 'address' && why.test(error.message), `${registry} ${namespace}`);

// ---- A registry on this machine, at the registry's own address shape. ----
const blobs = new Map([[LABEL, archive.bytes]]);
const lying = kappa(new TextEncoder().encode('asked for, never stored'));
const seen = [];
const server = createServer((request, response) => {
  seen.push({ url: request.url, cookie: request.headers.cookie ?? null, authorization: request.headers.authorization ?? null });
  const origin = request.headers.origin;
  const cors = origin ? { 'access-control-allow-origin': origin } : {};
  const m = /^\/v2\/(.+)\/blobs\/(blake3:[0-9a-f]{64})$/.exec(request.url);
  if (!m || m[1] !== 'acme/models') { response.writeHead(404, cors).end('{"errors":[{"code":"BLOB_UNKNOWN"}]}'); return; }
  if (m[2] === lying) { response.writeHead(200, { ...cors, 'docker-content-digest': lying, 'x-kappa-axis': 'blake3' }).end(Buffer.from(archive.bytes)); return; }
  if (m[2] === 'blake3:' + 'f'.repeat(64)) { response.writeHead(500, cors).end('broken'); return; }
  const body = blobs.get(m[2]);
  if (!body) { response.writeHead(404, cors).end('{"errors":[{"code":"BLOB_UNKNOWN"}]}'); return; }
  response.writeHead(200, { ...cors, 'content-type': 'application/octet-stream', 'docker-content-digest': m[2], 'x-kappa-axis': 'blake3', 'content-length': body.length }).end(Buffer.from(body));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const registry = `http://127.0.0.1:${server.address().port}`;
try {
  // A blob stored under its BLAKE3 label is fetched, and is the bytes its label names.
  const got = await fetchBlob(registry, 'acme/models', LABEL);
  assert.equal(kappa(got.bytes), LABEL);
  assert.equal(got.address, `${registry}/v2/acme/models/blobs/${LABEL}`);
  assert.deepEqual(readModelTar(got.bytes).files, files);
  // The request carried nothing but the address.
  assert.deepEqual(seen.at(-1), { url: `/v2/acme/models/blobs/${LABEL}`, cookie: null, authorization: null });

  // Planted defect: the registry answers with other bytes under the label asked for, and says in its own header
  // that they are that label. Its word is not taken.
  await assert.rejects(fetchBlob(registry, 'acme/models', lying), (error) => error.code === 'other-bytes' && error.got === LABEL && /not the blake3:[0-9a-f]{64} asked for\. Nothing was opened\.$/.test(error.message));
  await assert.rejects(fetchBlob(registry, 'acme/models', 'blake3:' + '0'.repeat(64)), (error) => error.code === 'absent');
  await assert.rejects(fetchBlob(registry, 'other', LABEL), (error) => error.code === 'absent');
  await assert.rejects(fetchBlob(registry, 'acme/models', 'blake3:' + 'f'.repeat(64)), (error) => error.code === 'answer' && error.status === 500);
  await assert.rejects(fetchBlob(registry, 'acme/models', LABEL, { limit: 1024 }), (error) => error.code === 'answer' && /more than the 1024/.test(error.message));
} finally {
  await new Promise((ok) => server.close(ok));
}
// A registry that is not there.
await assert.rejects(fetchBlob(registry, 'acme/models', LABEL), (error) => error.code === 'unreachable');

console.log(`kappa-registry: a blob is taken only as the bytes its BLAKE3 label names; the gate model's archive, ${archive.bytes.length} bytes, reads back whole`);
