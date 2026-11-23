// A rule app's page: static files written with the app, that check it in the browser before it answers (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/journey/engine.mjs';
import { RULE_JUDGE_HOLO, admits, answerKind, greatestAt, kernelChecked, leastAt, rulesAt } from '../src/journey/rule-app.mjs';
import { browserClosure, writeRuleAppSite } from '../src/journey/rule-app-site.mjs';
import { modelFiles } from '../src/journey/model-files.mjs';
import { kappa } from '../src/blake3.mjs';
import { PARKING, ruleAppSnapshot } from './support/snapshot.mjs';
import { snapshotOf, startedApp } from './support/started-app.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));
// LexLean as WebAssembly is never fetched by these tests; a test that needs it names it with PRISM_LEXLEAN_WASM.
process.env.PRISM_LEXLEAN_FETCH = '0';
process.env.PRISM_KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));

// The env a step is given is the whole environment it sees: it names this test's home, never the user's.
const HOME = { PRISM_HOME: process.env.PRISM_HOME };
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('the files a page needs are the ones a browser can run: nothing that needs Node itself', () => {
  const files = browserClosure();
  assert.ok(files.includes('browser.mjs') && files.includes('index.mjs') && files.includes('core.mjs') && files.includes('uorc.mjs'));
  for (const file of files) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/\bfrom\s*['"]node:/.test(text), `${file} imports Node`);
  }
  assert.ok(!files.some((f) => f.startsWith('journey/') || f === 'node.mjs'));
  assert.deepEqual(files, [...files].sort());
});

