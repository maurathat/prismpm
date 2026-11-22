/**
 * The files of a Prism app on disk. The app lives in one folder, `prism/`
 * beside the user's code (or the current folder when it already holds a
 * `prism.toml`), so an existing repository gains one directory and nothing
 * else.
 *
 *   prism/src/<App>.lex.tex   the LexLean model: the app's one source of truth
 *   prism/prism.toml          the app's manifest, granting nothing
 *   prism/session.json        what was checked, proved and built, and where
 *   prism/...                 the LexLean and PrismPM project files of the template
 *
 * A new app starts from the canonical template (template.mjs, `init`). The starter modules (test/fixtures/starters),
 * each file named by its SHA-256 in their index.json and copied only when its
 * bytes have that address. After that the model is the author's: Prism never
 * writes it again.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismCodeError } from '../errors.mjs';
import { templateFiles } from '../init.mjs';
import { kappa } from '../blake3.mjs';

export const SESSION_SCHEMA = 'prism/session/2';
const TEMPLATE_MODULE = 'TextRequest';
const RENAMED = ['lexlean.toml', 'lakefile.toml', 'lake-manifest.json', 'prismpm.toml'];
const UNUSED = [`src/${TEMPLATE_MODULE}.lex.tex`, 'src/Foundation/Utf8.lex.tex'];
// Not shipped: the starters an app was made from before the canonical template, kept as fixtures for the tests and
// for the IDE's own rule tables.
const STARTERS = new URL('../../test/fixtures/starters/', import.meta.url);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The app folder for a working directory. */
export function appDir(cwd) {
  if (existsSync(join(cwd, 'prism.toml')) && !existsSync(join(cwd, 'prism', 'prism.toml'))) return cwd;
  return join(cwd, 'prism');
}

const write = (dir, path, content) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

export function readSession(dir) {
  try {
    const session = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    if (session.schema === SESSION_SCHEMA) return session;
  } catch {
    // No session yet, or one of an earlier prism-code: either way the record starts empty.
  }
  return { schema: SESSION_SCHEMA, starter: null, status: {} };
}

export function writeSession(dir, session) {
  write(dir, 'session.json', `${JSON.stringify(session, null, 2)}\n`);
}

/** The starters this package carries: `{ name: { module, shape, files } }`. */
export function starters({ root = STARTERS } = {}) {
  return JSON.parse(readFileSync(new URL('index.json', root), 'utf8')).starters;
}

/** The model's source files, relative to the app folder, sorted. */
export function sourceFiles(dir) {
  const root = join(dir, 'src');
  if (!existsSync(root)) return [];
  const out = [];
  const visit = (d, rel) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(d, entry.name), r);
      else if (entry.name.endsWith('.lex.tex')) out.push(`src/${r}`);
    }
  };
  visit(root, '');
  return out.sort();
}

/**
 * The identity of the model as it is on disk: the UOR κ-label (`blake3:<hex>`) of every source file and the project
 * file, each framed by its path and length. Every status, the audit and the build cache name the model by it, so an
 * agent, prism_inspect and a page in a browser all say which bytes were checked, proved and built.
 */
export function sourceDigest(dir) {
  const parts = [];
  for (const file of [...sourceFiles(dir), 'lexlean.toml']) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    parts.push(Buffer.from(`${file}\0${bytes.length}\0`), bytes);
  }
  return kappa(new Uint8Array(Buffer.concat(parts)));
}

/** Write the template's project files the folder lacks. Never overwrites. Returns the paths written. */
export function scaffold(dir) {
  const written = [];
  for (const [path, bytes] of templateFiles()) {
    // The app needs neither the template's model nor Foundation.Utf8: the guest uses the
    // UTF-8 primitives, and the exporter refuses Foundation.Utf8's decoder as too deeply nested.
    if (UNUSED.includes(path) || existsSync(join(dir, path))) continue;
    write(dir, path, bytes);
    written.push(path);
  }
  if (!existsSync(join(dir, '.gitattributes'))) {
    write(dir, '.gitattributes', '* text eol=lf\n');
    written.push('.gitattributes');
  }
  if (!existsSync(join(dir, '.gitignore'))) {
    write(dir, '.gitignore', '.prism/\n.lexlean/\n.lake/\n.prism-last.log\n');
    written.push('.gitignore');
  }
  return written;
}

/**
 * Start an app from a starter: the template's project files, named for the
 * starter's module, and the starter's own files, each copied only when its
 * bytes have the address the index names. Refuses a folder that already holds
 * a model: Prism never writes over the author's LexLean. `root` is the
 * folder of starters, a URL ending in `/`. Returns `{ starter, module, written }`.
 */
export function startApp(dir, name, { root = STARTERS } = {}) {
  const all = starters({ root });
  const starter = all[name];
  if (!starter) throw new PrismCodeError('start.starter', `there is no starter ${JSON.stringify(name)}; the starters are ${Object.keys(all).join(', ')}`);
  if (sourceFiles(dir).length > 0) throw new PrismCodeError('start.exists', `${join(dir, 'src')} already holds a LexLean model; Prism does not write over it`);
  const files = new Map();
  for (const [path, want] of Object.entries(starter.files)) {
    const bytes = readFileSync(new URL(`${name}/${path}`, root));
    if (`sha256:${sha256(bytes)}` !== want) throw new PrismCodeError('start.starter', `the starter file ${name}/${path} is not the bytes its index names`);
    files.set(path, bytes);
  }
  const written = scaffold(dir);
  const originals = templateFiles();
  for (const file of RENAMED) {
    let text = new TextDecoder().decode(originals.get(file));
    text = text.split('prism-text-request').join(`prism-${name}`).split(`Prism${TEMPLATE_MODULE}`).join(`Prism${starter.module}`).split(`src/${TEMPLATE_MODULE}.lex.tex`).join(`src/${starter.module}.lex.tex`);
    if (file === 'prismpm.toml') text = text.replace(`project = "${TEMPLATE_MODULE}"`, `project = "${starter.module}"`);
    write(dir, file, text);
  }
  for (const [path, bytes] of files) {
    write(dir, path, bytes);
    written.push(path);
  }
  restampLock(dir);
  return { starter: name, module: starter.module, written };
}

/**
 * The lock as `lexlean lock` would write it after the project is renamed. It records the SHA-256 of lexlean.toml and
 * of each workspace file, and renaming changes those files, so the template's lock is stale for every new app; LexLean
 * as WebAssembly cannot rewrite it (it runs no command that changes a project). Only those hashes are restamped, from
 * the bytes on disk: nothing else in the lock depends on the name, and LexLean still checks the whole lock.
 */
export function restampLock(dir) {
  const path = join(dir, 'lexlean.lock');
  if (!existsSync(path)) return false;
  const digest = (file) => sha256(readFileSync(join(dir, file)));
  let text = readFileSync(path, 'utf8');
  text = text.replace(/^project_config_sha256 = "[0-9a-f]{64}"$/m, () => `project_config_sha256 = "${digest('lexlean.toml')}"`);
  text = text.replace(/(\[\[workspace_file\]\]\npath = "([^"\n]+)"\nsha256 = ")[0-9a-f]{64}"/g, (all, head, file) => (existsSync(join(dir, file)) ? `${head}${digest(file)}"` : all));
  writeFileSync(path, text);
  return true;
}

export const isBound = (dir) => existsSync(join(dir, 'prismpm.lock')) && existsSync(join(dir, 'standards.lock'));
