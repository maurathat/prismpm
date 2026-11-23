// Lean's kernel, in a worker, judging a rule table's guarantees after an edit.
//
// It follows what the page of a built rule app does (src/journey/rule-app-site.mjs, `prove`), with the same pieces of
// prism-code: the proof term for each guarantee is produced by kernel-terms.mjs, the kernel judges it, and
// canonical-rules.mjs says whether that counts as proved, axioms included. The kernel, its loader and its library
// are used only when their bytes hash to what kernel/manifest.json names, and only when the manifest records that
// this kernel judged this library whole.
//
// Unlike the built page, nothing is kept between visits, and the kernel is put back to its just-loaded state before
// every batch, so an earlier edit's terms cannot stand in for this one's.
//
// Messages in:  { id, words, guarantees }
// Messages out: { ready: true, ms } once, or { failed: 'why' };  { id, results: [{ proved, accepted, axioms }], ms }.

import { HOLDS, KERNEL_AXIOMS, proofLines, readLibrary } from './prism-code/journey/kernel-terms.mjs';
import { guaranteeStatement } from './prism-code/journey/kappa-rules.mjs';
import { judgedFacts, proved } from './prism-code/journey/canonical-rules.mjs';
// The kernel is opened by the package's own function, the one its build uses: one place that starts it, loads its
// library and lays it back. What is judged, and what counts as proved, stays here.
import { loaderFromBlob, openKernel } from './prism-code/journey/prove-core.mjs';
import { kappa } from './prism-code/blake3.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const unpack = async (response) => new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

async function open() {
  const started = performance.now();
  const base = new URL('./kernel/', import.meta.url).href;
  // A fresh copy when the network gives one; asked plainly when that request fails, as in a browser working offline.
  const manifest = await (await fetch(base + 'manifest.json', { cache: 'no-store' }).catch(() => fetch(base + 'manifest.json'))).json();
  const [glue, wasm, library] = await Promise.all([manifest.glue, manifest.wasm, manifest.library].map(async (entry) => unpack(await fetch(base + entry.file))));
  // Each file is taken only as the bytes its BLAKE3 label names, where the manifest names one (manifest.*.kappa, the
  // label of the decoded bytes), and the record that this kernel judged this library whole is read by the same labels
  // (binding.*Kappa). Then nothing here is hashed with SHA-256. A manifest from before it had labels names its files
  // by SHA-256 and is held to that, in both places.
  const LABEL = /^blake3:[0-9a-f]{64}$/;
  const named = [manifest.glue, manifest.wasm, manifest.library];
  const b = manifest.binding;
  const byLabel = named.every((entry) => LABEL.test(entry?.kappa ?? '')) && [b?.loaderKappa, b?.kernelKappa, b?.libraryKappa].every((label) => LABEL.test(label ?? ''));
  let ids;
  if (byLabel) {
    ids = [glue, wasm, library].map((bytes) => kappa(bytes));
    if (ids.some((id, n) => id !== named[n].kappa)) throw Object.assign(new Error('the kernel, its loader or its library is not the pinned one'), { reason: 'mismatch' });
    if (b.loaderKappa !== ids[0] || b.kernelKappa !== ids[1] || b.libraryKappa !== ids[2]) throw new Error('there is no record that this kernel judged this library whole');
  } else {
    const [g, w, l] = await Promise.all([glue, wasm, library].map(sha256));
    if (g !== manifest.glue.sha256 || w !== manifest.wasm.sha256 || l !== manifest.library.sha256) throw Object.assign(new Error('the kernel, its loader or its library is not the pinned one'), { reason: 'mismatch' });
    if (!b || b.kernel !== w || b.loader !== g || b.library !== l) throw new Error('there is no record that this kernel judged this library whole');
    ids = ['sha256:' + g, 'sha256:' + w, 'sha256:' + l];
  }

  // Resettable: the kernel as it is once its library is resident is held, and laid back before every batch.
  const k = await openKernel({ factory: await loaderFromBlob(glue), wasm, baseText: dec.decode(library), resettable: true });
  postMessage({ ready: true, ms: Math.round(performance.now() - started), lean: manifest.lean?.version ?? null, admittedBy: byLabel ? 'blake3' : 'sha256' });
  return { lib: readLibrary(k.baseText), check: k.check, reset: k.reset, labels: { kernel: ids[1], library: ids[2] } };
}

const kernel = open();
kernel.catch((e) => postMessage({ failed: String(e?.message ?? e), reason: e?.reason ?? 'absent' }));

onmessage = async ({ data }) => {
  try {
    const { lib, check, reset } = await kernel;
    const started = performance.now();
    reset();
    const results = [];
    for (const guarantee of data.guarantees) {
      const statement = guaranteeStatement(data.words, guarantee);
      const text = proofLines(lib, data.words, guarantee);
      const bytes = enc.encode(text);
      const r = check(text);
      const axioms = r.axioms[HOLDS] || null;
      const derived = 'sha256:' + await sha256(bytes);
      // A term is proved only by what this kernel accepts now, within the axioms a rule table is allowed.
      const facts = judgedFacts({ hasTerm: true, termNamed: derived, termDerived: derived, termStatement: statement, statement, kernelRan: true, kernelAccepted: r.exit === 0 && axioms !== null, axioms, policy: KERNEL_AXIOMS, source: 0 });
      results.push({ proved: proved(facts), accepted: r.exit === 0, axioms });
    }
    postMessage({ id: data.id, results, ms: Math.round(performance.now() - started) });
  } catch (e) {
    postMessage({ id: data.id, error: String(e?.message ?? e) });
  }
};
