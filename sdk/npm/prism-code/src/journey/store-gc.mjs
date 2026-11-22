/**
 * Keeps the machine store lean (`$PRISM_HOME/kappa`, kappa-store.mjs), so it never holds the user's disk.
 *
 * - Pinned files (Lean's kernel, LexLean as WebAssembly) have one set of roots: the κ-labels the
 *   installed prism-code pins. A pinned file no root names is removed, so an upgrade leaves only
 *   the new set behind.
 * - Proof results (`bytes/`, `derived/`) are a cache, not roots: past `PRISM_KAPPA_CACHE_MB`
 *   (default 64) the least recently used go first. A lost entry costs a recomputation, never
 *   correctness: every read re-derives its label.
 * - The folders older prism-codes kept files in (`$PRISM_HOME/kernel/`, `$PRISM_HOME/lexlean/`) are
 *   moved into the store when their bytes are a root, then removed.
 *
 * Nothing is removed while a check, prove or build holds the store: each takes a hold (`holds/<pid>-…`)
 * for as long as it runs, and a collection takes `gc.lock` before it looks at the holds, so one of the
 * two always sees the other. Files are written beside their name and moved into place, so a crash
 * leaves at most a `.partial` file, which a later collection removes once its process is gone.
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve } from 'node:path';
import { prismHome } from '../home.mjs';
import { kappa } from '../blake3.mjs';
import { admittedLabel, isGzip, kappaDirectory, pinnedFile, writeAtomic } from './kappa-store.mjs';
import { KERNEL_FILES } from './kernel-store.mjs';
import { LEXLEAN_WASM } from './lexlean-wasm.mjs';

/** The default size of the proof cache, in MB. */
export const CACHE_DEFAULT_MB = 64;

/** What this prism-code pins: each file's κ-label (of its decoded bytes) and how it is kept. */
const PINNED = () => [...Object.values(KERNEL_FILES), LEXLEAN_WASM].filter((f) => f.kappa).map((f) => ({ kappa: f.kappa, encoding: f.encoding ?? 'identity' }));

/** The κ-labels this prism-code pins: the only roots of the pinned store. */
export const pinnedRoots = () => PINNED().map((f) => f.kappa).sort();

/** The label of the pinned set as a whole. A different one means prism-code was upgraded (or downgraded). */
export const rootsLabel = (roots = pinnedRoots()) => kappa(new TextEncoder().encode(roots.join('\n')));

const cacheBytes = (env) => {
  const mb = Number(env.PRISM_KAPPA_CACHE_MB);
  return Math.floor((env.PRISM_KAPPA_CACHE_MB !== undefined && Number.isFinite(mb) && mb >= 0 ? mb : CACHE_DEFAULT_MB) * 1024 * 1024);
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Every file under `dir`, with its size and the time it was last used. */
function filesUnder(dir) {
  const out = [];
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) visit(p);
      else {
        try {
          const s = statSync(p);
          out.push({ path: p, bytes: s.size, used: s.mtimeMs });
        } catch {
          // Removed since the listing.
        }
      }
    }
  };
  visit(dir);
  return out;
}

const sizeOf = (dir) => filesUnder(dir).reduce((n, f) => n + f.bytes, 0);

const lockFile = (env) => join(kappaDirectory(env), 'gc.lock');
const holdsDir = (env) => join(kappaDirectory(env), 'holds');

/** Whether a collection holds the store now; a lock whose process is gone is removed. */
function collecting(env) {
  const file = lockFile(env);
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  if (pid && pid !== process.pid && alive(pid)) return true;
  rmSync(file, { force: true });
  return false;
}

/**
 * Hold the store for a check, prove or build: no collection removes anything until the hold is
 * released. Waits up to `waitMs` for a collection already running to finish. Returns the release.
 */
