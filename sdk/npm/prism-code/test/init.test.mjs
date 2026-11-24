// prism-code init (issue #281): a scaffolded project, the SDK binding commands, and the CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, DEFAULT_TEMPLATE, templateFiles, manifestText, nameFromDirectory, nextSteps, planInit } from '../src/init.mjs';
import { parseManifest } from '../src/manifest.mjs';
import { parseToml } from '../src/toml.mjs';
import { readManifest } from '../src/node.mjs';
import { canonicalTemplate } from '../src/journey/template.mjs';
import { kappa } from '../src/blake3.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const createBin = fileURLToPath(new URL('../../create-prism-code/bin/create-prism-code.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const scratch = () => mkdtempSync(join(tmpdir(), 'prism-init-'));
const run = (file, args, options = {}) => {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', ...options });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const walk = (root, dir = root, out = []) => {
  for (const e of readdirSync(dir).sort()) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(root, f, out);
    else out.push(relative(root, f).split(sep).join('/'));
  }
  return out;
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('each template is its fixture, byte for byte, so the gate that checks the fixture vouches for the template', () => {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    const origin = join(REPO, template.origin);
    const files = templateFiles(name);
    assert.deepEqual([...files.keys()].sort(), walk(origin).sort(), name);
    for (const [path, bytes] of files) assert.equal(Buffer.from(bytes).toString('utf8'), readFileSync(join(origin, path), 'utf8').replaceAll('\r\n', '\n'), `${name}/${path}`);
  }
  const sync = run(fileURLToPath(new URL('../scripts/sync-templates.mjs', import.meta.url)), ['--check']);
  assert.equal(sync.code, 0, sync.err);
});

test('the template lexlean.lock binds the template bytes it ships with', () => {
  const files = templateFiles(DEFAULT_TEMPLATE);
  // The lock has arrays of tables, which the manifest's strict TOML reader refuses by design; its head is plain keys.
  const text = Buffer.from(files.get('lexlean.lock')).toString('utf8');
  const lock = parseToml(text.slice(0, text.indexOf('[[')));
  assert.equal(lock.spec, 'lexlean/lock/2');
  assert.equal(lock.language, '1.2');
  const pins = [...text.matchAll(/\[\[workspace_file\]\]\npath = "([^"]+)"\nsha256 = "([0-9a-f]{64})"/g)];
  assert.ok(pins.length >= 3);
  for (const [, path, digest] of pins) assert.equal(sha256(files.get(path)), digest, path);
  assert.equal(sha256(files.get('lexlean.toml')), lock.project_config_sha256);
});

test('the generated prism.toml is a valid manifest that grants nothing', () => {
  const text = manifestText('calculator');
  const { manifest, warnings } = parseManifest(text);
  assert.deepEqual(warnings, []);
  assert.equal(manifest.application.name, 'calculator');
  assert.equal(manifest.application.version, '0.1.0');
  assert.equal(manifest.model.source, 'src');
  assert.deepEqual(manifest.capabilities, {});
  assert.throws(() => manifestText('Calculator'), (e) => e.code === 'manifest.invalid');
});

test('a project name comes from the directory', () => {
  assert.equal(nameFromDirectory('/home/me/My Calculator'), 'my-calculator');
  assert.equal(nameFromDirectory('C:\\work\\2026_app\\'), 'app');
  assert.equal(nameFromDirectory('/'), 'app');
  assert.equal(nameFromDirectory('/x/' + 'a'.repeat(80)), 'a'.repeat(63));
});

test('planInit is the template plus prism.toml and an LF-only .gitattributes; an unknown template is refused', () => {
  const files = planInit({ name: 'calc' });
  assert.ok(files.has('prism.toml') && files.has('lexlean.lock') && files.has('prismpm.toml') && files.has('src/TextRequest.lex.tex'));
  assert.equal(files.size, templateFiles().size + 2);
  assert.equal(Buffer.from(files.get('.gitattributes')).toString('utf8'), '* text=auto eol=lf\n', 'LexLean refuses CRLF, so a new project never gets it');
  // The scaffold names the gates that follow, each run in this process.
  const steps = nextSteps('calc').split('\n');
  assert.match(steps[0], /every step in this process/);
  // Each names the version that wrote the project, so a stale copy npx kept is never the one that runs.
  assert.ok(steps.some((s) => /prism-code@\d+\.\d+\.\d+ check --json/.test(s)) && steps.some((s) => /prism-code@\d+\.\d+\.\d+ verify --json/.test(s)) && steps.some((s) => /prism-code@\d+\.\d+\.\d+ run /.test(s)));
  assert.ok(steps.includes('  cd calc'));
  assert.throws(() => planInit({ name: 'calc', template: 'nope' }), (e) => e.code === 'init.template' && /text-request/.test(e.message));
});

test('prism-code init scaffolds a project that prism-code manifest reads', async () => {
  const dir = join(scratch(), 'my-calc');
  const r = run(bin, ['init', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Creating my-calc in /);
  assert.match(r.out, /the canonical template/);
  assert.doesNotMatch(r.out, /SDK|setup/);
  const { files } = canonicalTemplate();
  assert.equal(kappa(new Uint8Array(readFileSync(join(dir, 'app', 'lexlean.lock')))), files['app/lexlean.lock'], 'the lock is the template\'s, byte for byte');
  assert.ok(!existsSync(join(dir, 'prismpm.lock')), 'init binds no SDK image');
  const { manifest, grant } = await readManifest(dir);
  assert.equal(manifest.application.name, 'my-calc');
  assert.deepEqual(grant.capabilities.sets.default, {});
  assert.equal(run(bin, ['manifest', dir]).code, 0);
});

test('init refuses to overwrite, names the files, and --force overwrites', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'prism.toml'), 'keep');
  const r = run(bin, ['init', dir]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^init\.exists: .*prism\.toml.* already exist/);
  assert.equal(readFileSync(join(dir, 'prism.toml'), 'utf8'), 'keep');
  assert.equal(run(bin, ['init', dir, '--force']).code, 0);
  assert.notEqual(readFileSync(join(dir, 'prism.toml'), 'utf8'), 'keep');
});

