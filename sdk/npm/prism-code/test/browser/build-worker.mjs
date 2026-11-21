// A test, not part of the package: in a browser worker, a model is built by the package's own build
// (src/journey/build-core.mjs), the functions `prism_build` runs in Node: LexLean as WebAssembly checks it and takes
// its semantic snapshot, and its holo is built with nothing compiled. LexLean is admitted through the build's ports
// (src/journey/toolchain.mjs): fetched, decoded, hashed and compiled as it arrives, kept, and read back from the
// store. When the Holospace shell is served beside it, the holo is then kept in the shell's store, a changed byte is
// planted there, and the holo is opened through the shell's own path. No server takes part beyond serving these files.
//
// Message in: { names: [...] }. Messages out: one row per name, then { done: true }.
import { buildFromFiles } from '/prism-code/journey/build-core.mjs';
import { admitModule, memoryStore } from '/prism-code/journey/toolchain.mjs';
import { EVALUATOR_GUEST } from '/prism-code/journey/model-guest.mjs';

const now = () => performance.now();
const ms = (from) => Math.round(now() - from);
const bytesOf = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let ready = null;
async function start() {
  const pins = await (await fetch('/pins.json')).json();
  const pin = { kappa: pins.lexlean, url: '/lexlean.wasm.gz', encoding: 'gzip' };
  const store = memoryStore();
  const through = { store, fetch: (url) => fetch(url) };
  const fetched = await admitModule(pin, through);
  // Read back from the store, with no fetch to fall back on: the bytes are hashed again before they are compiled.
  const kept = await admitModule(pin, { store });
  // Planted: the same bytes asked for under another label are refused, and never compiled for the caller.
  let planted;
  try { await admitModule({ ...pin, kappa: `blake3:${'0'.repeat(64)}` }, { fetch: through.fetch }); planted = 'ADMITTED'; } catch (error) { planted = `refused: ${error.code}`; }
  const evaluator = await bytesOf(`/prism-code/journey/${EVALUATOR_GUEST.file}`);
  let shell = null;
  if (pins.shell) {
    const [kernel, open, shellStore] = await Promise.all([import('/shell/kernel.mjs'), import('/shell/open.mjs'), import('/shell/store.mjs')]);
    const kernels = await kernel.openKernels({ holoBytes: await bytesOf('/shell/kernels/holospace-kernel.holo'), pin: pins.shell });
    const backing = await shellStore.bestBacking();
    shell = { kernels, open, store: shellStore, backing, kept: shellStore.openStore(backing, kernels) };
  }
  return { lexlean: kept.module, evaluator, shell, start: { fetchHashCompileMs: fetched.ms, fromStoreMs: kept.ms, from: [fetched.from, kept.from], wrongLabel: planted, streamed: typeof WebAssembly.compileStreaming === 'function', backing: shell?.backing.kind ?? null, ok: fetched.from === 'fetch' && kept.from === 'store' && planted === 'refused: lexlean.wasm-mismatch' } };
}

async function one(name, { lexlean, evaluator, shell }) {
  const listed = await (await fetch(`/projects/${name}.json`)).json();
  const files = new Map(Object.entries(listed.files).map(([path, text]) => [path, fromBase64(text)]));
  const result = await buildFromFiles({ files, lexlean, evaluator });
  if (!result.ok) return { name, ok: false, stage: result.stage, error: result.message };
  const again = await buildFromFiles({ files, lexlean, evaluator });
  const built = result.holo;
  const row = { name, ok: again.ok && again.holo.label === built.label, buildMs: [result.ms, again.ms], holoBytes: built.bytes.length, label: built.label, vectors: result.vectors, compared: result.compared, proved: result.proved, expected: listed.expected, sameAsNode: built.label === listed.expected };
  row.ok = row.ok && row.sameAsNode;
  if (shell) {
    // Kept under its BLAKE3 label, read back, and read again after one byte of it is changed where it is kept.
    const t3 = now();
    const put = await shell.kept.putBlob(built.bytes);
    const back = await shell.kept.getBlob(put.label);
    const stored = { label: put.label, readBack: back !== null && same(back, built.bytes), ms: ms(t3) };
    const changed = built.bytes.slice();
    changed[changed.length >> 1] ^= 1;
    await shell.backing.put(shell.store.blobPath(put.label), changed);
    let after;
    try { const got = await shell.kept.getBlob(put.label); after = got === null ? 'refused' : same(got, built.bytes) ? 'the true bytes' : 'THE CHANGED BYTES'; } catch (error) { after = `refused: ${error.code ?? error.message}`; }
    stored.changedByte = after;
    await shell.backing.delete(shell.store.blobPath(put.label));
    const t4 = now();
    const opened = await shell.open.openApp(built.bytes, shell.kernels);
    const vector = listed.vector ? { request: fromBase64(listed.vector.request), response: fromBase64(listed.vector.response) } : null;
    const answered = opened.dispatch && vector ? same(new Uint8Array(await opened.dispatch(vector.request)), vector.response) : null;
    row.shell = { stored, verdict: opened.verdict, facts: opened.facts, answersItsVector: answered, hasView: Boolean(opened.view), openMs: ms(t4) };
    row.ok = row.ok && stored.readBack && after.startsWith('refused') && opened.verdict === 'verified' && answered === true;
  }
  return row;
}

onmessage = async ({ data }) => {
  try {
    ready ??= start();
    const context = await ready;
    postMessage({ start: context.start });
    if (!context.start.ok) postMessage({ row: { name: '(toolchain)', ok: false, error: JSON.stringify(context.start) } });
    for (const name of data.names) {
      try { postMessage({ row: await one(name, context) }); } catch (error) { postMessage({ row: { name, ok: false, error: String(error?.message ?? error) } }); }
    }
  } catch (error) {
    postMessage({ row: { name: '(start)', ok: false, error: String(error?.message ?? error) } });
  }
  postMessage({ done: true });
};
