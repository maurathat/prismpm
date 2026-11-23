// Make an assembled site work offline, by content. Run last, after build-audit-site.mjs and build-edit-site.mjs.
// Usage: node tools/build-offline-site.mjs <out dir> [commit]
//
//   <out>/offline.json   every file of the site with its BLAKE3 label and size: { schema, commit, files: { path: { kappa, bytes } },
//                        parts: { workbench: [path], theorems: [path] } }. `parts` says which files the model workbench
//                        loads when it opens, and which it loads only when a model states theorems of its own, so a
//                        loader that takes the site by its label can fetch those first and the rest when asked for.
//                        Every listed file can still be had; a part is an order, not a limit.
//   <out>/ide.json       the one label of the whole site: the BLAKE3 label of offline.json's bytes, with their size, the
//                        commit and the page the IDE starts at. An app, a frame or a shell names the IDE by this label:
//                        it reads offline.json, takes it only when its bytes derive to the label, and then takes each
//                        file only as the bytes the listing names. Nothing here checks itself.
//   <out>/sw.js          the service worker: prism-code's blake3.mjs, then ide/offline/sw-body.js
//
// The worker is one classic script, since not every browser starts a worker written as a module. prism-code's
// BLAKE3 is put in it by its own source, with its `export` words taken off: the label a page checks and the label
// the worker checks are the same code.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../../src/blake3.mjs';

export const OFFLINE_SCHEMA = 'prism-ide/offline-site/1';
export const IDE_SCHEMA = 'prism-ide/label/1';
/** The page of the site the IDE starts at, as a path of the listing. */
export const IDE_ENTRY = 'edit/ide/index.html';

/** What names the whole site by one label: `listingBytes` are offline.json exactly as it is published. */
export function ideLabel(listingBytes, commit) {
  const listing = JSON.parse(new TextDecoder().decode(listingBytes));
  const sized = (part) => { const of = listing.parts?.[part] ?? []; return { files: of.length, bytes: of.reduce((sum, path) => sum + (listing.files[path]?.bytes ?? 0), 0) }; };
  // The sizes of the listing's parts are repeated here for a reader; the parts themselves are in the listing, which
  // is what the label covers.
  return { schema: IDE_SCHEMA, kappa: kappa(listingBytes), bytes: listingBytes.length, listing: 'offline.json', entry: listing.files?.[IDE_ENTRY] ? IDE_ENTRY : null, files: Object.keys(listing.files ?? {}).length,
    parts: { workbench: sized('workbench'), theorems: sized('theorems') }, commit };
}
const ide = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The worker's source: blake3.mjs with nothing exported, then the worker's own body. */
export function workerSource() {
  const blake3 = readFileSync(join(ide, '..', 'src', 'blake3.mjs'), 'utf8');
  if (/^\s*import\s/m.test(blake3)) throw new Error('src/blake3.mjs imports another module, so it cannot be put in the worker as it is');
  const plain = blake3.replace(/^export\s+(?=(?:class|function|const|let|async)\b)/gm, '');
  if (/^export\s/m.test(plain)) throw new Error('src/blake3.mjs exports something in a form this script does not take off');
  // blake3.mjs keeps its own names to itself, inside a function, so none of them can meet a name of the worker's.
  return `// Written by tools/build-offline-site.mjs. Do not edit: change src/blake3.mjs or ide/offline/sw-body.js.\nconst kappa = (() => {\n${plain}\nreturn kappa;\n})();\n${readFileSync(join(ide, 'offline', 'sw-body.js'), 'utf8')}`;
}

/**
 * Which listed files the model workbench (edit/ide/index.html) loads when it opens, and which only for theorems.
 * The workbench's own files are found from its page: the scripts and styles it names, and what those import by
 * name, followed to the end. A file reached only by an import made while running is left to be asked for. Beside
 * them are the modules the page and its workers import from the edit folder, LexLean and the rule kernel.
 */
export function workbenchParts(out, paths) {
  const listed = new Set(paths);
  const start = IDE_ENTRY;
  if (!listed.has(start)) return { workbench: [], theorems: [] };
  const taken = new Set([start]);
  const under = (from, reference) => { const at = new URL(reference, 'https://site.invalid/' + from).pathname.slice(1); return listed.has(at) ? at : null; };
  const html = readFileSync(join(out, start), 'utf8');
  const queue = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => under(start, m[1])).filter(Boolean);
  while (queue.length > 0) {
    const path = queue.pop();
    if (taken.has(path)) continue;
    taken.add(path);
    if (!/\.(?:js|mjs)$/.test(path)) continue;
    const text = readFileSync(join(out, path), 'utf8');
    // `import ... from "./x.js"`, `import "./x.js"` and `export ... from "./x.js"`; never `import("./x.js")`.
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) { const at = under(path, m[1]); if (at && !taken.has(at)) queue.push(at); }
  }
  const beside = (path) => /^edit\/(?:prism-code|kernel|terminal|vendor)\//.test(path)
    || /^edit\/(?:pin\.json|lexlean\.wasm\.gz|app-match\.mjs|holo-match\.mjs|drafts\.mjs|model-tar\.mjs|kappa-registry\.mjs|lexlean-worker\.mjs|prove-worker\.mjs|model-prove-worker\.mjs)$/.test(path);
  const theorems = paths.filter((path) => path.startsWith('edit/model-kernel/'));
  return { workbench: paths.filter((path) => taken.has(path) || beside(path)), theorems };
}

/** The listing of a site folder: every file but the listing and the worker themselves, by path, in order. */
export function offlineListing(out, commit) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const at = join(dir, name);
      if (statSync(at).isDirectory()) { walk(at); continue; }
      const path = relative(out, at).split('\\').join('/');
      // A static host publishes no dot-file, and the worker cannot be the one to check itself or its listing.
      // Nor can the listing hold the file that names the listing by its label.
      // Nor the store by label (tools/build-kappa-store.mjs): it holds this listing and earlier ones.
      if (path === 'offline.json' || path === 'ide.json' || path === 'sw.js' || path.startsWith('kappa/') || path.split('/').some((part) => part.startsWith('.'))) continue;
      const bytes = readFileSync(at);
      files[path] = { kappa: kappa(bytes), bytes: bytes.length };
    }
  };
  walk(out);
  return { schema: OFFLINE_SCHEMA, commit, files, parts: workbenchParts(out, Object.keys(files)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outArg, commit = 'unknown'] = process.argv.slice(2);
  if (!outArg) { console.error('usage: node tools/build-offline-site.mjs <out dir> [commit]'); process.exit(64); }
  const out = resolve(outArg);
  const listing = offlineListing(out, commit);
  const listingBytes = new TextEncoder().encode(JSON.stringify(listing) + '\n');
  writeFileSync(join(out, 'offline.json'), listingBytes);
  const label = ideLabel(listingBytes, commit);
  writeFileSync(join(out, 'ide.json'), JSON.stringify(label) + '\n');
  writeFileSync(join(out, 'sw.js'), workerSource());
  const total = Object.values(listing.files).reduce((sum, file) => sum + file.bytes, 0);
  console.log(`offline: ${Object.keys(listing.files).length} files, ${(total / 1048576).toFixed(1)} MiB, each named by its BLAKE3 label; commit ${commit}`);
  console.log(`ide: ${label.kappa} names the whole site (offline.json, ${label.bytes} bytes)`);
}
