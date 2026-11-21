// The site's service worker (ide/offline/sw-body.js as build-offline-site.mjs writes it), run here against a network
// and a store held in memory. Usage: node ide/tools/offline-test.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { kappa } from '../../src/blake3.mjs';
import { workerSource } from './build-offline-site.mjs';

const enc = new TextEncoder();
const ROOT = 'https://site.example/prismpm/';
const text = (response) => response.text();

/** A worker started on a site whose files are `site` ({ path: text }), with `listed` as its listing's files. */
function start(site, listed = site) {
  const listing = { schema: 'prism-ide/offline-site/1', commit: 'c1', files: Object.fromEntries(Object.entries(listed).map(([path, body]) => [path, { kappa: kappa(enc.encode(body)), bytes: enc.encode(body).length }])) };
  const world = { site: { ...site }, listing, online: true, asked: [], cache: new Map(), handlers: {} };
  const store = {
    async match(key) { const kept = world.cache.get(String(key.url ?? key)); return kept ? new Response(kept.bytes.slice(), { headers: kept.headers }) : undefined; },
    async put(key, response) { world.cache.set(String(key), { bytes: new Uint8Array(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) }); },
    async delete(key) { return world.cache.delete(String(key.url ?? key)); },
    async keys() { return [...world.cache.keys()].map((url) => ({ url })); },
  };
  const fetchFake = async (request) => {
    const url = new URL(typeof request === 'string' ? request : request.url);
    world.asked.push(url.href);
    if (!world.online) throw new TypeError('Failed to fetch');
    const path = decodeURIComponent(url.pathname.slice(new URL(ROOT).pathname.length));
    if (path === 'offline.json') return new Response(JSON.stringify(world.listing), { headers: { 'content-type': 'application/json' } });
    const at = path === '' || path.endsWith('/') ? path + 'index.html' : path;
    if (!(at in world.site)) return new Response('not found', { status: 404 });
    return new Response(world.site[at], { headers: { 'content-type': at.endsWith('.html') ? 'text/html' : 'text/plain' } });
  };
  const self = {
    location: { href: ROOT + 'sw.js' },
    addEventListener: (type, handler) => { world.handlers[type] = handler; },
    skipWaiting() {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(workerSource(), { self, caches: { open: async () => store }, fetch: fetchFake, Response, URL, TextEncoder, TextDecoder, Uint8Array, Uint32Array, AbortController, setTimeout, clearTimeout, JSON, Set, Object, Array, decodeURIComponent, console });
  world.get = (path, { navigate = false } = {}) => new Promise((resolve, reject) => {
    let answered = false;
    world.handlers.fetch({ request: { url: ROOT + path, method: 'GET', mode: navigate ? 'navigate' : 'cors' }, respondWith: (promise) => { answered = true; promise.then(resolve, reject); } });
    if (!answered) reject(new Error('the worker did not answer'));
  });
  return world;
}

const site = { 'edit/index.html': '<p>edit</p>', 'edit/edit.mjs': 'export const a = 1;', 'audit/index.html': '<p>audit</p>', 'index.html': '<p>root</p>' };

// A listed file is fetched, checked and kept; the next time it comes from the store and the network is not asked.
{
  const w = start(site);
  const first = await w.get('edit/', { navigate: true });
  assert.equal(await text(first), '<p>edit</p>');
  assert.equal(first.headers.get('x-prism-kappa'), 'fetched');
  assert.equal(first.headers.get('content-type'), 'text/html');
  w.asked.length = 0;
  const second = await w.get('edit/index.html');
  assert.equal(second.headers.get('x-prism-kappa'), 'kept');
  assert.equal(await text(second), '<p>edit</p>');
  assert.deepEqual(w.asked, [], 'a kept file asks the network for nothing');
  // An address with a query is the same file.
  assert.equal(await text(await w.get('edit/?project=https%3A%2F%2Fapp.example%2Fmodel%2F')), '<p>edit</p>');
}

// With the network off, everything that was fetched once still opens, and a page load does not fail on the listing.
{
  const w = start(site);
  for (const path of ['edit/', 'edit/edit.mjs', 'audit/', '']) await w.get(path, { navigate: path.endsWith('/') || path === '' });
  w.online = false;
  for (const [path, body] of [['edit/', '<p>edit</p>'], ['edit/edit.mjs', 'export const a = 1;'], ['audit/', '<p>audit</p>'], ['', '<p>root</p>']]) {
    const response = await w.get(path, { navigate: true });
    assert.equal(response.status, 200, path);
    assert.equal(await text(response), body);
  }
  // A file never fetched cannot be made up: the page is told it is not kept.
  const w2 = start(site);
  await w2.get('edit/', { navigate: true });
  w2.online = false;
  const absent = await w2.get('audit/index.html');
  assert.equal(absent.status, 504);
  assert.equal(absent.headers.get('x-prism-kappa'), 'absent');
}

// Planted defect: the site serves bytes the listing does not name. They are refused, not served and not kept.
{
  const w = start({ ...site, 'edit/edit.mjs': 'export const a = 2; // altered' }, site);
  const response = await w.get('edit/edit.mjs');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('x-prism-kappa'), 'refused');
  assert.match(await text(response), /^edit\/edit\.mjs: the bytes received are blake3:[0-9a-f]{64}, not the blake3:[0-9a-f]{64} this site's listing names\. Nothing was served\.\n$/);
  assert.ok(![...w.cache.keys()].some((key) => key.includes(kappa(enc.encode('export const a = 2; // altered')).slice(7))));
  // It was asked for twice: once plainly, once past any cache in between.
  assert.equal(w.asked.filter((url) => url.startsWith(ROOT + 'edit/edit.mjs')).length, 2);
  // The other files are still served.
  assert.equal((await w.get('edit/index.html')).status, 200);
}

// Planted defect: a kept file altered in the store by one byte is not served from it. Online it is fetched again;
// offline the page is told it is not there.
{
  const w = start(site);
  await w.get('edit/edit.mjs');
  const key = [...w.cache.keys()].find((k) => k.endsWith(kappa(enc.encode(site['edit/edit.mjs'])).slice(7)));
  w.cache.get(key).bytes[0] ^= 1;
  const again = await w.get('edit/edit.mjs');
  assert.equal(again.headers.get('x-prism-kappa'), 'fetched');
  assert.equal(await text(again), site['edit/edit.mjs']);
  w.cache.get(key).bytes[0] ^= 1;
  w.online = false;
  const gone = await w.get('edit/edit.mjs');
  assert.equal(gone.status, 504);
  assert.ok(!w.cache.has(key), 'the altered entry is removed');
}

// A new deployment: the next page load takes the new listing, serves the new file, and drops what nothing names.
{
  const w = start(site);
  await w.get('edit/', { navigate: true });
  await w.get('edit/edit.mjs');
  const old = ROOT + '__kappa__/' + kappa(enc.encode(site['edit/edit.mjs'])).slice(7);
  assert.ok(w.cache.has(old));
  const next = start({ ...site, 'edit/edit.mjs': 'export const a = 3;' });
  w.site = next.site;
  w.listing = { ...next.listing, commit: 'c2' };
  assert.equal(await text(await w.get('edit/', { navigate: true })), '<p>edit</p>');
  assert.equal(await text(await w.get('edit/edit.mjs')), 'export const a = 3;');
  assert.ok(!w.cache.has(old), 'a file no listing names is dropped');
}

// A new deployment between page loads: a file asked for under the old listing is not refused for being new. The
// newest listing is taken, and the file is checked against that.
{
  const w = start(site);
  await w.get('edit/', { navigate: true });
  const next = start({ ...site, 'edit/edit.mjs': 'export const a = 4;' });
  w.site = next.site;
  w.listing = { ...next.listing, commit: 'c3' };
  const response = await w.get('edit/edit.mjs');
  assert.equal(response.status, 200);
  assert.equal(await text(response), 'export const a = 4;');
  // But bytes that the newest listing does not name either are still refused.
  w.site = { ...w.site, 'edit/index.html': '<p>altered</p>' };
  w.cache.clear();
  assert.equal((await w.get('edit/index.html')).status, 502);
}

// What the listing does not name goes to the network untouched: the listing, the worker, an unlisted file, another site.
{
  const w = start({ ...site, 'extra.txt': 'x' }, site);
  assert.equal(await text(await w.get('extra.txt')), 'x');
  assert.equal((await w.get('missing.txt')).status, 404);
  assert.equal(JSON.parse(await text(await w.get('offline.json'))).commit, 'c1');
  assert.equal(w.cache.size <= 1, true, 'nothing unlisted is kept');
  // A request that is not a GET is left alone.
  let answered = false;
  w.handlers.fetch({ request: { url: ROOT + 'edit/', method: 'POST', mode: 'cors' }, respondWith: () => { answered = true; } });
  assert.equal(answered, false);
}

// A page that loaded before the worker took over tells it what it loaded; those files are then kept.
{
  const w = start(site);
  let reply = null;
  let done;
  w.handlers.message({ data: { warm: [ROOT + 'edit/', ROOT + 'edit/edit.mjs', 'https://elsewhere.example/x.js', 'not an address'] }, source: { postMessage: (m) => { reply = m; } }, waitUntil: (p) => { done = p; } });
  await done;
  assert.equal(JSON.stringify(reply), JSON.stringify({ warmed: 2, of: 4, commit: 'c1' }));
  w.online = false;
  assert.equal((await w.get('edit/edit.mjs')).status, 200);
}

console.log('offline: listed files are served only as the bytes their BLAKE3 labels name, from the store with the network off; altered bytes are refused');
