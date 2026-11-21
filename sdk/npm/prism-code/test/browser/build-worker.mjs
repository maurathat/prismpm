// A test, not part of the package: in a browser worker, a model is checked and its semantic snapshot taken by
// LexLean as WebAssembly, and its holo is built with nothing compiled (src/journey/model-holo.mjs). When the
// Holospace shell is served beside it, the holo is then kept in the shell's store, a changed byte is planted
// there, and the holo is opened through the shell's own path. No server takes part beyond serving these files.
//
// Message in: { names: [...] }. Messages out: one row per name, then { done: true }.
import { runWasi } from '/prism-code/journey/wasi-memory.mjs';
import { kappa as blake3 } from '/prism-code/blake3.mjs';
import { buildHolo } from '/prism-code/journey/model-holo.mjs';
import { EVALUATOR_GUEST } from '/prism-code/journey/model-guest.mjs';

const now = () => performance.now();
const ms = (from) => Math.round(now() - from);
const bytesOf = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const dec = new TextDecoder();

let ready = null;
async function start() {
  const pins = await (await fetch('/pins.json')).json();
  const t0 = now();
  const inflated = new Uint8Array(await new Response((await fetch('/lexlean.wasm.gz')).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const fetchMs = ms(t0);
  const t1 = now();
  const label = blake3(inflated);
  if (label !== pins.lexlean) throw new Error(`the LexLean executable hashes to ${label}, not the pinned ${pins.lexlean}`);
  const hashMs = ms(t1);
  const t2 = now();
  const lexlean = await WebAssembly.compile(inflated);
  const evaluator = await bytesOf(`/prism-code/journey/${EVALUATOR_GUEST.file}`);
  let shell = null;
  if (pins.shell) {
    const [kernel, open, store] = await Promise.all([import('/shell/kernel.mjs'), import('/shell/open.mjs'), import('/shell/store.mjs')]);
    const kernels = await kernel.openKernels({ holoBytes: await bytesOf('/shell/kernels/holospace-kernel.holo'), pin: pins.shell });
    const backing = await store.bestBacking();
    shell = { kernels, open, store, backing, kept: store.openStore(backing, kernels) };
  }
  return { lexlean, evaluator, shell, start: { fetchMs, hashMs, compileMs: ms(t2), lexleanBytes: inflated.length, backing: shell?.backing.kind ?? null } };
}

async function one(name, { lexlean, evaluator, shell }) {
  const listed = await (await fetch(`/projects/${name}.json`)).json();
  const files = new Map(Object.entries(listed.files).map(([path, text]) => [path, fromBase64(text)]));
  const check = async () => { const t = now(); const run = await runWasi(lexlean, { files, args: ['--diagnostic-format', 'json', 'check', '--all'] }); return { ms: ms(t), ok: JSON.parse(dec.decode(run.stdout)).success === true }; };
  const first = await check();
  const second = await check();
  const t1 = now();
  const taken = await runWasi(lexlean, { files, args: ['snapshot', '--all'] });
  if (taken.exit !== 0) throw new Error('LexLean took no snapshot');
  const snapshotBytes = new Uint8Array(taken.stdout);
  const snapshotMs = ms(t1);
  const t2 = now();
  const built = await buildHolo(JSON.parse(dec.decode(snapshotBytes)), { evaluator, snapshotBytes });
  const row = { name, ok: first.ok && second.ok, checkMs: [first.ms, second.ms], snapshotMs, snapshotBytes: snapshotBytes.length, buildMs: ms(t2), holoBytes: built.bytes.length, label: built.label, vectors: built.vectors, compared: built.compared, expected: listed.expected, sameAsNode: built.label === listed.expected };
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
    for (const name of data.names) {
      try { postMessage({ row: await one(name, context) }); } catch (error) { postMessage({ row: { name, ok: false, error: String(error?.message ?? error) } }); }
    }
  } catch (error) {
    postMessage({ row: { name: '(start)', ok: false, error: String(error?.message ?? error) } });
  }
  postMessage({ done: true });
};
