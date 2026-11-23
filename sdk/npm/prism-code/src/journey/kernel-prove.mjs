/**
 * Check a rule app's guarantees with Lean's own kernel, in this process: no
 * A container tool, no Lean toolchain, no server.
 *
 * The kernel is Lean 4.32.1's C++ kernel compiled to WebAssembly, and the
 * library is the export of one lemma Lean proved once for every rule app
 * (`PrismLive.Kernel.ruleJudge_sound`). Both come from UOR-Foundation/foundry
 * (`studio/shell/kernel/lean`), which runs them in a browser tab. They are
 * fetched once and kept on this machine (kernel-store.mjs); `kernel/manifest.json`
 * names each by SHA-256 and records that this kernel judged this library whole.
 *
 * A guarantee's proof is that lemma applied to the rule app's numbers.
 * This module writes the proof as kernel terms and the kernel judges it, so
 * nothing here is trusted to be right: a wrong term is refused.
 *
 * What the verdict is about: the rule judge reading those numbers, which is
 * not the `judge` definition render.mjs writes for the SDK image. So this is
 * a check of the rules, and `lexlean verify` remains the proof of the model.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { findProof, kappaStore, keepProof } from './kappa-store.mjs';
import { guaranteeStatement, proofKey } from './kappa-rules.mjs';
import { STATUS, judgedFacts, proved, status, termReusable } from './canonical-rules.mjs';
import { configuredStore as publicStoreOf, pullProofs } from './proof-store.mjs';
import { kappa } from '../uorc.mjs';
import { kappa as blake3Label } from '../blake3.mjs';
import { ensureKernel, hasKernel, readKernelFile } from './kernel-store.mjs';
import { HOLDS, KERNEL_AXIOMS, proofLines, readLibrary } from './kernel-terms.mjs';

export { KERNEL_AXIOMS, proofLines };

const KERNEL = new URL('./kernel/', import.meta.url);
export { WORD_MAX } from './rule-table.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The pinned files, each checked against the address the manifest names. Throws when one is not the pinned one. */
export function readPinned({ read = (file) => (file === 'manifest.json' ? readFileSync(new URL(file, KERNEL)) : readKernelFile(file)) } = {}) {
  const manifest = JSON.parse(read('manifest.json').toString('utf8'));
  const glue = gunzipSync(read(manifest.glue.file));
  const wasm = gunzipSync(read(manifest.wasm.file));
  const library = gunzipSync(read(manifest.library.file));
  const got = { loader: sha256(glue), kernel: sha256(wasm), library: sha256(library) };
  if (got.loader !== manifest.glue.sha256 || got.kernel !== manifest.wasm.sha256 || got.library !== manifest.library.sha256) throw new Error('the kernel, its loader or its library is not the pinned one');
  // The library is entered without being judged again: sound only for one this same kernel judged whole.
  const b = manifest.binding;
  if (!b || b.kernel !== got.kernel || b.loader !== got.loader || b.library !== got.library) throw new Error('there is no record that this kernel judged this library whole');
  // The same three files by their UOR content addresses, the BLAKE3 kappa-labels of the decoded bytes: the manifest
  // names them so beside SHA-256, and the binding too, and a file that is not the one so named is refused as well.
  const labels = { loader: blake3Label(glue), kernel: blake3Label(wasm), library: blake3Label(library) };
  if (labels.loader !== manifest.glue.kappa || labels.kernel !== manifest.wasm.kappa || labels.library !== manifest.library.kappa) throw new Error('the kernel, its loader or its library is not the pinned one');
  if (b.kernelKappa !== labels.kernel || b.loaderKappa !== labels.loader || b.libraryKappa !== labels.library) throw new Error('there is no record that this kernel judged this library whole');
  return { manifest, glue, wasm, library, addresses: got };
}

let opened = null;

/** The kernel with the library resident, opened once per process. Resolves `{ manifest, addresses, judge }`. */
export function openKernel() {
  opened ??= (async () => {
    const { manifest, glue, wasm, library, addresses } = readPinned();
    const said = [];
    // Node imports a module from a file, so the loader's checked bytes are written under their own address.
    let loader = join(tmpdir(), `prism-lean-kernel-${addresses.loader.slice(0, 24)}.mjs`);
    const kept = () => existsSync(loader) && sha256(readFileSync(loader)) === addresses.loader;
    if (!kept()) {
      // Written under this process's own name and moved into place: two processes starting at once must never
      // import half a file. Where the move is refused because another process holds the name, its file is used
      // when it is the checked bytes, and this process's own otherwise.
      const own = join(tmpdir(), `prism-lean-kernel-${addresses.loader.slice(0, 24)}-${process.pid}.mjs`);
      writeFileSync(own, glue);
      try {
        renameSync(own, loader);
      } catch {
        if (!kept()) loader = own;
      }
    }
    const factory = (await import(pathToFileURL(loader).href)).default;
    const module = await factory({
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module));
        return {};
      },
      print: (line) => said.push(line),
      printErr: (line) => said.push(line),
    });
    const run = (entry, bytes) => {
      said.length = 0;
      module.FS.writeFile('/in.ndjson', bytes);
      let exit;
      try {
        exit = module.ccall(entry, 'number', ['string'], ['/in.ndjson']);
      } catch (error) {
        // A trap is the kernel failing, never a verdict.
        exit = 3;
        said.push(`trap: ${error?.message ?? error}`);
      }
      module.FS.unlink('/in.ndjson');
      const axioms = {};
      const rest = [];
      for (const line of said) {
        const a = /^axioms ([^:]+): ?(.*)$/.exec(line);
        if (a) axioms[a[1]] = a[2] ? a[2].split(', ') : [];
        else rest.push(line);
      }
      return { exit, axioms: exit === 0 ? axioms : {}, output: rest.join('\n').slice(-400) };
    };
    if (module.ccall('checker_ready', 'number', [], []) !== 0) throw new Error('the kernel did not start');
    const loaded = run('load_library', library);
    if (loaded.exit !== 0) throw new Error(`the kernel refused its library: ${loaded.output}`);
    const lib = readLibrary(library.toString('utf8'));
    // `judge` produces a term; `check` is the kernel judging one, whoever produced it.
    return { manifest, addresses, judge: (words, guarantee) => ({ text: proofLines(lib, words, guarantee), run }), check: (text) => run('check_suffix', Buffer.from(text, 'utf8')) };
  })();
  opened.catch(() => {
    opened = null;
  });
  return opened;
}

