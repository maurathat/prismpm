// A build reads static files from GitHub and nothing else, and a proof found in a public store is copied only when
// its bytes re-derive and is judged by the kernel like any other (docs/proposals/canonical-serverless-build.md, Phase 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleTable, tableWords } from '../src/journey/rule-table.mjs';
import { ruleAppSnapshot } from './support/snapshot.mjs';
import { buildFetch, networkLedger, optedIn, refusal } from '../src/journey/hosts.mjs';
import { kappaStore } from '../src/journey/kappa-store.mjs';
import { kernelProve, openKernel } from '../src/journey/kernel-prove.mjs';
import { ensureKernel } from '../src/journey/kernel-store.mjs';
import { publicStore, pullProofs } from '../src/journey/proof-store.mjs';

const KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));
process.env.PRISM_KERNEL_DIR = KERNEL_DIR;
const home = () => ({ PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-boundary-')), PRISM_KERNEL_DIR: KERNEL_DIR });
const spec = () => tableWords(ruleTable(ruleAppSnapshot()));
const files = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name)) : []);

test('the boundary admits GitHub\'s static hosts and the user\'s Pages site, and nothing else', () => {
  for (const url of ['https://raw.githubusercontent.com/a/b/c/d', 'https://github.com/a/b', 'https://someone.github.io/app/app.holo']) assert.equal(refusal(url), null, url);
  assert.equal(refusal('http://raw.githubusercontent.com/a'), 'not HTTPS');
  assert.equal(refusal('https://raw.githubusercontent.com:8443/a'), 'names a port');
  assert.equal(refusal('https://u:p@github.com/a'), 'carries credentials');
  assert.equal(refusal('https://example.com/a'), 'not an allowed host');
  assert.equal(refusal('https://github.com.example.com/a'), 'not an allowed host');
  // Prism is serverless: a server that computes is refused like any other host, whatever the user sets or opts in to.
  assert.equal(refusal('https://verifier.example.org/'), 'not an allowed host');
  assert.equal(refusal('https://verifier.example.org/', { optIn: ['verifier.example.org'] }), 'not an allowed host');
  for (const tier of [undefined, 'hosted', 'offline']) assert.deepEqual(optedIn({ PRISM_CODE_TIER: tier }), []);
});

