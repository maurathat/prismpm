// Installing an extension by its content label (ide/tools/install-extension.mjs), against a registry on this machine
// that answers at Open VSX's address shape. Open VSX itself is not reached here.
// Usage: node ide/tools/install-extension-test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { InstallError, admitPackage, installExtension, pinOf, unpackPackage, versionAddress } from './install-extension.mjs';

const enc = new TextEncoder();
/** A zip archive of `entries` (`[name, bytes, { stored?, mode?, flags? }]`), as a .vsix is one. */
function zip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, body, how = {}] of entries) {
    const packed = how.stored ? body : new Uint8Array(deflateRawSync(body));
    const n = enc.encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, how.flags ?? 0, true); head.setUint16(8, how.stored ? 0 : 8, true);
    head.setUint32(14, how.crc ?? crc32(body), true); head.setUint32(18, packed.length, true); head.setUint32(22, body.length, true); head.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 0x0314, true); dir.setUint16(6, 20, true); dir.setUint16(8, how.flags ?? 0, true); dir.setUint16(10, how.stored ? 0 : 8, true);
    dir.setUint32(16, how.crc ?? crc32(body), true); dir.setUint32(20, packed.length, true); dir.setUint32(24, body.length, true); dir.setUint16(28, n.length, true);
    dir.setUint32(38, (how.mode ?? 0o100644) << 16, true); dir.setUint32(42, at, true);
    locals.push(new Uint8Array(head.buffer), n, packed);
    central.push(new Uint8Array(dir.buffer), n);
    at += 30 + n.length + packed.length;
  }
  const dirSize = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, dirSize, true); end.setUint32(16, at, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const manifest = enc.encode(JSON.stringify({ name: 'sample', publisher: 'acme', version: '1.2.3', browser: './dist/web.js' }));
const good = zip([
  ['extension.vsixmanifest', enc.encode('<x/>')],
  ['[Content_Types].xml', enc.encode('<x/>')],
  ['extension/package.json', manifest],
  ['extension/dist/web.js', enc.encode('export function activate() {}\n'.repeat(40))],
  ['extension/README.md', enc.encode('notes\n'), { stored: true }],
  ['extension/media/', new Uint8Array(0), { stored: true }],
]);
const PIN = pinOf({ id: 'acme.sample', version: '1.2.3' }, good);

// ---- The archive. ----
const files = unpackPackage(good);
assert.deepEqual([...files.keys()], ['README.md', 'dist/web.js', 'package.json']);
assert.deepEqual(files.get('package.json'), manifest);
// Planted defects: packages a package never is. Each is refused whole.
const refused = (entries, why) => assert.throws(() => unpackPackage(zip(entries)), (e) => e instanceof InstallError && e.code === 'package' && why.test(e.message), String(why));
const base = ['extension/package.json', manifest];
refused([base, ['extension/../../evil.js', enc.encode('x')]], /is not a path inside the extension/);
refused([base, ['extension/C:/evil.js', enc.encode('x')]], /is not a path inside the extension/);
refused([base, ['extension/a\\b.js', enc.encode('x')]], /is not a path inside the extension/);
refused([base, ['extension/link', enc.encode('/etc/passwd'), { mode: 0o120777 }]], /is not a plain file/);
refused([base, ['extension/x.js', enc.encode('x'), { flags: 1 }]], /is encrypted/);
refused([base, ['extension/x.js', enc.encode('x'), { crc: 7 }]], /is not the bytes its checksum names/);
refused([base, ['extension/x.js', enc.encode('x')], ['extension/x.js', enc.encode('y')]], /is in it twice/);
refused([['extension/x.js', enc.encode('x')]], /has no extension\/package\.json/);
assert.throws(() => unpackPackage(enc.encode('not a zip archive, only some text that is long enough')), (e) => e.code === 'package');

// ---- The pin. ----
assert.match(PIN.kappa, /^blake3:[0-9a-f]{64}$/);
assert.equal(admitPackage(PIN, good), good);
const changed = good.slice(); changed[40] ^= 1;
assert.throws(() => admitPackage(PIN, changed), (e) => e.code === 'other-bytes' && /Nothing was installed\.$/.test(e.message));
// The SHA-256 is a checked field: a pin whose two names disagree admits nothing.
assert.throws(() => admitPackage({ ...PIN, sha256: '0'.repeat(64) }, good), (e) => e.code === 'other-bytes');
assert.throws(() => admitPackage({ ...PIN, kappa: 'sha256:' + PIN.sha256 }, good), (e) => e.code === 'pin');
for (const [id, version, why] of [['nodot', '1.0.0', /is not an extension id/], ['../x.y', '1.0.0', /is not an extension id/], ['acme.sample', '../1', /is not a version/], ['acme.sample', '', /is not a version/]]) {
  assert.throws(() => versionAddress('https://open-vsx.org', id, version), (e) => e.code === 'pin' && why.test(e.message));
}
assert.throws(() => versionAddress('http://registry.example', 'acme.sample', '1.2.3'), /must be reached by https/);
assert.equal(versionAddress('https://open-vsx.org', 'acme.sample', '1.2.3'), 'https://open-vsx.org/api/acme/sample/1.2.3');

// ---- A registry on this machine. ----
let serve = good;
const server = createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (request.url === '/api/acme/sample/1.2.3') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '1.2.3', files: { download: `${origin}/vsix/acme.sample-1.2.3.vsix` } })); return; }
  if (request.url === '/vsix/acme.sample-1.2.3.vsix') { response.writeHead(200, { 'content-length': serve.length }).end(Buffer.from(serve)); return; }
  response.writeHead(404).end('{}');
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const registry = `http://127.0.0.1:${server.address().port}`;
const out = mkdtempSync(join(tmpdir(), 'prism-ext-'));
try {
  const done = await installExtension(PIN, { out, registry });
  assert.deepEqual(done, { id: 'acme.sample', version: '1.2.3', kappa: PIN.kappa, files: 3 });
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'acme.sample', 'files.json'), 'utf8')), ['README.md', 'dist/web.js', 'package.json']);
  assert.deepEqual(new Uint8Array(readFileSync(join(out, 'acme.sample', 'package.json'))), manifest);

  // Planted defect: the registry serves another package under the pinned version. Nothing is written.
  const other = mkdtempSync(join(tmpdir(), 'prism-ext-'));
  serve = zip([base, ['extension/dist/web.js', enc.encode('export function activate() { /* not the reviewed code */ }\n')]]);
  await assert.rejects(installExtension(PIN, { out: other, registry }), (e) => e.code === 'other-bytes');
  assert.deepEqual(readdirSync(other), []);
  // And what was installed before is left as it was.
  assert.ok(existsSync(join(out, 'acme.sample', 'dist', 'web.js')));
  // A version the registry does not have, and a registry that is not there.
  await assert.rejects(installExtension({ ...PIN, version: '9.9.9' }, { out: other, registry }), (e) => e.code === 'answer');
  assert.deepEqual(readdirSync(other), []);
} finally {
  await new Promise((ok) => server.close(ok));
}
await assert.rejects(installExtension(PIN, { out, registry }), (e) => e.code === 'unreachable');

console.log(`install-extension: a package is installed only as the bytes its BLAKE3 label names; a changed package, a path that leaves the folder, a link and a broken checksum are refused`);
