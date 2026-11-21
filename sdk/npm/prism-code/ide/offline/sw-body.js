// The site's service worker: every file the site publishes is served by its content, and works with the network off.
//
// tools/build-offline-site.mjs writes sw.js as prism-code's blake3.mjs followed by this file, so `kappa` below is the
// package's own BLAKE3 label, and writes offline.json beside it: every published file with its `blake3:` label.
//
//   A file the listing names   is answered from this browser's store when its bytes still derive to that label,
//                              else fetched, checked against the label, kept, and answered. Bytes that are not
//                              what the listing names are refused: the page gets an error, never the bytes.
//   Anything else              goes to the network untouched.
//
// So after one visit the pages open with the network off, and one changed byte in a stored or fetched file is not
// served. The listing itself is taken from the site (the newest one on each page load when the network answers, the
// kept one otherwise), so this is trusted no further than the origin that serves the site.
//
// If anything here throws, the request falls through to the network: a fault in this worker must not take the site down.

/* global kappa */
const STORE = 'prism-ide-kappa-1';
const LISTING = 'offline.json';
const ROOT = new URL('./', self.location.href).href;
const keyOf = (label) => ROOT + '__kappa__/' + label.slice('blake3:'.length);
const listingKey = ROOT + '__kappa__/listing';
let listing = null; // { files: { 'edit/index.html': { kappa, bytes } }, commit }

const refused = (path, got, want) => new Response(`${path}: the bytes received are ${got}, not the ${want} this site's listing names. Nothing was served.\n`, { status: 502, statusText: 'Not the listed bytes', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-prism-kappa': 'refused' } });

async function keptListing() {
  try { const kept = await (await caches.open(STORE)).match(listingKey); return kept ? await kept.json() : null; } catch { return null; }
}

/** The newest listing the network gives within a moment, else the one kept. Entries no listing names any more are dropped. */
async function refreshListing() {
  try {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 2500);
    // Asked for under an address no cache has seen, so a cache between here and the site cannot answer with an old one.
    const response = await fetch(`${ROOT}${LISTING}?at=${Date.now()}`, { cache: 'no-store', signal: stop.signal });
    clearTimeout(timer);
    if (response.ok) {
      const fresh = await response.json();
      if (fresh && typeof fresh.files === 'object' && fresh.files !== null) {
        const changed = JSON.stringify(fresh) !== JSON.stringify(listing);
        listing = fresh;
        const store = await caches.open(STORE);
        await store.put(listingKey, new Response(JSON.stringify(fresh), { headers: { 'content-type': 'application/json' } }));
        if (changed) {
          const named = new Set(Object.values(fresh.files).map((entry) => keyOf(entry.kappa)));
          for (const request of await store.keys()) if (request.url !== listingKey && !named.has(request.url)) await store.delete(request);
        }
        return;
      }
    }
  } catch { /* the network did not answer: the kept listing stands */ }
  listing ??= await keptListing();
}

const typeOf = (response, path) => response.headers.get('content-type') ?? (path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');

/** One listed file: from the store when it is still what its label names, else from the network when it is. */
async function byContent(path, entry) {
  const store = await caches.open(STORE);
  const key = keyOf(entry.kappa);
  const kept = await store.match(key);
  if (kept) {
    const bytes = new Uint8Array(await kept.clone().arrayBuffer());
    if (kappa(bytes) === entry.kappa) return new Response(bytes, { headers: { 'content-type': kept.headers.get('content-type') ?? 'application/octet-stream', 'x-prism-kappa': 'kept' } });
    await store.delete(key); // not what its name says: it is not there
  }
  let got = 'nothing';
  // Twice: a cache between here and the site may still hold the file of the deployment before this listing's.
  for (const address of [ROOT + path, `${ROOT}${path}?kappa=${entry.kappa.slice(7, 19)}`]) {
    let response;
    try { response = await fetch(address, { cache: 'no-store' }); } catch { continue; }
    if (!response.ok) { got = `HTTP ${response.status}`; continue; }
    const bytes = new Uint8Array(await response.arrayBuffer());
    got = kappa(bytes);
    if (got === entry.kappa) {
      const type = typeOf(response, path);
      try { await store.put(key, new Response(bytes, { headers: { 'content-type': type } })); } catch { /* a full store keeps nothing; the bytes are still good */ }
      return new Response(bytes, { headers: { 'content-type': type, 'x-prism-kappa': 'fetched' } });
    }
  }
  if (got === 'nothing') return new Response(`${path}: the network did not answer and this browser has not kept the file.\n`, { status: 504, statusText: 'Offline and not kept', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-prism-kappa': 'absent' } });
  return refused(path, got, entry.kappa);
}

/** The listed path a request is for, or null: the address under the site's root, a folder standing for its index.html. */
function listedPath(url) {
  if (!url.href.startsWith(ROOT)) return null;
  let path = decodeURIComponent(url.pathname.slice(new URL(ROOT).pathname.length));
  if (path === '' || path.endsWith('/')) path += 'index.html';
  return path;
}

async function answer(request) {
  const url = new URL(request.url);
  const path = listedPath(url);
  if (path === null || path === LISTING || path === 'sw.js') return fetch(request);
  if (request.mode === 'navigate' || listing === null) await refreshListing();
  const entry = listing?.files?.[path];
  if (!entry) return fetch(request);
  const response = await byContent(path, entry);
  if (response.status !== 502) return response;
  // The site may have been published again since this listing was taken. The newest listing decides: if it names
  // other bytes for this path, those are what is checked; if it names the same, the refusal stands.
  await refreshListing();
  const now = listing?.files?.[path];
  if (!now) return fetch(request);
  return now.kappa === entry.kappa ? response : byContent(path, now);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(answer(event.request).catch(() => fetch(event.request)));
});
// A page that loaded before this worker took over tells it what it loaded, so the first visit is enough to go offline.
self.addEventListener('message', (event) => {
  const warm = event.data?.warm;
  if (!Array.isArray(warm)) return;
  event.waitUntil((async () => {
    if (listing === null) await refreshListing();
    let kept = 0;
    for (const address of warm) {
      try {
        const path = listedPath(new URL(address));
        const entry = path === null ? null : listing?.files?.[path];
        if (entry && (await byContent(path, entry)).ok) kept++;
      } catch { /* one address that cannot be read does not stop the rest */ }
    }
    event.source?.postMessage({ warmed: kept, of: warm.length, commit: listing?.commit ?? null });
  })());
});