export function holdStore({ env = process.env, waitMs = 60000 } = {}) {
  if (env.PRISM_KAPPA === '0') return () => {};
  mkdirSync(holdsDir(env), { recursive: true });
  const file = join(holdsDir(env), `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, String(process.pid));
  for (const until = Date.now() + waitMs; collecting(env) && Date.now() < until; ) pause(50);
  return () => rmSync(file, { force: true });
}

/** Run `work` while holding the store. */
export async function withStoreHeld(env, work) {
  const release = holdStore({ env });
  try {
    return await work();
  } finally {
    release();
  }
}

/** The holds of processes still running; a hold whose process is gone is removed. */
function liveHolds(env) {
  const live = [];
  for (const name of existsSync(holdsDir(env)) ? readdirSync(holdsDir(env)) : []) {
    const pid = Number(name.split('-')[0]);
    if (pid && alive(pid)) live.push(pid);
    else rmSync(join(holdsDir(env), name), { force: true });
  }
  return live;
}

/** The folders older prism-codes kept pinned files in, unless the user points prism-code at one of them. */
function legacyFolders(env) {
  const own = env.PRISM_KERNEL_DIR ? resolve(env.PRISM_KERNEL_DIR) : null;
  return ['kernel', 'lexlean'].map((d) => join(prismHome(env), d)).filter((d) => existsSync(d) && !(own && !relative(d, own).startsWith('..')));
}

/**
 * Collect the store. Resolves `{ busy, before, after, freed, removed }`, sizes in bytes over the
 * store and the older folders. With `dryRun`, nothing is moved or removed, and `after` and `freed`
 * say what a collection would leave and free. `busy` is true, and nothing is touched, while a
 * check, prove or build holds the store or another collection runs.
 */
export function collectStore({ env = process.env, dryRun = false, roots = pinnedRoots() } = {}) {
  const store = kappaDirectory(env);
  const legacy = legacyFolders(env);
  const before = sizeOf(store) + legacy.reduce((n, d) => n + sizeOf(d), 0);
  const removed = { pinned: [], cache: [], legacy: [], partial: [] };
  const report = (busy) => {
    const freed = [...removed.pinned, ...removed.cache, ...removed.legacy, ...removed.partial].reduce((n, f) => n + f.bytes, 0);
    return { busy, dryRun, before, after: before - freed, freed, removed: Object.fromEntries(Object.entries(removed).map(([k, v]) => [k, v.length])), roots: roots.length };
  };
  let locked = false;
  if (!dryRun) {
    mkdirSync(store, { recursive: true });
    if (collecting(env)) return report(true);
    try {
      closeSync(openSync(lockFile(env), 'wx'));
      writeFileSync(lockFile(env), String(process.pid));
      locked = true;
    } catch {
      return report(true);
    }
    if (liveHolds(env).length) {
      rmSync(lockFile(env), { force: true });
      return report(true);
    }
  }
  const want = new Set(roots);
  const drop = (kind, f) => {
    removed[kind].push(f);
    if (!dryRun) rmSync(f.path, { force: true });
  };
  try {
    // A file a crash left half written, whose process is gone.
    for (const f of filesUnder(store)) {
      const m = /\.(\d+)\.partial$/.exec(f.path);
      if (m && !alive(Number(m[1]))) drop('partial', f);
    }
    // The folders of older prism-codes: a root is moved into the store, kept as the root is kept (gzipped when it is
    // served so), and everything else goes.
    const gzipped = new Set(PINNED().filter((f) => f.encoding === 'gzip').map((f) => f.kappa));
    for (const dir of legacy) {
      for (const f of filesUnder(dir)) {
        const bytes = readFileSync(f.path);
        const label = admittedLabel(bytes);
        if (want.has(label) && !existsSync(pinnedFile(label, env))) {
          const kept = gzipped.has(label) && !isGzip(bytes) ? gzipSync(bytes) : bytes;
          if (kept.length < bytes.length) removed.legacy.push({ path: f.path, bytes: bytes.length - kept.length });
          if (!dryRun) {
            writeAtomic(pinnedFile(label, env), kept);
            rmSync(f.path, { force: true });
          }
        } else drop('legacy', f);
      }
      if (!dryRun) rmSync(dir, { recursive: true, force: true });
    }
    // Pinned files no root names: what an earlier prism-code pinned.
    const pinned = join(store, 'pinned');
    for (const f of filesUnder(pinned)) {
      const label = `blake3:${relative(pinned, f.path).split(/[\\/]/).join('')}`;
      if (!want.has(label) && !f.path.endsWith('.partial')) drop('pinned', f);
    }
    // The proof cache, least recently used first, down to its size.
    const cache = ['bytes', 'derived'].flatMap((k) => filesUnder(join(store, k))).filter((f) => !f.path.endsWith('.partial')).sort((a, b) => a.used - b.used);
    let total = cache.reduce((n, f) => n + f.bytes, 0);
    for (const f of cache) {
      if (total <= cacheBytes(env)) break;
      drop('cache', f);
      total -= f.bytes;
    }
    if (!dryRun) writeFileSync(join(store, 'roots.json'), `${JSON.stringify({ roots: rootsLabel(roots) })}\n`);
  } finally {
    if (locked) rmSync(lockFile(env), { force: true });
  }
  return report(false);
}

/** Collect when the pinned set changed since the last collection: after an upgrade. Never throws. */
export function collectIfUpgraded({ env = process.env } = {}) {
  if (env.PRISM_KAPPA === '0') return null;
  try {
    const recorded = JSON.parse(readFileSync(join(kappaDirectory(env), 'roots.json'), 'utf8')).roots;
    if (recorded === rootsLabel() && legacyFolders(env).length === 0) return null;
  } catch {
    // No collection has run here yet.
  }
  try {
    return collectStore({ env });
  } catch {
    return null;
  }
}
