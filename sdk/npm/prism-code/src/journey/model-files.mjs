/**
 * The model of an app as files a page can fetch: what LexLean reads to check it, and nothing else.
 *
 * A built rule app's page carries these in `model/`, with `model/project.json` listing them, so the model can be
 * opened, checked and proved in a browser from the app's own address. The listing is
 * `{ schema, files: ['lexlean.toml', 'src/App.lex.tex', ...], entry: 'src/App.lex.tex', semanticId }`.
 *
 * Left out, because a check does not read them or because they are not the author's to publish:
 *   - anything whose name starts with a dot (caches, build outputs, and files a static host does not serve);
 *   - `session.json`, which names folders on the author's machine, and every other `.json` but `lake-manifest.json`;
 *   - notes (`.md`) and logs (`.log`);
 *   - `target/` and `node_modules/`, and any folder the caller names.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL_LISTING_SCHEMA = 'prism/model-listing/1';
const SKIPPED = ['target', 'node_modules'];

/** `{ files: Map<path, bytes>, entry }` for the LexLean project in `dir`. Throws when the project has no module to open. */
export function modelFiles(dir, { skip = [] } = {}) {
  const skipped = new Set([...SKIPPED, ...skip]);
  const files = new Map();
  const visit = (at, rel) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { if (!skipped.has(entry.name)) visit(join(at, entry.name), rel + entry.name + '/'); }
      else if (entry.isFile() && (!/\.(md|json|log)$/.test(entry.name) || entry.name === 'lake-manifest.json')) files.set(rel + entry.name, readFileSync(join(at, entry.name)));
    }
  };
  visit(dir, '');
  const named = /entrypoints\s*=\s*\[\s*"([^"]+)"/.exec(new TextDecoder().decode(files.get('lexlean.toml') ?? new Uint8Array()))?.[1];
  // The file to open. An app started from the template may give its modules its own names and leave the template's
  // entrypoint behind: LexLean reads every module under src/ and checks such a project, so the file to open is then
  // the module that states the application, or the first module there is.
  const modules = [...files.keys()].filter((path) => path.endsWith('.lex.tex')).sort();
  const entry = named && files.has(named) ? named : (modules.find((path) => /name:\s*application/.test(new TextDecoder().decode(files.get(path)))) ?? modules[0]);
  if (!entry) throw new Error(`${join(dir, 'lexlean.toml')} names no entrypoint that is in the project, and the project has no module`);
  return { files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), entry };
}

/** The bytes of `project.json` for a model: its files' paths, the file to open, and the model's identity when known. */
export function modelListing({ files, entry }, { semanticId = null } = {}) {
  return Buffer.from(JSON.stringify({ schema: MODEL_LISTING_SCHEMA, files: [...files.keys()], entry, semanticId }) + '\n');
}
