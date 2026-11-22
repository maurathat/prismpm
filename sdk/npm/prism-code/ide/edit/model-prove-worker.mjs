// Lean's kernel, in a worker, judging a model's own theorems after an edit.
//
// A rule table's guarantees are judged by prove-worker.mjs. This is for a model that states theorems of its own,
// such as the decision and stateful starters. It is the package's prover and nothing of its own: prove-core.mjs opens
// the model kernel from its three files, each admitted by its BLAKE3 label (toolchain.mjs), and `kernelProver` puts
// the model to it, the same functions the package's own build runs. A theorem is proved only when this kernel accepted a proof
// of it in this run, within the axioms it declares.
//
// It is started only when a page meets a model that is not a rule table: the kernel's base library is 20 MB, and a
// page that never needs it never fetches it. The kernel is laid back to its just-loaded state before every run, so
// what one edit declared cannot stand in for the next.
//
// It also builds: `{ build: true }` runs the package's whole build (build-core.mjs, `buildFromFiles`), the functions
// `prism-code build` runs: LexLean checks the model, this kernel judges its theorems, and the holo is made with nothing
// compiled, from the evaluator guest this package pins. A holo is given only when every theorem was proved, the
// holo reads back verified and every acceptance vector passes through it.
//
// Messages in:  { start: { lexlean: { url, pin: { kappa, encoding } }, kernel: '<address of model-kernel/pins.json>' } }
//               { id, files: { '/path': 'text', ... } }
//               { id, build: true, files }
// Messages out: { ready: true, ms, openMs } once, or { failed: 'why', reason: 'mismatch' | 'absent' };
//               { id, result: { ok, theorems: [{ theorem, name, status, detail, axioms, ms }], via, message }, ms }
//               or { id, error }. `status` is `proved`, `not proved` or `not settled`.
//               For a build: { stage: 'check' | 'prove' | 'build', of: id } as each begins, then
//               { id, built: <the result of buildFromFiles, its theorems as above>, ms }, the holo's bytes transferred.

import { compileAdmitted } from './prism-code/journey/toolchain.mjs';
import { lexleanSnapshot } from './prism-code/journey/lexlean-core.mjs';
import { kernelProver, openKernelFrom } from './prism-code/journey/prove-core.mjs';
import { buildFromFiles } from './prism-code/journey/build-core.mjs';
import { EVALUATOR_GUEST, admitEvaluator } from './prism-code/journey/model-guest.mjs';

const enc = new TextEncoder();

let opened = null;
// The evaluator guest, fetched once and admitted by the label the package pins: bytes that are not it build nothing.
let evaluator = null;
const guest = () => (evaluator ??= (async () => {
  const response = await fetch(new URL(`./prism-code/journey/${EVALUATOR_GUEST.file}`, import.meta.url));
  if (!response.ok) throw new Error(`the evaluator guest is not published beside this page (${response.status})`);
  return admitEvaluator(new Uint8Array(await response.arrayBuffer()));
})());
async function open({ lexlean, kernel }) {
  const started = performance.now();
  const pins = await (await fetch(kernel, { cache: 'no-store' })).json();
  // A pin names its file beside the pins; the label it must have is in the pin, never taken from the file.
  const at = (pin) => ({ ...pin, url: new URL(pin.url, kernel).href });
  const admitted = (async () => {
    const response = await fetch(lexlean.url);
    if (!response.ok) throw new Error(`the LexLean executable is not at ${lexlean.url} (${response.status})`);
    return compileAdmitted(response, { label: lexlean.pin.kappa, encoding: lexlean.pin.encoding, what: 'the LexLean executable' });
  })();
  const t = performance.now();
  const k = await openKernelFrom({ loader: at(pins.loader), kernel: at(pins.kernel), library: at(pins.library) }, { fetch: (url) => fetch(url), resettable: true });
  const openMs = Math.round(performance.now() - t);
  const { module } = await admitted;
  postMessage({ ready: true, ms: Math.round(performance.now() - started), openMs });
  return { module, k, prove: kernelProver(k) };
}

onmessage = async ({ data }) => {
  if (data.start) {
    opened = open(data.start);
    opened.catch((e) => postMessage({ failed: String(e?.message ?? e), reason: /not the pinned|decodes to/.test(String(e?.message)) ? 'mismatch' : 'absent' }));
    return;
  }
  try {
    const { module, k, prove } = await opened;
    const started = performance.now();
    const files = new Map(Object.entries(data.files).map(([path, text]) => [path, typeof text === 'string' ? enc.encode(text) : text]));
    if (data.build) {
      k.reset();
      const built = await buildFromFiles({ files, lexlean: module, evaluator: await guest(), prove, onStage: (stage) => postMessage({ stage, of: data.id }) });
      postMessage({ id: data.id, built, ms: Math.round(performance.now() - started) }, built.holo ? [built.holo.bytes.buffer] : []);
      return;
    }
    const taken = await lexleanSnapshot(module, files);
    if (!taken.ok) {
      postMessage({ id: data.id, result: { ok: false, theorems: [], via: null, message: 'LexLean refused the model, so there is nothing to put to the kernel.' }, ms: Math.round(performance.now() - started) });
      return;
    }
    k.reset();
    const result = await prove({ files, snapshot: taken.snapshot, lexlean: module });
    postMessage({ id: data.id, result: { ok: result.ok, theorems: result.theorems, via: result.via, message: result.message }, ms: Math.round(performance.now() - started) });
  } catch (e) {
    postMessage({ id: data.id, error: String(e?.message ?? e) });
  }
};
