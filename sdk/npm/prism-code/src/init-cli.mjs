/**
 * The `init` verb (issue #281), shared by `prism-code init` and the
 * `create-prism-code` scaffolder, so `npm create prism-code` and
 * `npx prism-code init` write the same project.
 *
 *   init [<dir>] [--name <name>] [--template <name>] [--force]
 *
 * A template is a LexLean project copied byte for byte. A starter (rule-app,
 * decision-app, stateful-app) is a Prism app: a content-addressed starter
 * module the author edits, which `check`, `build` and `verify` then judge in
 * this process. Nothing here starts another program or reaches the network.
 *
 * Exit codes: 0 scaffolded, 2 refused (a file exists, a bad name), 64 usage.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_TEMPLATE, NOT_AN_APP, TEMPLATES, nameFromDirectory, nextSteps, planInit } from './init.mjs';
import { PrismCodeError } from './errors.mjs';
import { readSession, startApp, starters, writeSession } from './journey/project.mjs';

/** Every name `--template` takes: the templates, then the starters. */
export const templateNames = () => [...Object.keys(TEMPLATES), ...Object.keys(starters())];

export const INIT_USAGE = `Usage: init [<dir>] [--name <name>] [--template <name>] [--force]

  <dir>               the project directory, created when absent; default the current directory
  --name <name>       the application name in prism.toml; default the directory's name
  --template <name>   ${templateNames().join(', ')}; default ${DEFAULT_TEMPLATE}
  --force             overwrite files that already exist
`;

const VALUE_OPTIONS = ['name', 'template'];

function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (VALUE_OPTIONS.includes(key)) options[key] = eq > 0 ? a.slice(eq + 1) : argv[++i];
      else if (key === 'force' || key === 'help') options[key] = true;
      else if (key === 'sdk-image') return { error: 'init no longer takes --sdk-image: prism-code runs no SDK image; check, build and verify run in this process' };
      else return { error: `unknown option ${a}` };
    } else positional.push(a);
  }
  for (const key of VALUE_OPTIONS) if (Object.hasOwn(options, key) && (typeof options[key] !== 'string' || options[key] === '')) return { error: `--${key} takes a value` };
  if (positional.length > 1) return { error: 'init takes at most one directory' };
  return { positional, options };
}

/**
 * Run `init` with `argv` (the arguments after the verb). Writes to `out` and
 * `err` (`process.stdout`-like) and resolves to an exit code.
 */
export async function runInit(argv, { out = process.stdout, err = process.stderr, cwd = process.cwd() } = {}) {
  const parsed = parse(argv);
  if (parsed.error) {
    err.write(`${parsed.error}\n\n${INIT_USAGE}`);
    return 64;
  }
  const { positional, options } = parsed;
  if (options.help) {
    out.write(INIT_USAGE);
    return 0;
  }
  const shown = positional[0] ?? '.';
  const directory = resolve(cwd, shown);
  const name = options.name ?? nameFromDirectory(directory);
  const template = options.template ?? DEFAULT_TEMPLATE;

  // A starter is a Prism app: its module is the author's to edit, so it is never written over.
  if (Object.hasOwn(starters(), template)) {
    let made;
    try {
      made = startApp(directory, template);
    } catch (error) {
      if (!(error instanceof PrismCodeError)) throw error;
      err.write(`${error.code}: ${error.message}\n`);
      return 2;
    }
    const session = readSession(directory);
    session.starter = made.starter;
    session.status = {};
    writeSession(directory, session);
    out.write(`Creating ${name} in ${directory}\n  ${template} starter  src/${made.module}.lex.tex, the model to edit\n${nextSteps(shown)}`);
    return 0;
  }

  let files;
  try {
    files = planInit({ name, template });
  } catch (error) {
    if (!(error instanceof PrismCodeError)) throw error;
    err.write(`${error.code}: ${error.message}\n`);
    return 2;
  }
  if (!options.force) {
    const existing = [...files.keys()].filter((path) => existsSync(join(directory, path)));
    if (existing.length > 0) {
      err.write(`init.exists: ${existing.slice(0, 5).join(', ')}${existing.length > 5 ? ` and ${existing.length - 5} more` : ''} already exist in ${directory}; pass --force to overwrite\n`);
      return 2;
    }
  }

  out.write(`Creating ${name} in ${directory}\n`);
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  }
  out.write(`  prism.toml         application ${name} 0.1.0, no capabilities granted\n`);
  out.write(`  ${template} template  ${files.size - 2} files (model, lexicon, Lean workspace, lexlean.lock)\n`);
  out.write('  .gitattributes     * text eol=lf, because LexLean refuses a CRLF source\n');
  out.write(`${NOT_AN_APP}\n${nextSteps(shown)}`);
  return 0;
}
