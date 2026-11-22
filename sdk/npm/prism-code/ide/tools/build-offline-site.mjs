// Make an assembled site work offline, by content. Run last, after build-audit-site.mjs and build-edit-site.mjs.
// Usage: node tools/build-offline-site.mjs <out dir> [commit]
//
//   <out>/offline.json   every file of the site with its BLAKE3 label and size: { schema, commit, files: { path: { kappa, bytes } } }
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
  return { schema: IDE_SCHEMA, kappa: kappa(listingBytes), bytes: listingBytes.length, listing: 'offline.json', entry: listing.files?.[IDE_ENTRY] ? IDE_ENTRY : null, files: Object.keys(listing.files ?? {}).length, commit };
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
      if (path === 'offline.json' || path === 'ide.json' || path === 'sw.js' || path.split('/').some((part) => part.startsWith('.'))) continue;
      const bytes = readFileSync(at);
      files[path] = { kappa: kappa(bytes), bytes: bytes.length };
    }
  };
  walk(out);
  return { schema: OFFLINE_SCHEMA, commit, files };
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
