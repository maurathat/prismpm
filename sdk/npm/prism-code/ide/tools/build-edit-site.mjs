// Add the edit page to a site of static files, beside the audit page build-audit-site.mjs put there.
// Usage: node tools/build-edit-site.mjs <out dir> <project dir, holding lexlean.toml> [commit]
//
//   <out>/edit/                      the page (ide/edit)
//   <out>/edit/prism-code/           prism-code's src, as the page and its workers import it
//   <out>/edit/pin.json              the pin of the LexLean executable, as src/journey/lexlean-wasm.mjs states it
//   <out>/edit/lexlean.wasm.gz       that executable
//   <out>/edit/kernel/               Lean's kernel, its loader and its library, with the manifest that names them
//   <out>/edit/model-kernel/         the kernel a model's own theorems are put to, its loader and its base library,
//                                    and pins.json naming each by its BLAKE3 label (src/journey/model-prove.mjs)
//   <out>/edit/holospace/            the Holospace library a built holo is opened and run with, each file the one
//                                    tools/holospace-pins.json names by its BLAKE3 label
//   <out>/edit/project/              the model the page opens when it is given no other, and project.json listing it
//   <out>/edit/ide/                  the same loop in the VS Code workbench, when dist-model/ has been built
//   <out>/edit/vendor/xterm/         xterm.js and its addons, the files npm ships, each the one terminal/pins.json names
//   <out>/edit/terminal/tables.json  the proved tables the terminal asks, read from model/ide-terminal-* and model/ide-audit
//   <out>/edit/site.json             what was written, from which commit, each file with its BLAKE3 label and its SHA-256
//
// Two things are fetched, once, by prism-code itself: the LexLean executable and the kernel. Each is admitted only
// when its bytes decode to the BLAKE3 label prism-code pins, and the page's workers check them again before running
// them: LexLean by that label, the kernel by the SHA-256 its manifest names. They are published beside the page because a browser cannot fetch them from where
// prism-code does: those addresses do not allow another site to read them.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEXLEAN_WASM, ensureLexleanWasm, lexleanWasmFile } from '../../src/journey/lexlean-wasm.mjs';
import { ensureKernel, hasKernel, readKernelFile } from '../../src/journey/kernel-store.mjs';
import { keptFile } from '../../src/journey/kappa-store.mjs';
import { MODEL_KERNEL_FILES, ensureModelKernel } from '../../src/journey/model-prove.mjs';
import { EVALUATOR_GUEST } from '../../src/journey/model-guest.mjs';
import { projectListing } from './edit-project.mjs';
import { kappa } from '../../src/blake3.mjs';
import { terminalTables, vendorFiles } from './terminal-site.mjs';

const [outArg, projectArg, commit = 'unknown'] = process.argv.slice(2);
if (!outArg || !projectArg) { console.error('usage: node tools/build-edit-site.mjs <out dir> <project dir> [commit]'); process.exit(64); }
const ide = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(ide, '..');
const project = resolve(projectArg);
const site = join(resolve(outArg), 'edit');

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(join(ide, 'edit'), site, { recursive: true, filter: (p) => !/README\.md$/.test(p) });
// Only code: the page imports modules, never the studio's pages or anything else under src.
cpSync(join(pkg, 'src'), join(site, 'prism-code'), { recursive: true, filter: (p) => statSync(p).isDirectory() || /\.(mjs|js)$/.test(p) });
// And the one file a build in the page needs that is not code: the evaluator guest a holo is made from. The worker
// admits it by the label model-guest.mjs pins.
cpSync(join(pkg, 'src', 'journey', EVALUATOR_GUEST.file), join(site, 'prism-code', 'journey', EVALUATOR_GUEST.file));

writeFileSync(join(site, 'pin.json'), JSON.stringify({ commit: LEXLEAN_WASM.commit, kappa: LEXLEAN_WASM.kappa, encoding: LEXLEAN_WASM.encoding }) + '\n');
cpSync(lexleanWasmFile() ?? await ensureLexleanWasm(), join(site, 'lexlean.wasm.gz'));

if (!hasKernel()) await ensureKernel();
mkdirSync(join(site, 'kernel'));
const manifest = readFileSync(join(pkg, 'src', 'journey', 'kernel', 'manifest.json'));
writeFileSync(join(site, 'kernel', 'manifest.json'), manifest);
const named = JSON.parse(manifest);
for (const part of [named.glue, named.wasm, named.library]) writeFileSync(join(site, 'kernel', part.file), readKernelFile(part.file));

