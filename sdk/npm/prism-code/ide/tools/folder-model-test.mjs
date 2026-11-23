// A folder a person opens is read as the package reads a project: the same model files, the same file to open.
//
// The project is one `prism-code init` writes, made here with the package's own command, so the test follows the
// template and the package's rule (src/journey/model-files.mjs) wherever they go.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFiles } from '../../src/journey/model-files.mjs';
import { PROJECT_FILE, folderModel, isModelFile, plainPath, sameFiles } from '../edit/folder-model.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const enc = new TextEncoder();

// Paths as a folder picker or a dropped folder gives them.
assert.equal(plainPath('app\\src\\App.lex.tex'), 'app/src/App.lex.tex');
assert.equal(plainPath('/app//src/./App.lex.tex'), 'app/src/App.lex.tex');
assert.equal(plainPath('../outside'), null);
assert.equal(plainPath('app/../../outside'), null);
assert.equal(plainPath(''), null);

// The rule for a model file, case by case.
for (const yes of ['lexlean.toml', 'lexlean.lock', 'lakefile.toml', 'lean-toolchain', 'lake-manifest.json', 'src/App.lex.tex', 'language/a/b.lex.tex']) assert.equal(isModelFile(yes), true, yes);
for (const no of ['README.md', 'notes.log', 'package.json', '.gitignore', '.prism/build/app.holo', 'src/.hidden.lex.tex', 'node_modules/x/lexlean.toml', 'target/out.lex.tex', 'tools/gen.py']) assert.equal(isModelFile(no), false, no);

// A project init wrote: the folder is read here as the package reads it from disk.
const work = mkdtempSync(join(tmpdir(), 'ide-folder-'));
try {
  const made = spawnSync(process.execPath, [join(pkg, 'bin', 'prism-code.mjs'), 'init', '--name', 'folder-test', '--no-skill'], { cwd: work, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const read = new Map();
  const visit = (at, rel) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) visit(p, rel + name + '/'); else read.set(rel + name, new Uint8Array(readFileSync(p))); } };
  visit(work, '');
  const found = folderModel(read);
  // Where init puts the LexLean project decides the root; the package is asked for the same folder.
  const root = read.has('lexlean.toml') ? '' : 'app/';
  assert.equal(found.root, root);
  const theirs = modelFiles(join(work, root), { skip: ['tools'] });
  assert.deepEqual([...found.files.keys()], [...theirs.files.keys()], 'the same files, in the same order');
  assert.equal(found.entry, theirs.entry, 'the same file to open');
  for (const [path, bytes] of theirs.files) assert.deepEqual([...found.files.get(path)], [...bytes], path);
  assert.ok(sameFiles(found.files, new Map([...theirs.files].map(([path, bytes]) => [path, new Uint8Array(bytes)]))));
  // prism.project is handed on as it is, when init wrote one, and is never a file of the model.
  assert.ok(!found.files.has(PROJECT_FILE));
  if (read.has(PROJECT_FILE)) assert.deepEqual([...found.marker], [...read.get(PROJECT_FILE)]); else assert.equal(found.marker, null);
  // One byte changed is another set of files.
  const changed = new Map(found.files);
  const first = [...changed.keys()][0];
  changed.set(first, Uint8Array.from([...changed.get(first), 10]));
  assert.equal(sameFiles(found.files, changed), false);
} finally { rmSync(work, { recursive: true, force: true }); }

// A model on its own, with lexlean.toml at the root, and an entry the model names.
const lone = folderModel({ 'lexlean.toml': enc.encode('entrypoints = ["src/Main.lex.tex"]\n'), 'src/Main.lex.tex': enc.encode('x'), 'src/Other.lex.tex': enc.encode('name: application'), 'README.md': enc.encode('no'), 'prism.project': enc.encode('id = "' + 'a'.repeat(64) + '"\n') });
assert.equal(lone.root, '');
assert.deepEqual([...lone.files.keys()], ['lexlean.toml', 'src/Main.lex.tex', 'src/Other.lex.tex']);
assert.equal(lone.entry, 'src/Main.lex.tex');
assert.equal(new TextDecoder().decode(lone.marker), 'id = "' + 'a'.repeat(64) + '"\n');
// An entrypoint that is not there: the module that states the application, as the package falls back.
assert.equal(folderModel({ 'lexlean.toml': enc.encode('entrypoints = ["src/Gone.lex.tex"]\n'), 'src/A.lex.tex': enc.encode('x'), 'src/B.lex.tex': enc.encode('name: application') }).entry, 'src/B.lex.tex');
// A model in a folder of another name, when it is the only one.
assert.equal(folderModel({ 'model/lexlean.toml': enc.encode(''), 'model/src/A.lex.tex': enc.encode('x') }).root, 'model/');

// What is not a project is refused, and says why.
assert.throws(() => folderModel({ 'README.md': enc.encode('x') }), (e) => e.code === 'folder.model' && /no LexLean project/.test(e.message));
assert.throws(() => folderModel({ 'lexlean.toml': enc.encode('') }), (e) => e.code === 'folder.model' && /no module/.test(e.message));
assert.throws(() => folderModel({ 'a/lexlean.toml': enc.encode(''), 'b/lexlean.toml': enc.encode('') }), (e) => e.code === 'folder.model' && /2 LexLean projects \(a, b\)/.test(e.message));
assert.throws(() => folderModel({}), (e) => e.code === 'folder.model');

console.log('folder-model: a folder is read as the package reads a project: the same model files and the same file to open; what is not a project is refused');
