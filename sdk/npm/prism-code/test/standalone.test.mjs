// prism-code stands alone: it is the only dependency of a Prism app. These tests hold the package to that.
//
//   1. No coupling is left: no hosted verifier, no server of its own, no cloud build, no URL handler, and no code that
//      starts a container program. The verbs that reached them are gone.
//   2. init, manifest, check, build and verify run a project from nothing to a verified app in this process, fetching
//      nothing, for a standalone app and for a workspace whose model is in app/.
//
// The second part runs on a home directory that holds nothing, with fetching off: LexLean and Lean's kernel are the
// copies the package ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession, startApp, writeSession } from '../src/journey/project.mjs';
import { kappa } from '../src/blake3.mjs';

const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const bin = join(PACKAGE, 'bin', 'prism-code.mjs');
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-standalone-'));

/** Every file under a package folder, as a path relative to the package, forward slashes. */
function filesUnder(folder) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(relative(PACKAGE, full).split(sep).join('/'));
    }
  };
  visit(join(PACKAGE, folder));
  return out;
}

// What the package ships and runs. The vendored verifier and spec are generated from other packages, and name nothing here.
const SHIPPED = ['bin', 'src', 'skill'].flatMap(filesUnder).filter((f) => !f.startsWith('src/vendor/') && /\.(mjs|js|json|md|toml|tex|sh)$/.test(f));
const text = (file) => readFileSync(join(PACKAGE, file), 'utf8');

