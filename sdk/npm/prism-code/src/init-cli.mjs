/**
 * The `init` verb (issue #281), shared by `prism-code init` and the
 * `create-prism-code` scaffolder, so `npm create prism-code` and
 * `npx prism-code init` write the same project.
 *
 *   init [<dir>] [--name <name>] [--template <name>] [--no-skill] [--force]
 *
 * `npx prism-code@latest init` is the one command a Prism app starts with. It
 * writes a starter, which is a working LexLean model to edit, and the Prism
 * skill beside it, so an agent in that folder knows the one path: check, build,
 * verify. Run again in a folder that holds a model, it leaves the model as it
 * is and writes only the skill.
 *
 * A starter (rule-app, decision-app, stateful-app) is a Prism app. A template
 * (text-request) is a plain LexLean project copied byte for byte. Everything is
 * written inside the folder: nothing here starts another program, reaches the
 * network or changes the machine.
 *
 * Exit codes: 0 scaffolded, 2 refused (a file exists, a bad name), 64 usage.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NOT_AN_APP, TEMPLATES, nameFromDirectory, nextSteps, planInit } from './init.mjs';
import { PrismCodeError } from './errors.mjs';
import { parseManifest } from './manifest.mjs';
import { readSession, sourceFiles, startApp, starters, writeSession } from './journey/project.mjs';

/** What `init` writes when no template is named: the simplest starter that proves and builds. */
export const DEFAULT_STARTER = 'rule-app';

/** Where the skill goes in a project: the folders agents read project skills from. */
export const SKILL_FOLDERS = Object.freeze(['.claude/skills/prism', '.agents/skills/prism']);

/** Every name `--template` takes: the starters, then the templates. */
export const templateNames = () => [...Object.keys(starters()), ...Object.keys(TEMPLATES)];

export const INIT_USAGE = `Usage: init [<dir>] [--name <name>] [--template <name>] [--no-skill] [--force]

  <dir>               the project directory, created when absent; default the current directory
  --name <name>       the application name in prism.toml; default the directory's name
  --template <name>   ${templateNames().join(', ')}; default ${DEFAULT_STARTER}
  --no-skill          do not write the Prism skill into ${SKILL_FOLDERS.join(' and ')}
  --force             overwrite files that already exist
`;

const VALUE_OPTIONS = ['name', 'template'];
const FLAGS = ['force', 'help', 'no-skill'];

function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (VALUE_OPTIONS.includes(key)) options[key] = eq > 0 ? a.slice(eq + 1) : argv[++i];
      else if (FLAGS.includes(key)) options[key] = true;
      else if (key === 'sdk-image') return { error: 'init no longer takes --sdk-image: prism-code runs no SDK image; check, build and verify run in this process' };
      else return { error: `unknown option ${a}` };
    } else positional.push(a);
  }
  for (const key of VALUE_OPTIONS) if (Object.hasOwn(options, key) && (typeof options[key] !== 'string' || options[key] === '')) return { error: `--${key} takes a value` };
  if (positional.length > 1) return { error: 'init takes at most one directory' };
  return { positional, options };
}

/** Write the skill this package ships into the project's skill folders. Returns the folders written. */
async function writeSkill(directory) {
  const { copySkill } = await import('./skills.mjs');
  return SKILL_FOLDERS.map((folder) => {
    copySkill(join(directory, ...folder.split('/')));
    return folder;
  });
}

/** A starter's prism.toml with the application named `name`. Throws `manifest.invalid` for a name the manifest refuses. */
function starterManifest(template, name) {
  const original = readFileSync(new URL(`../templates/starters/${template}/prism.toml`, import.meta.url), 'utf8');
  const text = original.replace(/^name = "[^"\n]*"$/m, `name = ${JSON.stringify(name)}`);
  parseManifest(text);
  return text;
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
  const template = options.template ?? DEFAULT_STARTER;
  const skill = async () => {
    if (options['no-skill']) return;
    for (const folder of await writeSkill(directory)) out.write(`  ${folder.padEnd(22)} the Prism skill, for the agent that works here\n`);
  };

  // A starter is a Prism app: its module is the author's to edit, so it is never written over.
  if (Object.hasOwn(starters(), template)) {
    // A folder that already holds a model keeps it: init then only writes the skill, so it is safe to run again.
    if (sourceFiles(directory).length > 0 && !options.force) {
      out.write(`${name} in ${directory}\n  src/                   holds a LexLean model already; left as it is\n`);
      await skill();
      out.write(nextSteps(shown));
      return 0;
    }
    let made;
    try {
      const manifest = starterManifest(template, name);
      const existing = Object.keys(starters()[template].files).filter((path) => existsSync(join(directory, path)));
      if (existing.length > 0 && !options.force) {
        err.write(`init.exists: ${existing.slice(0, 5).join(', ')}${existing.length > 5 ? ` and ${existing.length - 5} more` : ''} already exist in ${directory}; pass --force to overwrite\n`);
        return 2;
      }
      made = startApp(directory, template);
      writeFileSync(join(directory, 'prism.toml'), manifest);
    } catch (error) {
      if (!(error instanceof PrismCodeError)) throw error;
      err.write(`${error.code}: ${error.message}\n`);
      return 2;
    }
    const session = readSession(directory);
    session.starter = made.starter;
    session.status = {};
    writeSession(directory, session);
    out.write(`Creating ${name} in ${directory}\n`);
    out.write(`  prism.toml             application ${name} 0.1.0, no capabilities granted\n`);
    out.write(`  src/${made.module}.lex.tex`.padEnd(25) + `the ${template} starter: the model to edit\n`);
    await skill();
    out.write(nextSteps(shown));
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
  out.write(`  prism.toml             application ${name} 0.1.0, no capabilities granted\n`);
  out.write(`  ${template} template  ${files.size - 2} files (model, lexicon, Lean workspace, lexlean.lock)\n`);
  out.write('  .gitattributes         * text eol=lf, because LexLean refuses a CRLF source\n');
  await skill();
  out.write(`${NOT_AN_APP}\n${nextSteps(shown)}`);
  return 0;
}