test('planted defect B1: a build that reaches a non-allowed host is refused before anything is sent', async () => {
  let sent = 0;
  const fetch = async () => (sent++, new Response('x'));
  const guarded = buildFetch({ fetch, ledger: networkLedger() });
  await assert.rejects(guarded('https://example.com/telemetry'), (e) => e.name === 'PrismCodeError' && e.code === 'build.host-not-allowed' && e.url === 'https://example.com/telemetry');
  await assert.rejects(guarded('https://verifier.example.org/'), { code: 'build.host-not-allowed' });
  assert.equal(sent, 0);
  // The pinned kernel is read through the same boundary, with no fallback.
  const env = { PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-boundary-k-')), PRISM_CODE_BUNDLED: '0' };
  let asked = null;
  const spy = async (url) => ((asked = url), new Response('no', { status: 404 }));
  await assert.rejects(ensureKernel({ env, fetch: spy }), { code: 'kernel.unavailable' });
  assert.match(asked, /^https:\/\/raw\.githubusercontent\.com\//);
});

test('planted defect B2: a redirect from an allowed host to one outside the boundary is refused before it is followed', async () => {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    if (String(url).startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: 'https://example.com/elsewhere' } });
    return new Response('x');
  };
  const guarded = buildFetch({ fetch, ledger: networkLedger() });
  await assert.rejects(guarded('https://github.com/a/b/releases/download/t/f'), (e) => e.code === 'build.host-not-allowed' && e.url === 'https://example.com/elsewhere');
  assert.deepEqual(asked, ['https://github.com/a/b/releases/download/t/f']);
  // A redirect inside the boundary is followed, and its bytes are counted against where they came from.
  const ledger = networkLedger();
  const inside = buildFetch({ fetch: async (url) => (String(url).includes('github.com/') ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' } }) : new Response(new Uint8Array(7))), ledger });
  await (await inside('https://github.com/a/b/releases/download/t/f')).arrayBuffer();
  assert.deepEqual(ledger.report(), [{ host: 'release-assets.githubusercontent.com', requests: 1, bytes: 7 }]);
});

test('the ledger reports each host asked and the bytes received', async () => {
  const ledger = networkLedger();
  const guarded = buildFetch({ fetch: async () => new Response(new Uint8Array(1000)), ledger });
  await (await guarded('https://raw.githubusercontent.com/a')).arrayBuffer();
  await (await guarded('https://raw.githubusercontent.com/b')).text();
  await (await guarded('https://me.github.io/x')).arrayBuffer();
  assert.deepEqual(ledger.report(), [{ host: 'me.github.io', requests: 1, bytes: 1000 }, { host: 'raw.githubusercontent.com', requests: 2, bytes: 2000 }]);
  assert.equal(ledger.bytes(), 3000);
});

/** A public store served from a local store's directory, as GitHub would serve a repository at a commit. */
function served(directory, { tamper = null } = {}) {
  const base = 'https://raw.githubusercontent.com/someone/proofs/0123456789abcdef0123456789abcdef01234567/';
  const fetch = async (url) => {
    const file = join(directory, ...url.slice(base.length).split('/'));
    if (!existsSync(file)) return new Response('', { status: 404 });
    let bytes = readFileSync(file);
    if (tamper && tamper(url)) bytes = Buffer.concat([bytes, Buffer.from('\n')]);
    return new Response(bytes);
  };
  return { base, fetch };
}

test('a term from the public store saves producing it, and the kernel still judges it', { timeout: 120000 }, async () => {
  const producer = home();
  const first = await kernelProve(spec(), { env: producer });
  assert.deepEqual(first.judged.map((j) => j.status), ['proved', 'proved', 'proved']);
  // Another machine, with an empty store, names the first machine's store as its public store.
  const { base, fetch } = served(kappaStore({ env: producer }).directory);
  const consumer = { ...home(), PRISM_PROOF_STORE: base };
  const real = await openKernel();
  let checked = 0;
  const kernel = { addresses: real.addresses, judge: () => assert.fail('a term was produced although the store held it'), check: (t) => (checked++, real.check(t)) };
  const second = await kernelProve(spec(), { env: consumer, fetch, kernel });
  assert.deepEqual([second.pulled, second.reused, checked], [3, 3, 3]);
  assert.deepEqual(second.judged.map((j) => j.status), ['proved', 'proved', 'proved']);
});

test('planted defects S1 and S2: store bytes that do not re-derive are not copied, and a refused term is never proved', { timeout: 120000 }, async () => {
  const producer = home();
  await kernelProve(spec(), { env: producer });
  const directory = kappaStore({ env: producer }).directory;
  // S1: every term the store serves has one byte more than its name says.
  const terms = new Set(files(join(directory, 'bytes')).filter((f) => readFileSync(f, 'utf8').includes('Prism')).map((f) => relative(directory, f).split('\\').join('/')));
  assert.equal(terms.size, 3);
  const { base, fetch } = served(directory, { tamper: (url) => [...terms].some((t) => url.endsWith(t)) });
  const local = kappaStore({ env: home() });
  const keys = files(join(directory, 'derived')).map((f) => `sha256:${relative(join(directory, 'derived'), f).split(/[\\/]/).join('')}`);
  assert.equal(await pullProofs(local, publicStore({ base, fetch }), keys), 0);
  // S2: a store that lies about which label a key led to (a record for another statement) gives nothing proved
  // without the kernel: the record names its own key and statement, so it is not reused, and the term is produced.
  const lying = served(directory);
  const consumer = { ...home(), PRISM_PROOF_STORE: lying.base };
  const swapped = async (url) => {
    const m = /derived\/(..)\/(.+)$/.exec(url);
    if (!m) return lying.fetch(url);
    const others = keys.filter((k) => k !== `sha256:${m[1]}${m[2]}`);
    return lying.fetch(url.replace(/derived\/.+$/, `derived/${others[0].slice(7, 9)}/${others[0].slice(9)}`));
  };
  const r = await kernelProve(spec(), { env: consumer, fetch: swapped });
  assert.equal(r.reused, 0);
  assert.deepEqual(r.judged.map((j) => j.status), ['proved', 'proved', 'proved']);
});

test('planted defect S3: a public store outside the boundary is refused before it is asked', async () => {
  let sent = 0;
  const store = publicStore({ base: 'https://proofs.example.com/', fetch: async () => (sent++, new Response('')) });
  await assert.rejects(store.bound(`sha256:${'0'.repeat(64)}`), { code: 'build.host-not-allowed' });
  assert.equal(sent, 0);
});
