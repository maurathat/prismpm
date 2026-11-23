/**
 * The `init` verb (issue #281), shared by `prism-code init` and the
 * `create-prism-code` scaffolder, so `npm create prism-code` and
 * `npx prism-code init` write the same project.
 *
 *   init [<dir>] [--name <name>] [--no-skill] [--force]
 *
 * `npx prism-code@latest init` is the one command a Prism app starts with. It
 * writes the canonical template, UOR-Foundation/template, which this package
 * carries and admits by BLAKE3 label (journey/template.mjs): the app's LexLean
 * model in `app/`, its registers in `model/`, its scenarios in
 * `features/suites/`, and the universal policy `check` holds it to. There is no
 * choice of template: every app, simple or complex, starts from the same one.
 * It also writes `prism.toml` naming the app, and the Prism skill, so an agent
 * in that folder knows the one path: check, build, verify. Run again in a folder
 * that holds a model, it leaves the model as it is and writes only the skill.
 *
 * Everything is written inside the folder: nothing here starts another program,
 * reaches the network or changes the machine.
 *
 * Exit codes: 0 scaffolded, 2 refused (a file exists, a bad name), 64 usage.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nameFromDirectory, nextSteps } from './init.mjs';
import { PrismCodeError } from './errors.mjs';
import { parseManifest } from './manifest.mjs';
import { sourceFiles } from './journey/project.mjs';
import { APP_FOLDER, canonicalTemplate, writeTemplate } from './journey/template.mjs';

/** Where the skill goes in a project: the folders agents read project skills from. */
export const SKILL_FOLDERS = Object.freeze(['.claude/skills/prism', '.agents/skills/prism']);

export const INIT_USAGE = `Usage: init [<dir>] [--name <name>] [--no-skill] [--force]

  <dir>               the project directory, created when absent; default the current directory
  --name <name>       the application name in prism.toml; default the directory's name
  --no-skill          do not write the Prism skill into ${SKILL_FOLDERS.join(' and ')}
  --force             overwrite files that already exist

Every app starts from the canonical template, UOR-Foundation/template, which this package carries.
`;

const VALUE_OPTIONS = ['name'];
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
      else if (key === 'template') return { error: 'init no longer takes --template: every app starts from the one canonical template' };
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

/** The app's prism.toml: named `name`, its model in the template's app, deny by default. Throws `manifest.invalid` for a name the manifest refuses. */
export function templateManifest(name) {
  const text = [
    '[application]',
    `name = ${JSON.stringify(name)}`,
    'version = "0.1.0"',
    'description = "A Prism application, started from the canonical template."',
    '',
    '[model]',
    `source = "${APP_FOLDER}/src"`,
    `watch = ["${APP_FOLDER}/src/**/*.lex.tex", "${APP_FOLDER}/language/**/*.toml", "${APP_FOLDER}/lexlean.toml", "model/**/*.toml", "features/**/*.feature"]`,
    '',
    '# Deny by default: an empty set grants the holo nothing.',
    '[capabilities]',
    '',
  ].join('\n');
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
  const skill = async () => {
    if (options['no-skill']) return;
    for (const folder of await writeSkill(directory)) out.write(`  ${folder.padEnd(22)} the Prism skill, for the agent that works here\n`);
  };

  // A folder that already holds a model keeps it: init then only writes the skill, so it is safe to run again.
  const held = sourceFiles(join(directory, APP_FOLDER)).length > 0 || sourceFiles(directory).length > 0;
  if (held && !options.force) {
    out.write(`${name} in ${directory}\n  a LexLean model is here already; left as it is\n`);
    await skill();
    out.write(nextSteps(shown));
    return 0;
  }
  let made;
  let manifest;
  try {
    manifest = templateManifest(name);
    if (existsSync(join(directory, 'prism.toml')) && !options.force) throw new PrismCodeError('init.exists', `prism.toml already exists in ${directory}; pass --force to overwrite`);
    made = writeTemplate(directory, { force: options.force === true });
  } catch (error) {
    if (!(error instanceof PrismCodeError)) throw error;
    err.write(`${error.code}: ${error.message}\n`);
    return 2;
  }
  writeFileSync(join(directory, 'prism.toml'), manifest);
  const template = canonicalTemplate();
  out.write(`Creating ${name} in ${directory}\n`);
  out.write(`  prism.toml             application ${name} 0.1.0, no capabilities granted\n`);
  out.write(`  the canonical template ${made.written.length + made.kept.length} files of ${template.repository}, ${made.label}\n`);
  out.write(`  ${`${APP_FOLDER}/src/`.padEnd(22)} the model to edit: replace the template's contract checker with your app\n`);
  out.write(`  ${''.padEnd(22)} until then, build names the holo for the template's app: template-contract.holo\n`);
  await skill();
  out.write(nextSteps(shown));
  return 0;
}
