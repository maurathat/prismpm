/**
 * `prism-code init` (issue #281): scaffold a project prism-code can check,
 * build and verify in this process.
 *
 * A project is a template plus a generated `prism.toml`. A template is a
 * reviewed PrismPM fixture copied byte for byte (see `TEMPLATES`): its
 * `lexlean.lock` binds the digests of its Lean workspace files and its
 * `lexlean.toml`, so renaming anything inside it would make the lock stale.
 * The application's own name lives in `prism.toml` (#280).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { parseManifest, MANIFEST_FILE } from './manifest.mjs';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/**
 * The templates. Each is a copy of a reviewed fixture; a test keeps the copy
 * byte for byte equal to its origin, and `scripts/sync-templates.mjs`
 * refreshes it.
 */
export const TEMPLATES = Object.freeze({
  'text-request': Object.freeze({
    origin: 'tests/fixtures/holo/ho-11-text-application/project',
    description: 'A text application: a UTF-8 request in, a response out, six acceptance vectors (language 1.2).',
    model: 'src',
    watch: Object.freeze(['src/**/*.lex.tex', 'language/**/*.toml', 'lexlean.toml']),
  }),
});
export const DEFAULT_TEMPLATE = 'text-request';

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** The files of a template, path to bytes, with line endings as LF whatever the checkout did. */
export function templateFiles(template = DEFAULT_TEMPLATE) {
  if (!Object.hasOwn(TEMPLATES, template)) {
    fail('init.template', `no template ${JSON.stringify(template)}; the templates are ${Object.keys(TEMPLATES).join(', ')}`);
  }
  const root = join(TEMPLATES_DIR, template);
  const files = new Map();
  for (const path of walk(root)) {
    // A Windows checkout may have turned LF into CRLF; the locks hash LF bytes.
    const text = readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
    files.set(path, new TextEncoder().encode(text));
  }
  return files;
}

/** The `prism.toml` a new project starts with. It grants nothing: the capability table is present and empty. */
export function manifestText(name, template = DEFAULT_TEMPLATE) {
  const t = TEMPLATES[template];
  const text = [
    '[application]',
    `name = ${JSON.stringify(name)}`,
    'version = "0.1.0"',
    `description = ${JSON.stringify(t.description)}`,
    '',
    '[model]',
    `source = ${JSON.stringify(t.model)}`,
    `watch = [${t.watch.map((w) => JSON.stringify(w)).join(', ')}]`,
    '',
    '# Deny by default: an empty set grants the holo nothing. See docs/proposals/279-capability-sets.md.',
    '[capabilities]',
    '',
  ].join('\n');
  // The manifest reader is the authority on what a valid name is.
  parseManifest(text);
  return text;
}

/** A project name from a directory name: lower case, `-` for anything else, starting with a letter. */
export function nameFromDirectory(directory) {
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const name = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 63);
  return name || 'app';
}

/**
 * A new project's `.gitattributes`. LexLean refuses a source with CRLF
 * (`LLC0101`), and Git on Windows writes CRLF unless told not to, so every
 * project keeps its text LF from its first commit.
 */
export const GITATTRIBUTES = '* text eol=lf\n';

/**
 * Everything `init` writes before binding an SDK: the template's files,
 * `prism.toml` and `.gitattributes`, as path to bytes. Throws
 * `manifest.invalid` for a name the manifest refuses.
 */
export function planInit({ name, template = DEFAULT_TEMPLATE }) {
  const files = templateFiles(template);
  for (const generated of [MANIFEST_FILE, '.gitattributes']) {
    if (files.has(generated)) fail('init.template', `template ${template} already has a ${generated}`);
  }
  files.set(MANIFEST_FILE, new TextEncoder().encode(manifestText(name, template)));
  files.set('.gitattributes', new TextEncoder().encode(GITATTRIBUTES));
  return files;
}

/** What this scaffold is, as `init` prints it. */
export const NOT_AN_APP = [
  'This is a LexLean project. A Prism app is a LexLean project too: start one from a starter with',
  'npx prism-code@latest init <dir> (or --template decision-app, stateful-app).',
].join('\n');

/** The gates a new project's author runs next, cheapest first, as `init` prints them. */
export function nextSteps(directory) {
  return [
    'Next, every step in this process:',
    `  cd ${directory}`,
    '  npx prism-code check --json      the model checks and every theorem is proved',
    '  npx prism-code build --json      check, then write the app',
    '  npx prism-code verify --json     judge what was built and replay every acceptance vector',
    '',
  ].join('\n');
}