/**
 * Open the kernel ahead of the first proof, when its files are already on this
 * machine, so that proof does not wait for it. Fetches nothing and never throws:
 * a kernel that cannot be opened here is found out by the proof that needs it.
 */
export function warmKernel({ env = process.env } = {}) {
  if (hasKernel({ env })) openKernel().catch(() => {});
}

/** The manifest this package carries: what the kernel and its library must be, by address. Reading it needs no kernel file. */
export function pinnedAddresses() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', KERNEL), 'utf8'));
  return { manifest, kernel: `sha256:${manifest.wasm.sha256}`, library: `sha256:${manifest.library.sha256}` };
}

export { guaranteeStatement };

/**
 * Lean's kernel judges every guarantee of a rule app, given as the rule
 * judge's numbers and each guarantee as data (rule-table.mjs, `tableWords`).
 * Resolves `{ judged: [{ accepted, status, axioms, output, reused }], evidence,
 * pinned, ms, reused, pulled }`, one entry per guarantee in order. `accepted` is
 * the kernel's own answer now; the verdict on the whole check is the verified
 * guest's.
 *
 * A term already produced under the same key, kernel, library, statement and
 * axiom policy is not produced again (`termReusable`, model/canonical-build),
 * and the kernel judges it again: a stored term never stands in for a verdict.
 */
export async function kernelProve({ words, guarantees }, { kernel = null, log = () => {}, env = process.env, fetch = globalThis.fetch, store = kappaStore({ env }) } = {}) {
  const started = performance.now();
  const pinned = pinnedAddresses();
  const policy = KERNEL_AXIOMS;
  const keys = guarantees.map((guarantee) => {
    const statement = guaranteeStatement(words, guarantee);
    return { statement, key: proofKey({ kernel: pinned.kernel, library: pinned.library, statement, policy }) };
  });
  // A public store, when the user named one, may hold terms produced elsewhere: copied here, then judged like any other.
  const remote = publicStoreOf({ env, fetch });
  const pulled = remote && !store.off ? await pullProofs(store, remote, keys.map((k) => k.key)) : 0;
  const found = keys.map(({ key, statement }) => findProof(store, { key, kernel: pinned.kernel, library: pinned.library, statement, policy }));
  // A stored term stands in for producing one, never for judging it (model/canonical-build, `termReusable`).
  const reusable = found.map((f) => termReusable(f.facts));
  let k = kernel;
  if (!k) {
    await ensureKernel({ env, fetch, log });
    k = await openKernel();
  }
  const texts = [];
  const judged = guarantees.map((guarantee, i) => {
    const text = reusable[i] ? found[i].text : k.judge(words, guarantee).text;
    texts.push(text);
    // The kernel judges every term in this run, reused or produced: "proved" is what it accepts now.
    const r = k.check(text);
    const axioms = r.axioms[HOLDS] ?? null;
    const derivedTerm = kappa(new TextEncoder().encode(text));
    const facts = judgedFacts({
      hasTerm: true,
      termNamed: reusable[i] ? found[i].facts.storedBytes : derivedTerm,
      termDerived: derivedTerm,
      termStatement: reusable[i] ? found[i].proof.statement : keys[i].statement,
      statement: keys[i].statement,
      kernelRan: true,
      kernelAccepted: r.exit === 0 && axioms !== null,
      axioms,
      policy,
      source: reusable[i] ? 2 : 0,
    });
    const holds = proved(facts);
    // Only a proved term is kept, once: a refusal carries no bytes worth judging again.
    if (holds && !reusable[i]) keepProof(store, { key: keys[i].key, kernel: `sha256:${k.addresses.kernel}`, library: `sha256:${k.addresses.library}`, statement: keys[i].statement, policy, text, axioms });
    // Whether the whole check is a verdict is the guest's to say (kernel-verdict.mjs).
    return { accepted: holds, status: STATUS[status(facts)], axioms, output: r.output, reused: reusable[i] };
  });
  const derived = { kernel: `sha256:${k.addresses.kernel}`, library: `sha256:${k.addresses.library}` };
  return {
    judged,
    reused: reusable.filter(Boolean).length,
    pulled,
    ms: Math.round(performance.now() - started),
    pinned: { kernel: pinned.kernel, library: pinned.library },
    evidence: {
      lean: pinned.manifest.lean,
      kernel: derived.kernel,
      library: derived.library,
      bundle: `sha256:${sha256(texts.join(''))}`,
      statement: `sha256:${sha256(JSON.stringify(['prism/kernel-statement/1', words, guarantees]))}`,
      axioms: [...new Set(judged.flatMap((j) => j.axioms ?? []))].sort(),
    },
  };
}
