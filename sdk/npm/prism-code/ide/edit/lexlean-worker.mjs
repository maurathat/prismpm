// LexLean's front end, in a worker, checking a model as it is edited.
//
// The executable is the one prism-code pins (src/journey/lexlean-wasm.mjs). It is admitted and run by the package's
// own functions, the ones its build runs in Node and in a page: toolchain.mjs decodes, hashes and compiles it as it
// arrives and gives the module only when its bytes have the pinned BLAKE3 label, and lexlean-core.mjs runs
// `lexlean check` and `lexlean snapshot` on a read-only file system held in memory. This file keeps only the
// messages the edit pages speak. Nothing leaves the tab.
//
// Messages in:  { id, files: { '/path': 'text', ... } }
// Messages out: { ready: true, ms, kappa } once, or { failed: 'why', reason: 'mismatch' | 'absent' };
//               { id, result, ms } with LexLean's command result, or { id, error }.

const base = new URL('./prism-code/', import.meta.url).href;
const enc = new TextEncoder();
const dec = new TextDecoder();

let loaded = null;
async function load(wasmUrl, want) {
  const started = performance.now();
  const [{ compileAdmitted }, core] = await Promise.all([import(base + 'journey/toolchain.mjs'), import(base + 'journey/lexlean-core.mjs')]);
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`the LexLean executable is not at ${wasmUrl} (${response.status})`);
  let admitted;
  try {
    // The bytes run only if they are the pinned ones.
    admitted = await compileAdmitted(response, { label: want.kappa, encoding: want.encoding, what: 'the LexLean executable' });
  } catch (e) {
    throw Object.assign(new Error(String(e?.message ?? e)), { reason: e?.code === 'lexlean.wasm-mismatch' ? 'mismatch' : 'absent' });
  }
  postMessage({ ready: true, ms: Math.round(performance.now() - started), kappa: want.kappa, bytes: admitted.bytes.length });
  return { module: admitted.module, core };
}

onmessage = async ({ data }) => {
  if (data.start) {
    loaded = load(data.start.url, data.start.pin);
    loaded.catch((e) => postMessage({ failed: String(e?.message ?? e), reason: e?.reason ?? 'absent' }));
    return;
  }
  try {
    const { module, core } = await loaded;
    const files = new Map(Object.entries(data.files).map(([path, text]) => [path, typeof text === 'string' ? enc.encode(text) : text]));
    if (data.snapshot) {
      // `lexlean snapshot --all`: what the model means, in the form the rule table and the kernel read.
      const taken = await core.lexleanSnapshot(module, files);
      postMessage({ id: data.id, snapshot: taken.ok ? dec.decode(taken.bytes) : null, ms: taken.ms });
      return;
    }
    const { ms, ...result } = await core.lexleanCheck(module, files);
    postMessage({ id: data.id, result, ms });
  } catch (e) {
    postMessage({ id: data.id, error: String(e?.message ?? e) });
  }
};