test('a build writes the page beside the app, and the page carries the record, the judge and the package\'s own rules', { timeout: 120000 }, async () => {
  const { dir, session } = startedApp('rule-app');
  const r = await build(dir, session, { env: HOME, snapshot: snapshotOf(ruleAppSnapshot()).snapshot, wasm: () => true });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.site, join(dir, '.prism', 'site'));
  assert.equal(session.status.ruleApp.site, r.site);
  assert.match(r.message, /Its page is the folder .*site: static files any host serves, which check the app in the browser before it answers\./);
  const at = (file) => readFileSync(join(r.site, file));
  // The record and the judge are the very bytes the build named.
  // The app's address and the judge's are UOR content addresses: the BLAKE3 kappa-label of the bytes.
  assert.equal(kappa(new Uint8Array(at('app.rule-app.json'))), r.address);
  assert.match(r.address, /^blake3:[0-9a-f]{64}$/);
  assert.equal(kappa(new Uint8Array(at('kernel.holo'))), RULE_JUDGE_HOLO);
  for (const file of browserClosure()) assert.deepEqual(at(`prism-code/src/${file}`), readFileSync(new URL(`../src/${file}`, import.meta.url)), file);
  // Planted defect P1: the page decides with the package's own functions, by their source, not a second writing of them.
  const script = at('start.mjs').toString('utf8');
  for (const fn of [admits, kernelChecked, answerKind, leastAt, greatestAt, rulesAt]) assert.ok(script.includes(fn.toString()), fn.name);
  assert.match(script, /if \(!admits\(app\.facts\)\) \{\s*say\('status', 'This page was altered and will not answer/);
  // It asks for its own files only: no address outside its folder is in the page or its script.
  const html = at('index.html').toString('utf8');
  assert.ok(!/https?:\/\//.test(html + script));
  assert.match(html, /<title>Parking fee tier<\/title>/);
  assert.match(html, /<script type="module" src="\.\/start\.mjs"><\/script>/);
  // The same record gives the same files, byte for byte.
  const model = modelFiles(dir);
  const again = writeRuleAppSite(join(dir, '.prism', 'site-again'), at('app.rule-app.json'), { model, semanticId: r.semanticId });
  for (const file of again.files) assert.deepEqual(readFileSync(join(again.directory, file)), at(file), file);
  assert.equal(again.files.length, 4 + browserClosure().length + 9 + model.files.size + 1);
  // The model goes with the page: every file LexLean reads to check it, byte for byte, listed with the file to open
  // and the identity the build proved. The page itself does not read it.
  const listing = JSON.parse(at('model/project.json'));
  assert.equal(listing.schema, 'prism/model-listing/1');
  assert.equal(listing.semanticId, r.semanticId);
  assert.equal(listing.entry, 'src/App.lex.tex');
  assert.deepEqual(listing.files, [...model.files.keys()]);
  for (const file of listing.files) assert.deepEqual(at(`model/${file}`), readFileSync(join(dir, file)), file);
  for (const needed of ['lexlean.toml', 'lexlean.lock', 'src/App.lex.tex']) assert.ok(listing.files.includes(needed), needed);
  assert.ok(!script.includes('model/'));
  for (const file of listing.files) assert.ok(!file.split('/').some((part) => part.startsWith('.')), file);
  // A site written without the model, as a caller that has only the record does, carries none.
  assert.ok(!writeRuleAppSite(join(dir, '.prism', 'site-bare'), at('app.rule-app.json')).files.some((file) => file.startsWith('model/')));
  // Planted defect P2: the page proves the guarantees itself. It carries Lean's kernel and library, the pinned bytes,
  // and the same writer of proof terms this package runs, and it does not take the record's word for the proof.
  const manifest = JSON.parse(at('kernel/manifest.json'));
  for (const name of [manifest.glue.file, manifest.wasm.file, manifest.library.file]) assert.deepEqual(at(`kernel/${name}`), readFileSync(new URL(`./fixtures/kernel/${name}`, import.meta.url)), name);
  assert.deepEqual(at('prism-code/src/journey/kernel-terms.mjs'), readFileSync(new URL('../src/journey/kernel-terms.mjs', import.meta.url)));
  assert.ok(!/\bfrom\s*['"]node:/.test(at('prism-code/src/journey/kernel-terms.mjs').toString('utf8')));
  assert.match(script, /import \{ HOLDS, KERNEL_AXIOMS, proofLines, readLibrary \} from '\.\/prism-code\/src\/journey\/kernel-terms\.mjs';/);
  assert.match(script, /const \{ accepted, reused, library, keep \} = await prove\(app\.record\);/);
  assert.match(script, /'Proved here by Lean\\'s kernel, in this browser: '/);
  assert.match(script, /if \(g !== manifest\.glue\.sha256 \|\| w !== manifest\.wasm\.sha256 \|\| l !== manifest\.library\.sha256\) throw/);
  // Before its own proof is done the page says it is proving, never that anything is proved.
  assert.ok(!script.includes("'Checked by Lean"));
});

test('the published model is what a check reads: nothing of the machine it was written on, of a build, or that a static host would not serve', () => {
  const { dir } = startedApp('rule-app');
  // Planted defect: each of these is in the app's folder and none may be published. session.json names folders on
  // the author's machine; a static host serves no dot-file, so a listing that named one asks for a file not there.
  const planted = ['session.json', '.gitignore', '.prism/build/app.rule-app.json', '.lexlean/cache', 'notes.md', '.prism-last.log', 'run.log', 'node_modules/x/index.js', 'target/out'];
  for (const file of planted) { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), 'x'); }
  const model = modelFiles(dir);
  for (const file of planted) assert.ok(!model.files.has(file), file);
  for (const file of model.files.keys()) assert.ok(!file.split('/').some((part) => part.startsWith('.')), file);
  for (const needed of ['lexlean.toml', 'lexlean.lock', 'lake-manifest.json', 'src/App.lex.tex']) assert.ok(model.files.has(needed), needed);
  assert.equal(model.entry, 'src/App.lex.tex');
  assert.deepEqual([...model.files.keys()], [...model.files.keys()].sort());
  // A folder the caller names is left out too. A project whose lexlean.toml names no entrypoint that is there opens the
  // module that states the application; one with no module at all is refused.
  mkdirSync(join(dir, 'tools'));
  writeFileSync(join(dir, 'tools', 'gen.py'), 'x');
  assert.ok(modelFiles(dir).files.has('tools/gen.py'));
  assert.ok(!modelFiles(dir, { skip: ['tools'] }).files.has('tools/gen.py'));
  writeFileSync(join(dir, 'lexlean.toml'), 'name = "x"');
  assert.equal(modelFiles(dir).entry, 'src/App.lex.tex');
  rmSync(join(dir, 'src'), { recursive: true });
  assert.throws(() => modelFiles(dir), /names no entrypoint/);
});

test('a title cannot write markup into the page, and an app whose guarantee fails gets no page', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-rule-app-site-title-'));
  const record = { title: '<script>alert(1)</script> & "more"', name: 'x', fields: [], words: [], guarantees: [], vectors: [], outcomes: [], kernel: { holo: RULE_JUDGE_HOLO }, proof: null, schema: 'prism/rule-app/1' };
  const { directory } = writeRuleAppSite(join(dir, 'site'), Buffer.from(JSON.stringify(record)));
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;'));

  // The second rule now makes a motorcycle premium, so the first guarantee is false.
  const { dir: app, session } = startedApp('rule-app');
  const broken = ruleAppSnapshot({ ...PARKING, rules: PARKING.rules.map((rule, i) => (i === 1 ? { ...rule, answer: 2 } : rule)) }, { id: 'broken' });
  const r = await build(app, session, { env: HOME, snapshot: snapshotOf(broken).snapshot, wasm: () => true });
  assert.equal(r.ok, false);
  assert.match(r.message, /guarantee 1 \(never premium\) is false/);
  assert.equal(existsSync(join(app, '.prism', 'site')), false);
});

test('the page produces only the terms this browser has not produced, and judges every term again, by the same rule as Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-rule-app-site-reuse-'));
  const record = { title: 't', name: 't', fields: [], words: [], guarantees: [], vectors: [], outcomes: [], kernel: { holo: RULE_JUDGE_HOLO }, proof: null, schema: 'prism/rule-app/1' };
  const { directory } = writeRuleAppSite(join(dir, 'site'), Buffer.from(JSON.stringify(record)));
  const script = readFileSync(join(directory, 'start.mjs'), 'utf8');
  // The reuse rule and the store are the package's own files, shipped whole, not a second writing of them.
  for (const name of ['kappa-rules.mjs', 'kappa-opfs.mjs', 'canonical-rules.mjs']) assert.deepEqual(readFileSync(join(directory, 'prism-code/src/journey', name)), readFileSync(new URL(`../src/journey/${name}`, import.meta.url)), name);
  assert.match(script, /import \{ judgedFacts, proved, termReusable \} from '\.\/prism-code\/src\/journey\/canonical-rules\.mjs';/);
  // Planted defect R1: a stored term stands in for producing one only when termReusable says so.
  assert.match(script, /const reusable = found\.map\(\(f\) => termReusable\(f\.facts\)\);/);
  // Planted defect R4: a reused term is never taken as proved; the page judges every term, and no early return skips it.
  assert.doesNotMatch(script, /if \(reusable\.every\(Boolean\)\) return/);
  assert.match(script, /const text = reusable\[i\] \? found\[i\]\.text : proofLines\(lib, record\.words, guarantee\);\n[^\n]*\n[^\n]*\n\s*const r = run\('check_suffix', bytes\);/);
  assert.match(script, /accepted\.push\(proved\(facts\)\);/);
  // Planted defect R2: only a proved term is kept, under the addresses of the bytes it ran.
  assert.match(script, /if \(proved\(facts\) && !reusable\[i\]\) await keepProof\(store, \{ key: keys\[i\]\.key, kernel: 'sha256:' \+ w, library: 'sha256:' \+ l,/);
  // Planted defect R3: kept files are still checked against the manifest, and the guest runs from the bytes hashed.
  assert.match(script, /if \(g !== manifest\.glue\.sha256 \|\| w !== manifest\.wasm\.sha256 \|\| l !== manifest\.library\.sha256\) throw/);
  assert.match(script, /kernel = await loadArchive\(holoBytes, \{ capabilities: null, capabilitySet: undefined, allowUnverified: false \}\);/);
  assert.match(script, /holoPinned: await labelLike\(record\.kernel\.holo, holoBytes\),/);
  // An earlier visit is named only when a proof was reused.
  assert.match(script, /const earlier = \(reused === 0 \? '' :/);
});

test('the page lays the image of an earlier load instead of loading the library, by the same rule, and asks for every module at once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-rule-app-site-image-'));
  const record = { title: 't', name: 't', fields: [], words: [], guarantees: [], vectors: [], outcomes: [], kernel: { holo: RULE_JUDGE_HOLO }, proof: null, schema: 'prism/rule-app/1' };
  const { directory, files } = writeRuleAppSite(join(dir, 'site'), Buffer.from(JSON.stringify(record)));
  const script = readFileSync(join(directory, 'start.mjs'), 'utf8');
  assert.deepEqual(readFileSync(join(directory, 'prism-code/src/journey/kernel-image.mjs')), readFileSync(new URL('../src/journey/kernel-image.mjs', import.meta.url)));
  // The image is found under a key over the loader, the kernel and the library the page has just checked.
  assert.match(script, /const imageKey = derivationKey\(IMAGE_SCHEMA, \[labels\.loader, labels\.kernel, labels\.library\]\);/);
  // Planted defect I1: an image stands in for the load only when reuseAdmits says so.
  assert.match(script, /const laid = reuseAdmits\(kept\.facts\) && restoreImage\(kept\.image, \{ memory: \(\) => memory, grow \}\);/);
  // Planted defect I2: only a load the kernel accepted is imaged, and before any proof is judged.
  assert.match(script, /if \(run\('load_library', library\)\.exit !== 0\) throw new Error\('the kernel refused its library'\);\s*\/\/[^\n]*\n\s*image = new Uint8Array\(memory\.buffer\)\.slice\(\);/);
  assert.ok(script.indexOf('image = new Uint8Array(memory.buffer).slice();') < script.indexOf("run('check_suffix'"));
  // Planted defect I3: an image is kept only from a load, never from a laid image.
  assert.match(script, /const keep = image && !store\.off \? \(\) => keepImage\(store, \{ key: imageKey, \.\.\.labels, bytes: encodeImage\(image\) \}\) : null;/);
  // Planted defect M1: the page names exactly the modules it ships, so none is found late and none is fetched for nothing.
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  const named = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(named, files.filter((f) => f.startsWith('prism-code/') && f.endsWith('.mjs')));
  assert.ok(named.length > 30);
});
