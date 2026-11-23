// A folder a person opened, read as a Prism project: which of its files are the model, and which file to open.
// No DOM, no import, no file system: it is given the folder's files as they were read, path to bytes.
//
// A project `prism-code init` wrote has prism.toml and prism.project at its root and the LexLean project (lexlean.toml,
// src/, language/) in app/. An older project, or a model on its own, has lexlean.toml at its root. The model is the
// folder that holds lexlean.toml: the root if it is there, else the one folder directly under the root that has it.
//
// Which files are the model is the package's rule, src/journey/model-files.mjs, restated here because that module
// reads a disk: names starting with a dot are skipped, as are the folders target, node_modules and tools; files
// ending .md, .json or .log are skipped, lake-manifest.json excepted. tools/folder-model-test.mjs holds the two to
// the same answer on a project init wrote.
//
// prism.project, the file init writes the project's ID into, is not a model file and is never read here: it is
// handed on as it is, for the holospace to read.

export const PROJECT_FILE = 'prism.project';
const SKIPPED = new Set(['target', 'node_modules', 'tools']);
const decoder = new TextDecoder();

/** A path as the folder gives it, made plain: forward slashes, no leading slash. Null for one that leaves the folder. */
export function plainPath(path) {
  const parts = String(path).replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.');
  return parts.length === 0 || parts.includes('..') ? null : parts.join('/');
}

/** Whether a path, relative to the model's folder, is a file of the model. */
export function isModelFile(path) {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (parts.some((part) => part.startsWith('.'))) return false;
  if (parts.slice(0, -1).some((part) => SKIPPED.has(part))) return false;
  return !/\.(md|json|log)$/.test(name) || name === 'lake-manifest.json';
}

/**
 * The model in a folder. `files` is a Map or object of path to bytes (Uint8Array), relative to the folder opened.
 * Resolves nothing asynchronously: returns
 *   { root, files: Map(path relative to the model -> bytes), entry, marker }
 * `root` is '' or 'app/' (the model's folder inside the one opened), `entry` the file to open first, `marker` the
 * bytes of prism.project at the opened folder's root, or null when there is none.
 * Throws an error with `code` 'folder.model' when the folder holds no LexLean project or no module.
 */
export function folderModel(files) {
  const given = new Map();
  for (const [path, bytes] of files instanceof Map ? files : Object.entries(files ?? {})) {
    const plain = plainPath(path);
    if (plain !== null && bytes instanceof Uint8Array) given.set(plain, bytes);
  }
  const fail = (message) => { throw Object.assign(new Error(message), { code: 'folder.model' }); };
  let root = null;
  if (given.has('lexlean.toml')) root = '';
  else {
    const under = [...given.keys()].filter((path) => /^[^/]+\/lexlean\.toml$/.test(path) && !path.startsWith('.') && !SKIPPED.has(path.split('/')[0])).sort();
    // The template's own folder first; otherwise the only one there is.
    if (under.includes('app/lexlean.toml')) root = 'app/';
    else if (under.length === 1) root = under[0].slice(0, -'lexlean.toml'.length);
    else if (under.length > 1) fail(`this folder holds ${under.length} LexLean projects (${under.map((p) => p.split('/')[0]).join(', ')}); open the one to edit`);
  }
  if (root === null) fail('this folder holds no LexLean project: there is no lexlean.toml in it or in a folder directly under it');
  const model = new Map();
  for (const [path, bytes] of [...given].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!path.startsWith(root)) continue;
    const rel = path.slice(root.length);
    // The project's ID file is never a file of the model, wherever the model's folder is.
    if (rel !== PROJECT_FILE && isModelFile(rel)) model.set(rel, bytes);
  }
  const named = /entrypoints\s*=\s*\[\s*"([^"]+)"/.exec(decoder.decode(model.get('lexlean.toml') ?? new Uint8Array()))?.[1];
  const modules = [...model.keys()].filter((path) => path.endsWith('.lex.tex')).sort();
  const entry = named && model.has(named) ? named : (modules.find((path) => /name:\s*application/.test(decoder.decode(model.get(path)))) ?? modules[0]);
  if (!entry) fail('the LexLean project in this folder names no entrypoint that is in it, and has no module');
  return { root, files: model, entry, marker: given.get(PROJECT_FILE) ?? null };
}

/** Whether two sets of files, path to bytes, are the same files with the same bytes. */
export function sameFiles(a, b) {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) {
    const other = b.get(path);
    if (!other || other.length !== bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== other[i]) return false;
  }
  return true;
}