// The kernel for a model's own theorems: the three files prism-code pins, as it keeps them, each already admitted
// by its label. The page's worker admits them again by the label in pins.json before it opens the kernel.
await ensureModelKernel();
mkdirSync(join(site, 'model-kernel'));
const modelPin = (name) => ({ kappa: MODEL_KERNEL_FILES[name].kappa, url: name, encoding: MODEL_KERNEL_FILES[name].encoding });
for (const name of Object.keys(MODEL_KERNEL_FILES)) {
  const kept = process.env.PRISM_MODEL_KERNEL_DIR ? join(process.env.PRISM_MODEL_KERNEL_DIR, name) : keptFile(MODEL_KERNEL_FILES[name].kappa);
  cpSync(kept, join(site, 'model-kernel', name));
}
writeFileSync(join(site, 'model-kernel', 'pins.json'), JSON.stringify({ loader: modelPin('lean-kernel.mjs'), kernel: modelPin('lean-kernel.wasm.gz'), library: modelPin('base.ndjson.gz') }) + '\n');

// Holospace's library: fetched once from where it is published, or read from PRISM_HOLOSPACE_DIR, and written
// beside the page only when each file's bytes derive to its pinned label. At run time nothing is fetched from there.
const holospace = JSON.parse(readFileSync(join(ide, 'tools', 'holospace-pins.json'), 'utf8'));
for (const pin of holospace.files) {
  const local = process.env.PRISM_HOLOSPACE_DIR ? join(process.env.PRISM_HOLOSPACE_DIR, pin.path) : null;
  let bytes;
  if (local) bytes = new Uint8Array(readFileSync(local));
  else {
    const response = await fetch(new URL(pin.path, holospace.from));
    if (!response.ok) throw new Error(`${holospace.from}${pin.path} answered HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const got = kappa(bytes);
  if (got !== pin.kappa || bytes.length !== pin.bytes) throw new Error(`holospace/${pin.path} is ${got}, ${bytes.length} bytes, not the pinned ${pin.kappa}, ${pin.bytes} bytes`);
  mkdirSync(dirname(join(site, 'holospace', pin.path)), { recursive: true });
  writeFileSync(join(site, 'holospace', pin.path), bytes);
}

// The terminal: xterm.js, refused here when an installed file is not the pinned one, and its tables.
mkdirSync(join(site, 'vendor', 'xterm'), { recursive: true });
for (const [name, bytes] of vendorFiles()) writeFileSync(join(site, 'vendor', 'xterm', name), bytes);
writeFileSync(join(site, 'terminal', 'tables.json'), JSON.stringify(await terminalTables()) + '\n');

const listing = projectListing(project);
for (const path of listing.files) cpSync(join(project, path), join(site, 'project', path));
writeFileSync(join(site, 'project.json'), JSON.stringify(listing) + '\n');

// The workbench is built apart (npx vite build -c vite.model.config.js). Without that build the site has the plain page only.
const workbench = join(ide, 'dist-model');
const hasWorkbench = existsSync(join(workbench, 'model.html'));
if (hasWorkbench) {
  cpSync(workbench, join(site, 'ide'), { recursive: true });
  renameSync(join(site, 'ide', 'model.html'), join(site, 'ide', 'index.html'));
}

const files = [];
const walk = (dir) => { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(site);
// Each file is named by its BLAKE3 label; SHA-256 stays beside it for whoever reads the listing by that.
const written = files.map((p) => { const bytes = readFileSync(p); return { path: relative(site, p).split('\\').join('/'), bytes: bytes.length, kappa: kappa(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }; });
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
writeFileSync(join(site, 'site.json'), JSON.stringify({ schema: 'prism-ide/edit-site/1', prismCode: version, commit, lexlean: LEXLEAN_WASM.kappa, workbench: hasWorkbench, project: listing, files: written }, null, 1) + '\n');
const total = written.reduce((n, f) => n + f.bytes, 0);
console.log(`edit site: ${written.length} files, ${(total / 1048576).toFixed(1)} MiB, prism-code ${version}, workbench ${hasWorkbench ? 'included' : 'not built'}, commit ${commit}`);
