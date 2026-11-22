/**
 * The serverless boundary. A build may read static files over plain HTTPS GET
 * from GitHub (the pinned kernel and template, the public proof store, the
 * user's own repository and Pages site) and nothing else. No server that
 * computes is ever asked: every other host is refused, so Prism is serverless
 * whatever the user sets.
 *
 * Every network read of a build goes through `buildFetch`, which refuses any
 * other host before a byte is sent with `build.host-not-allowed`, and keeps a
 * ledger of the hosts asked and the bytes received, so a build can report them.
 * There is no fallback: a refused host fails the step that asked for it.
 */
import { PrismCodeError } from '../errors.mjs';

/** The hosts a build reads static files from, by exact name. */
export const STATIC_HOSTS = Object.freeze(['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
/** The user's own Pages site, `<owner>.github.io`. */
const PAGES = /^[a-z0-9](?:[a-z0-9-]{0,38})\.github\.io$/;

/** A build asked a host outside the boundary: a `PrismCodeError` with code `build.host-not-allowed`. Nothing was sent. */
export function hostNotAllowed(url, why) {
  const message = `${url} is outside a Prism build's serverless boundary (${why}); nothing was sent. A build reads static files from GitHub only: Prism is serverless.`;
  return Object.assign(new PrismCodeError('build.host-not-allowed', message), { url });
}

/** Why `url` may not be asked, or null when it may. `optIn` names the hosts the user opted in to. */
export function refusal(url, { optIn = [] } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'not a URL';
  }
  if (u.protocol !== 'https:') return 'not HTTPS';
  if (u.username || u.password) return 'carries credentials';
  if (u.port) return 'names a port';
  const host = u.hostname.toLowerCase();
  if (STATIC_HOSTS.includes(host) || PAGES.test(host)) return null;
  return 'not an allowed host';
}

/** The hosts beyond GitHub a build may ask: none. Prism is serverless. */
export const optedIn = () => [];

/** A ledger of what a build asked of the network: each host, its requests and the bytes received. */
export function networkLedger() {
  const hosts = new Map();
  return {
    note(url, bytes) {
      const host = new URL(url).hostname;
      const h = hosts.get(host) ?? { host, requests: 0, bytes: 0 };
      h.requests += 1;
      h.bytes += bytes;
      hosts.set(host, h);
    },
    report: () => [...hosts.values()].sort((a, b) => a.host.localeCompare(b.host)),
    bytes: () => [...hosts.values()].reduce((n, h) => n + h.bytes, 0),
  };
}

/** The ledger of this process, which `buildFetch` writes to unless given another. */
export const processLedger = networkLedger();

/**
 * `fetch` behind the boundary. A request to a host outside it throws
 * `build.host-not-allowed` before anything is sent, and so does a redirect to
 * one: redirects are followed here, each hop checked. An allowed request is made
 * with the given `fetch`, and the bytes of its body are counted when it is read whole.
 */
export function buildFetch({ fetch = globalThis.fetch, optIn = [], ledger = processLedger } = {}) {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    let at = url;
    let response;
    // Redirects are followed here, one hop at a time, so every host the request reaches is held to the boundary.
    for (let hop = 0; ; hop++) {
      const why = refusal(at, { optIn });
      if (why) throw hostNotAllowed(at, why);
      response = await fetch(hop === 0 ? input : at, { ...init, redirect: 'manual' });
      const next = response.status >= 300 && response.status < 400 ? response.headers?.get?.('location') : null;
      if (!next) break;
      if (hop >= 5) throw hostNotAllowed(at, 'more than five redirects');
      at = new URL(next, at).href;
    }
    const count = (bytes) => (ledger.note(at, bytes), bytes);
    return new Proxy(response, {
      get(target, prop) {
        if (prop === 'arrayBuffer') return async () => { const b = await target.arrayBuffer(); count(b.byteLength); return b; };
        if (prop === 'text') return async () => { const t = await target.text(); count(new TextEncoder().encode(t).length); return t; };
        if (prop === 'json') return async () => { const t = await target.text(); count(new TextEncoder().encode(t).length); return JSON.parse(t); };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  };
}