test('nothing shipped names the hosted verifier, a server tool, a cloud build or the URL handler', () => {
  const forbidden = [
    ['the hosted verifier', /mcp\.uor\.foundation/],
    ['a retired server tool', /prism_start/],
    ['a cloud build dispatch', /gh workflow/],
    ['the URL handler', /holo:\/\//],
    ['an agent configuration file', /\.mcp\.json|\.claude\.json/],
  ];
  const found = [];
  for (const file of SHIPPED) {
    const body = text(file);
    for (const [what, pattern] of forbidden) if (pattern.test(body)) found.push(`${file}: ${what}`);
  }
  assert.deepEqual(found, []);
});

// Where the word may stay, and why: Docker Hub's host names, the registry logins a user already has, and three public
// names of the client. Everywhere else in what ships, it does not appear at all.
const REGISTRY_CODE = ['src/oci-auth.mjs', 'src/oci-registry.mjs', 'src/auth.mjs', 'src/node.mjs', 'src/index.mjs', 'src/images-namespace.mjs', 'src/push-pull.mjs', 'src/cli/auth.mjs'];

test('the word docker appears nowhere in what ships, outside the registry code that needs it', () => {
  const found = [];
  for (const file of SHIPPED) {
    if (REGISTRY_CODE.includes(file)) continue;
    text(file).split('\n').forEach((line, index) => {
      if (/docker/i.test(line)) found.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(found, []);
  for (const file of REGISTRY_CODE) assert.ok(SHIPPED.includes(file), `${file} is listed and no longer ships; take it off the list`);
});

test('no shipped code starts a container program, and the modules that did are gone', () => {
  const starts = [];
  for (const file of SHIPPED.filter((f) => f.endsWith('.mjs'))) {
    const body = text(file);
    // A program started by name, or the variable that named where to find it.
    if (/spawn(?:Sync)?\(\s*['"`]docker['"`]/.test(body) || /PRISM_DOCKER\b/.test(body) || /['"`]docker['"`],\s*\[/.test(body)) starts.push(file);
  }
  assert.deepEqual(starts, []);
  for (const gone of ['docker', 'host', 'hosted', 'github', 'remote-github', 'setup', 'setup-cli', 'setup-machine', 'open', 'handler', 'agents', 'axioms', 'journey/mcp', 'journey/github']) {
    assert.equal(existsSync(join(PACKAGE, 'src', `${gone}.mjs`)), false, `src/${gone}.mjs`);
  }
});

test('the package has no runtime dependency', () => {
  const manifest = JSON.parse(text('package.json'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.engines.node, '>=22');
});

const run = (args, { cwd, env = {} } = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', timeout: 240000, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

test('setup, mcp and open are not verbs, and the model verbs refuse the flags that named another machine', () => {
  const cwd = scratch();
  for (const verb of ['setup', 'mcp', 'open', 'axioms', 'conformance']) {
    const r = run([verb], { cwd });
    assert.equal(r.code, 64, verb);
    assert.match(r.err, new RegExp(`^unknown command ${verb}`), verb);
  }
  const help = run(['--help'], { cwd }).out;
  for (const verb of ['init', 'manifest', 'check', 'build', 'verify', 'vectors', 'generate', 'skill']) assert.match(help, new RegExp(`^  prism-code ${verb} `, 'm'), verb);
  assert.doesNotMatch(help, /prism-code (setup|mcp|open) /);
  for (const flag of ['--local', '--hosted', '--remote=github']) {
    for (const verb of ['check', 'build', 'verify']) {
      const r = run([verb, flag], { cwd });
      assert.equal(r.code, 64, `${verb} ${flag}`);
      assert.match(r.err, new RegExp(`^${verb} no longer takes ${flag.split('=')[0]}`), `${verb} ${flag}`);
    }
  }
});

test('skill --out writes the skill into a project folder, the same bytes the package ships', () => {
  const out = join(scratch(), '.claude', 'skills', 'prism');
  const r = run(['skill', '--out', out]);
  assert.equal(r.code, 0, r.err);
  for (const f of ['SKILL.md', 'references/lexlean-1.2.md', 'references/template-contract.md']) {
    assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(PACKAGE, 'skill', f))), f);
  }
  assert.equal(run(['skill']).code, 64, 'skill never writes to a default place');
});

test('the report of a model verb is one JSON object, and a folder with no project is refused with exit 2', () => {
  const cwd = scratch();
  for (const verb of ['check', 'build', 'verify']) {
    const r = run([verb, '--json'], { cwd });
    assert.equal(r.code, 2, verb);
    const report = JSON.parse(r.out);
    assert.deepEqual(Object.keys(report), ['schema', 'ok', 'command', 'durationMs', 'summary', 'diagnostics']);
    assert.deepEqual([report.schema, report.ok, report.command], ['prism/report/1', false, verb === 'build' ? 'build' : verb]);
    assert.deepEqual(Object.keys(report.diagnostics[0]), ['code', 'severity', 'file', 'line', 'column', 'message', 'remediation']);
    assert.equal(report.diagnostics[0].code, 'tier.project');
  }
  // A manifest that fails its checks is exit 2, before the model is read.
  writeFileSync(join(cwd, 'prism.toml'), '[application]\nname = "Bad Name"\nversion = "0.1.0"\n');
  const bad = run(['check', '--json'], { cwd });
  assert.equal(bad.code, 2);
  assert.equal(JSON.parse(bad.out).diagnostics[0].file, 'prism.toml');
});

// Nothing is fetched and nothing is sent, on a machine that holds nothing: a new, empty PRISM_HOME for every run.
const OFFLINE = { PRISM_CODE_TIER: 'offline', PRISM_LEXLEAN_FETCH: '0', PRISM_TELEMETRY: '0', PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-standalone-home-')) };
const absent = (report) => report.diagnostics.find((d) => d.code === 'build.frontend-unavailable' || d.code === 'kernel.unavailable');

/** init, manifest, check, build and verify, in `root`, where the model is in `model` (a path under root). */
// From an empty folder: `init`, which writes the canonical template with its model in app/, or a starter fixture
// (test/fixtures/starters), which init no longer offers and whose routes the IDE's own tables still take.
function journey(t, { starter = null, model = 'app' } = {}) {
  const root = scratch();
  const at = model === '.' ? root : join(root, model);
  if (starter) {
    startApp(at, starter);
    // The session says which starter the app came from: a rule app is built as its rule judge.
    writeSession(at, { ...readSession(at), starter, status: {} });
    writeFileSync(join(at, 'prism.toml'), readFileSync(new URL(`./fixtures/starters/${starter}/prism.toml`, import.meta.url)));
  } else {
    const init = run(['init', root], { cwd: root });
    assert.equal(init.code, 0, init.err);
  }

  const probe = JSON.parse(run(['check', '--json'], { cwd: root, env: OFFLINE }).out);
  assert.equal(absent(probe), undefined, 'the package ships LexLean and the kernel, so neither is ever missing');

  if (model === '.' || !starter) assert.equal(run(['manifest', '--json'], { cwd: root, env: OFFLINE }).code, 0);

  const check = run(['check', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(check.code, 0, check.out);
  const checked = JSON.parse(check.out);
  assert.equal(checked.ok, true);
  assert.ok(checked.summary.modulesChecked > 0);
  assert.ok(checked.summary.theoremsDeclared > 0, 'a starter states at least one guarantee');
  assert.equal(checked.summary.theoremsVerified, checked.summary.theoremsDeclared);
  assert.equal(existsSync(join(at, '.prism', 'build')), false, 'check writes nothing it built');

  // Before a build there is nothing to verify, and verify says so.
  const early = run(['verify', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(early.code, 1);
  assert.equal(JSON.parse(early.out).diagnostics.at(-1).code, 'verify.unbuilt');

  const out = join(root, 'dist');
  const build = run(['build', '--out', out, '--json'], { cwd: root, env: OFFLINE });
  assert.equal(build.code, 0, build.out);
  const built = JSON.parse(build.out);
  assert.ok(built.summary.vectorsTotal > 0);
  assert.equal(built.summary.vectorsPassed, built.summary.vectorsTotal);
  assert.match(built.summary.address, /^(blake3|sha256):[0-9a-f]{64}$/);
  assert.equal(readdirSync(out).length, 1, '--out holds what was built');

  const verify = run(['verify', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(verify.code, 0, verify.out);
  const verified = JSON.parse(verify.out);
  assert.deepEqual([verified.ok, verified.summary.identitiesVerified, verified.summary.vectorsPassed], [true, true, built.summary.vectorsTotal]);
  assert.equal(verified.summary.theoremsVerified, verified.summary.theoremsDeclared);

  // inspect reads what was built without running it, whatever built it.
  if (existsSync(join(at, '.prism', 'build')) && readdirSync(out)[0].endsWith('.holo')) {
    const inspected = run(['inspect', join(out, readdirSync(out)[0])], { cwd: root, env: OFFLINE });
    assert.equal(inspected.code, 0, inspected.err);
    assert.match(inspected.out, /^Verification:\n {2}Footer: +ok$/m);
    // generate writes a client for it too: the model's digests come from the archive, and a name of several words is a class name.
    const client = join(dirname(out), 'client');
    const generated = run(['generate', join(out, readdirSync(out)[0]), '--out', client], { cwd: root, env: OFFLINE });
    assert.equal(generated.code, 0, generated.err);
    assert.equal(readdirSync(client).some((name) => name.endsWith('.d.ts')), true, 'generate wrote typed bindings');
  }

  // What --out holds verifies on its own, as a holo from anywhere does.
  const alone = run(['verify', join(out, readdirSync(out)[0]), '--json'], { cwd: root, env: OFFLINE });
  assert.equal(alone.code, 0, alone.out);

  // run of the project runs what was built, which no signature covers: the build proved it and replayed it here.
  if (readdirSync(out)[0].endsWith('.holo')) {
    const ran = run(['run', '--input', 'x', '--rm'], { cwd: root, env: OFFLINE });
    assert.match(ran.err, /the build of the model as it is on disk/, ran.err);
    assert.doesNotMatch(ran.err, /run refused|no verdict/, ran.err);
    const named = run(['run', root, 'x', '--rm'], { cwd: scratch(), env: OFFLINE });
    assert.doesNotMatch(named.err, /run refused|no verdict/, named.err);
    // The same holo named as a file is a holo from anywhere. It carries its proof record, so the one who runs it
    // proves it again, here, and then runs it: no signature, and no word of the builder's.
    const foreign = run(['run', join(out, readdirSync(out)[0]), 'x', '--rm'], { cwd: scratch(), env: OFFLINE });
    assert.match(foreign.err, /proved again here: \d+ theorems? by Lean's kernel/, foreign.err);
    assert.doesNotMatch(foreign.err, /run refused|no verdict/, foreign.err);
    // A holo that carries no proof record is not proved here, and the default policy refuses it as before.
    const bare = run(['run', join(PACKAGE, 'fixtures', 'Calculator.holo'), 'x', '--rm'], { cwd: scratch(), env: OFFLINE });
    assert.equal(bare.code, 1, bare.err);
    assert.match(bare.err, /run refused/);
    assert.doesNotMatch(bare.err, /proved again here/);
    // A project is judged by its build, so the flags that judge a holo do not go with it.
    assert.equal(run(['run', '--input', 'x', '--allow-unverified'], { cwd: root, env: OFFLINE }).code, 64);
  }

  // An edit to the model makes what is built stale: verify refuses it until it is built again.
  const source = readdirSync(join(at, 'src')).filter((f) => f.endsWith('.lex.tex'))[0];
  writeFileSync(join(at, 'src', source), `${readFileSync(join(at, 'src', source), 'utf8')}\n`);
  const stale = JSON.parse(run(['verify', '--json'], { cwd: root, env: OFFLINE }).out);
  assert.equal(stale.ok, false);
  return undefined;
}

test('in a template workspace, check runs the contract ratchet: a kept contract passes and a broken one is exit 1', { timeout: 600000 }, () => {
  const root = scratch();
  assert.equal(run(['init', root, '--no-skill']).code, 0);
  const write = (path, body) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  // The template as init writes it keeps its own contract: two IDs, each proved, one of them a refusal.
  const kept = run(['check', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(kept.code, 0, kept.out);
  const report = JSON.parse(kept.out);
  assert.deepEqual([report.summary.spec, report.summary.idsRegistered, report.summary.scenarios, report.summary.contractViolations], ['template/2', 2, 2, 0]);
  assert.ok(report.summary.lexiconEntriesBound > 0, 'the template binds its lexicon');

  // A scenario for an ID nobody registered: the model still proves, and the gate fails on the contract alone.
  write('features/suites/extra.feature', 'Feature: extra\n\n  @TC-09 @build\n  Scenario: Not registered.\n    Given nothing\n');
  const broken = run(['check', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(broken.code, 1, broken.out);
  const refused = JSON.parse(broken.out);
  assert.equal(refused.summary.theoremsVerified, refused.summary.theoremsDeclared);
  assert.deepEqual(refused.diagnostics.map((d) => [d.code, d.id, d.file, d.line]), [['contract.unregistered', 'TC-09', 'features/suites/extra.feature', 3]]);
  assert.equal(run(['build', '--json'], { cwd: root, env: OFFLINE }).code, 1, 'build stops at a broken contract');
});

test('a standalone app goes from init to a verified build in this process, fetching nothing', { timeout: 600000 }, (t) => journey(t));

test('a rule app does the same: its guarantees are proved, and its vectors pass through the rule judge', { timeout: 600000 }, (t) => journey(t, { starter: 'rule-app', model: '.' }));

test('a workspace whose model is in app/ is found from its root and does the same', { timeout: 600000 }, (t) => journey(t, { starter: 'stateful-app', model: 'app' }));

test('R6: a lockfile whose digest is not the project\'s is refused by check, by LexLean\'s own code', { timeout: 600000 }, () => {
  const root = scratch();
  assert.equal(run(['init', root, '--no-skill']).code, 0);
  const lock = join(root, 'app', 'lexlean.lock');
  const text = readFileSync(lock, 'utf8');
  const at = text.indexOf('project_config_sha256 = "') + 'project_config_sha256 = "'.length;
  assert.ok(at > 30, 'the lock records the digest of the project file');
  // One hex digit of the recorded digest is changed: the lock no longer names the bytes on disk.
  writeFileSync(lock, `${text.slice(0, at)}${text[at] === '0' ? '1' : '0'}${text.slice(at + 1)}`);
  const refused = run(['check', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(refused.code, 2, refused.out);
  const report = JSON.parse(refused.out);
  assert.equal(report.ok, false);
  assert.deepEqual([report.diagnostics[0].code, report.diagnostics[0].file], ['LLC0102', 'lexlean.lock']);
  assert.equal(report.summary.theoremsVerified, 0, 'nothing is proved from a model whose lock is not its own');
});

// init is the one entry point, so an app of either kind must go from it to a running holo under its own module names:
// the template's entrypoint, src/Contract.lex.tex, is then gone, and the lock that pins lexlean.toml stays as it is.
for (const [starter, theorem, input] of [['decision-app', 'ParkingFeeTierProofs.inv001Holds', '0 car'], ['stateful-app', 'DinnerSeatsProofs.startInBounds', 'x']]) {
  test(`init, then a ${starter} model under its own module names: check, build, verify and run`, { timeout: 600000 }, () => {
    const root = scratch();
    assert.equal(run(['init', root], { cwd: root }).code, 0);
    const src = join(root, 'app', 'src');
    rmSync(join(src, 'Contract.lex.tex'));
    const from = new URL(`./fixtures/starters/${starter}/src/`, import.meta.url);
    for (const file of readdirSync(from)) writeFileSync(join(src, file), readFileSync(new URL(file, from)));
    // The registers name the app's own guarantee in place of the template's two.
    const ids = readFileSync(join(root, 'model', 'ids.toml'), 'utf8');
    writeFileSync(join(root, 'model', 'ids.toml'), `${ids.slice(0, ids.indexOf('[[id]]'))}[[id]]\nid = "AP-01"\nlevel = "build"\nsuite = "app"\nstatement = "The first guarantee holds"\ntheorems = ["${theorem}"]\n`);
    rmSync(join(root, 'features', 'suites', 'contract.feature'));
    writeFileSync(join(root, 'features', 'suites', 'app.feature'), 'Feature: app\n\n  @AP-01 @build\n  Scenario: The first guarantee holds\n    Given the model in app/src\n    When prism-code check has the kernel prove it\n    Then it holds\n');
    const build = run(['build', '--json'], { cwd: root, env: OFFLINE });
    assert.equal(build.code, 0, build.out + build.err);
    const built = JSON.parse(build.out).summary;
    assert.ok(built.theoremsDeclared > 0 && built.theoremsVerified === built.theoremsDeclared && built.vectorsPassed === built.vectorsTotal && built.vectorsTotal > 0);
    assert.doesNotMatch(built.artifact, /template-contract/, 'the holo is named for the app, not the template');
    // The app's address is its UOR content address: the BLAKE3 kappa-label of the holo's bytes, and nothing else.
    assert.match(built.address, /^blake3:[0-9a-f]{64}$/);
    assert.equal(built.address, kappa(new Uint8Array(readFileSync(join(root, built.artifact)))));
    const verify = run(['verify', '--json'], { cwd: root, env: OFFLINE });
    assert.equal(verify.code, 0, verify.out);
    const ran = run(['run', '--input', input, '--rm'], { cwd: root, env: OFFLINE });
    assert.equal(ran.code, 0, ran.err);
    assert.doesNotMatch(ran.err, /run refused|no verdict/, ran.err);
    assert.ok(ran.out.length > 0, 'the app answered');
  });
}

test('init gives each project an ID of its own, keeps it, and no build reads it', { timeout: 600000 }, () => {
  const idOf = (root) => /^id = "([0-9a-f]{64})"$/m.exec(readFileSync(join(root, 'prism.project'), 'utf8'))?.[1];
  const [one, two] = [join(scratch(), 'app'), join(scratch(), 'app')];
  for (const root of [one, two]) {
    mkdirSync(root);
    const init = run(['init', root], { cwd: root });
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /prism\.project +a new project ID/);
  }
  // Two projects of one name, from the one template: two IDs.
  assert.ok(idOf(one) && idOf(two) && idOf(one) !== idOf(two));
  // The ID is kept by a second init, and by --force, which writes the template again.
  const first = idOf(one);
  assert.match(run(['init', one], { cwd: one }).out, /prism\.project +the project ID, kept/);
  assert.equal(run(['init', one, '--force'], { cwd: one }).code, 0);
  assert.equal(idOf(one), first);
  // No build reads it: the two projects build the same bytes, and so the same address, and neither holo holds an ID.
  const built = [one, two].map((root) => {
    const build = run(['build', '--json'], { cwd: root, env: OFFLINE });
    assert.equal(build.code, 0, build.out);
    return JSON.parse(build.out).summary;
  });
  assert.equal(built[0].address, built[1].address);
  // And that address is the UOR content address of the bytes: their BLAKE3 kappa-label, recomputed here.
  assert.match(built[0].address, /^blake3:[0-9a-f]{64}$/);
  for (const [root, id] of [[one, idOf(one)], [two, idOf(two)]]) {
    const holo = readFileSync(join(root, 'app', '.prism', 'build', readdirSync(join(root, 'app', '.prism', 'build')).find((f) => f.endsWith('.holo'))));
    assert.equal(holo.includes(Buffer.from(id)), false, 'the holo does not hold the project ID');
    assert.equal(kappa(new Uint8Array(holo)), built[0].address);
  }
  // A file that states no ID is left as it is, and init says so.
  writeFileSync(join(two, 'prism.project'), 'id = "not an id"\n');
  assert.match(run(['init', two], { cwd: two }).out, /prism\.project +states no project ID; left as it is/);
  assert.equal(readFileSync(join(two, 'prism.project'), 'utf8'), 'id = "not an id"\n');
});

test('lock writes the lock again after the project changes, and only what LexLean accepts', { timeout: 600000 }, () => {
  const root = scratch();
  assert.equal(run(['init', root], { cwd: root }).code, 0);
  const app = join(root, 'app');
  const config = () => readFileSync(join(app, 'lexlean.toml'), 'utf8');
  const lock = () => readFileSync(join(app, 'lexlean.lock'), 'utf8');
  const report = (args) => {
    const r = run(['lock', ...args, '--json'], { cwd: root, env: OFFLINE });
    return { code: r.code, ...JSON.parse(r.out) };
  };
  // The template's own lock is the one this command would write, byte for byte: nothing is written.
  const shipped = lock();
  const untouched = report([]);
  assert.deepEqual([untouched.code, untouched.summary.current, untouched.summary.written], [0, true, false]);
  assert.equal(lock(), shipped);

  // The app takes its own name. check then refuses the lock, and says which command writes it again.
  writeFileSync(join(app, 'lexlean.toml'), config().replace('name = "prism-template-contract"', 'name = "chess"'));
  const refused = JSON.parse(run(['check', '--json'], { cwd: root, env: OFFLINE }).out);
  assert.equal(refused.diagnostics.at(-1).code, 'LLC0102');
  assert.match(refused.diagnostics.at(-1).remediation, /prism-code lock/);
  const stale = report(['--check']);
  assert.deepEqual([stale.code, stale.diagnostics.at(-1).code, stale.summary.written], [1, 'lock.stale', false]);
  assert.equal(lock(), shipped, '--check writes nothing');
  const written = report([]);
  assert.deepEqual([written.code, written.summary.written], [0, true]);
  assert.equal(run(['check', '--json'], { cwd: root, env: OFFLINE }).code, 0);

  // A lexicon of the app's own, added in a folder and configured in its sorted place, is locked with the rest.
  mkdirSync(join(app, 'language', 'chess.terms', 'entries'), { recursive: true });
  writeFileSync(join(app, 'language', 'chess.terms', 'lexicon.toml'), readFileSync(join(app, 'language', 'prism.arch', 'lexicon.toml'), 'utf8').replace('package = "prism.arch"', 'package = "chess.terms"'));
  writeFileSync(join(app, 'language', 'chess.terms', 'entries', 'arch-concern.toml'), readFileSync(join(app, 'language', 'prism.arch', 'entries', 'arch-concern.toml')));
  const sorted = config().replace('[[lexicon_source]]', '[[lexicon_source]]\npackage = "chess.terms"\nkind = "path"\npath = "language/chess.terms"\n\n[[lexicon_source]]');
  writeFileSync(join(app, 'lexlean.toml'), sorted);
  const added = report([]);
  assert.deepEqual([added.code, added.summary.written, added.summary.packages], [0, true, written.summary.packages + 1], JSON.stringify(added.diagnostics));
  assert.match(lock(), /id = "chess\.terms"\nversion = "1\.0\.0"\nkind = "path"\nsource = "language\/chess\.terms"/);

  // What LexLean does not accept is not written: here a lexicon configured out of order, which LexLean's own rule refuses.
  const before = lock();
  writeFileSync(join(app, 'lexlean.toml'), `${config()}\n[[lexicon_source]]\npackage = "a.first"\nkind = "path"\npath = "language/chess.terms"\n`);
  const unaccepted = report([]);
  assert.equal(unaccepted.code, 2);
  assert.ok(['lock.refused', 'lock.unresolved'].includes(unaccepted.diagnostics.at(-1).code), JSON.stringify(unaccepted.diagnostics));
  assert.equal(lock(), before);

  // A package embedded in LexLean that the lock does not hold cannot be added here, and the refusal says so.
  writeFileSync(join(app, 'lexlean.toml'), `${sorted}\n[[lexicon_source]]\npackage = "lexlean.std.zzz"\nkind = "builtin"\n`);
  const embedded = report([]);
  assert.deepEqual([embedded.code, embedded.diagnostics.at(-1).code], [2, 'lock.unresolved']);
  assert.equal(lock(), before);
});

test('a theorem the kernel does not prove is reported where the model states it, with what to try', { timeout: 600000 }, () => {
  const root = scratch();
  startApp(root, 'decision-app');
  // The planted defect: the first guarantee claims its breaking case always happens.
  const file = join(root, 'src', 'ParkingFeeTierProofs.lex.tex');
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes(' = false)'));
  writeFileSync(file, source.replace(' = false)', ' = true)'));
  const check = run(['check', '--json'], { cwd: root, env: OFFLINE });
  assert.equal(check.code, 1, check.out);
  const rejected = JSON.parse(check.out).diagnostics.filter((d) => d.code === 'proof.rejected');
  assert.equal(rejected.length, 1, check.out);
  const stated = source.split(/\r?\n/).findIndex((l) => /^\s*name: inv001Holds,/.test(l)) + 1;
  assert.deepEqual([rejected[0].file, rejected[0].line], ['src/ParkingFeeTierProofs.lex.tex', stated]);
  assert.match(rejected[0].remediation, /never weaken the theorem/);
  // And run refuses a project that does not build, with the report, before anything is instantiated.
  const ran = run(['run', '--input', '0 car', '--rm'], { cwd: root, env: OFFLINE });
  assert.equal(ran.code, 1, ran.err);
  assert.match(ran.err, /run refused: the project did not build/);
});

test('a proof names each theorem as Module.theorem, and a build hands on the vectors it replayed, as bytes', { timeout: 600000 }, async () => {
  const { prove, build } = await import('../src/journey/engine.mjs');
  const { readSession } = await import('../src/journey/project.mjs');
  const root = scratch();
  // The decision starter, a fixture init no longer offers, whose names this test knows.
  startApp(root, 'decision-app');
  const env = { ...process.env, ...OFFLINE };
  const session = readSession(root);
  const proved = await prove(root, session, { env });
  assert.equal(proved.ok, true, proved.message);
  // The project's module_prefix is PrismParkingFeeTier; a qualified name leaves it out, so it does not change with the project's name.
  assert.deepEqual(proved.theorems.map((t) => [t.theorem, t.qualified]), [['inv001Holds', 'ParkingFeeTierProofs.inv001Holds'], ['inv002Holds', 'ParkingFeeTierProofs.inv002Holds'], ['inv003Holds', 'ParkingFeeTierProofs.inv003Holds']]);
  const built = await build(root, session, { env });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.replayed.length, built.vectors.total);
  assert.ok(built.replayed.every((v) => v.request instanceof Uint8Array && v.response instanceof Uint8Array));
  assert.deepEqual([new TextDecoder().decode(built.replayed[0].request), new TextDecoder().decode(built.replayed[0].response)], ['0 car', 'free']);
});