test('init: --name, a bad name, an unknown template, usage errors', () => {
  const dir = scratch();
  assert.equal(run(bin, ['init', join(dir, 'a'), '--name', 'calculator']).code, 0);
  assert.match(readFileSync(join(dir, 'a', 'prism.toml'), 'utf8'), /name = "calculator"/);
  const bad = run(bin, ['init', join(dir, 'b'), '--name', 'Bad Name']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /^manifest\.invalid: application\.name/);
  const choice = run(bin, ['init', join(dir, 'c'), '--template', 'rule-app']);
  assert.equal(choice.code, 64, 'there is no choice of template');
  assert.match(choice.err, /^init no longer takes --template: every app starts from the one canonical template/);
  const gone = run(bin, ['init', join(dir, 'd'), '--sdk-image', 'x']);
  assert.equal(gone.code, 64);
  assert.match(gone.err, /^init no longer takes --sdk-image/);
  assert.equal(run(bin, ['init', 'a', 'b']).code, 64);
  assert.equal(run(bin, ['init', '--frobnicate']).code, 64);
  assert.ok(run(bin, ['init', '--help']).out.includes('Writes the canonical template, UOR-Foundation/template'));
});

test('one entry point: every page a user starts from names npx prism-code@latest init, and none starts an app another way', () => {
  const at = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const pages = { README: at('../README.md'), guide: at('../docs/guide.md'), skill: at('../skill/SKILL.md'), create: at('../../create-prism-code/README.md') };
  for (const [name, text] of Object.entries(pages)) {
    assert.match(text, /npx prism-code@latest init/, `${name} names the entry point`);
    // A bare `npx prism-code init` runs whichever version npx last kept; no page shows it as the way to start.
    assert.doesNotMatch(text, /npx prism-code init\b/, `${name} shows the entry point without @latest`);
    assert.doesNotMatch(text, /--template [a-z]/, `${name} offers a choice of template`);
  }
  // npm create is named only as the same command under another name, never as a different start.
  for (const name of ['README', 'guide', 'create']) assert.match(pages[name], /npm create prism-code[^\n]*\n?[^\n]*(same code|same command|same files)/, name);
  // The command's own help and the steps it prints say the same.
  assert.match(run(bin, ['init', '--help']).out, /the one command it begins with: npx prism-code@latest init/);
  assert.match(JSON.parse(run(bin, ['check', '--json'], { cwd: scratch() }).out).diagnostics[0].remediation, /npx prism-code@latest init/);
});

test('npm create prism-code is prism-code init', () => {
  const root = scratch();
  const viaCreate = run(createBin, ['proj', '--name', 'same'], { cwd: root });
  assert.equal(viaCreate.code, 0, viaCreate.err);
  mkdirSync(join(root, 'other'));
  assert.equal(run(bin, ['init', 'proj2', '--name', 'same'], { cwd: root }).code, 0);
  const a = walk(join(root, 'proj'));
  assert.deepEqual(a, walk(join(root, 'proj2')));
  // Every file is the same bytes, but the one that is each project's own: its ID, which init makes from random bytes.
  for (const path of a.filter((p) => p !== 'prism.project')) assert.ok(readFileSync(join(root, 'proj', path)).equals(readFileSync(join(root, 'proj2', path))), path);
  const ids = ['proj', 'proj2'].map((p) => /^id = "([0-9a-f]{64})"$/m.exec(readFileSync(join(root, p, 'prism.project'), 'utf8'))?.[1]);
  assert.ok(ids[0] && ids[1] && ids[0] !== ids[1], 'each project has an ID of its own');
});


test('init is the one command an app starts with: the canonical template, named for the folder, and the skill beside it', () => {
  const dir = join(scratch(), 'fee-tier');
  const r = run(bin, ['init', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /the canonical template \d+ files of UOR-Foundation\/template, blake3:[0-9a-f]{64}/);
  assert.match(readFileSync(join(dir, 'prism.toml'), 'utf8'), /^name = "fee-tier"$/m);
  assert.ok(existsSync(join(dir, 'app', 'src', 'Contract.lex.tex')));
  for (const folder of ['.claude/skills/prism', '.agents/skills/prism']) {
    for (const f of ['SKILL.md', 'references/lexlean-1.2.md', 'references/template-contract.md']) {
      assert.ok(readFileSync(join(dir, folder, f)).equals(readFileSync(new URL(`../skill/${f}`, import.meta.url))), `${folder}/${f}`);
    }
  }
  // Nothing is written outside the folder, and nothing of the machine is configured.
  assert.doesNotMatch(r.out + r.err, /setup|server|registered/i);

  // Run again, the model is the author's: it is left as it is, and only the skill is written.
  const model = join(dir, 'app', 'src', 'Contract.lex.tex');
  writeFileSync(model, `${readFileSync(model, 'utf8')}\n`);
  const edited = readFileSync(model);
  const again = run(bin, ['init', dir]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /a LexLean model is here already; left as it is/);
  assert.ok(readFileSync(model).equals(edited));

  const bare = join(scratch(), 'bare');
  assert.equal(run(bin, ['init', bare, '--no-skill']).code, 0);
  assert.equal(existsSync(join(bare, '.claude')), false);
  assert.equal(run(bin, ['setup']).code, 64, 'setup is not a verb: init is the one command');
});
