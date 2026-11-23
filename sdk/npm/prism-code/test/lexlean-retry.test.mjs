// A LexLean run that traps is run again: on the same module, then on its admitted bytes compiled again.
// WebKit traps this way at times when LexLean runs with Lean's kernel open in the same page; Node does not,
// so the traps are planted here, by making chosen instances of a minimal WASI command trap at their start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexleanRun } from '../src/journey/lexlean-core.mjs';
import { rememberSource } from '../src/journey/module-source.mjs';

const exportsSection = [0x07, 0x13, 0x02, 0x06, ...Buffer.from('memory'), 0x02, 0x00, 0x06, ...Buffer.from('_start'), 0x00, 0x00];
const head = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, ...exportsSection];
/** A command whose `_start` returns at once: exit 0, nothing written. */
const QUIET = new Uint8Array([...head, 0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b]);
/** A command whose `_start` traps every time (`unreachable`). */
const TRAPS = new Uint8Array([...head, 0x0a, 0x05, 0x01, 0x03, 0x00, 0x00, 0x0b]);

/** Count the instances made, and make the first `traps` of them trap at their start as WebKit's do. */
async function planted(traps, run) {
  const real = WebAssembly.instantiate;
  const made = [];
  WebAssembly.instantiate = async (module, imports) => {
    const instance = await real(module, imports);
    made.push(module);
    if (made.length > traps) return instance;
    return { exports: { memory: instance.exports.memory, _start() { throw new WebAssembly.RuntimeError('Out of bounds memory access'); } } };
  };
  try {
    return { result: await run(), made };
  } catch (error) {
    return { error, made };
  } finally {
    WebAssembly.instantiate = real;
  }
}

test('a run that traps twice answers on the third, on the same module', async () => {
  const module = await WebAssembly.compile(QUIET);
  const { result, made } = await planted(2, () => lexleanRun(module, new Map(), ['check']));
  assert.equal(result.exit, 0);
  assert.equal(result.retried, 2);
  assert.equal(made.length, 3);
  assert.ok(made.every((m) => m === module), 'no new module while the same one still answers');
});

test('a module that keeps trapping is compiled again from its admitted bytes, and later runs use the new one', async () => {
  const module = rememberSource(await WebAssembly.compile(QUIET), QUIET);
  const { result, made } = await planted(4, () => lexleanRun(module, new Map(), ['check']));
  assert.equal(result.exit, 0);
  assert.equal(result.retried, 4);
  assert.deepEqual(made.map((m) => m === module), [true, true, true, false, false], 'three runs on the module, then the module compiled again');
  const again = await planted(0, () => lexleanRun(module, new Map(), ['check']));
  assert.equal(again.result.retried, 0);
  assert.notEqual(again.made[0], module, 'the next run starts from the module compiled again');
  assert.equal(again.made[0], made[3]);
});

test('a module that is not admitted is not compiled again: three traps and the run is refused', async () => {
  const module = await WebAssembly.compile(TRAPS);
  const { error, made } = await planted(0, () => lexleanRun(module, new Map(), ['snapshot', '--all']));
  assert.equal(error.code, 'lexlean.wasm-failed');
  assert.match(error.message, /trapped 3 times running `snapshot --all`/);
  assert.equal(made.length, 3);
});

test('an admitted module that traps every time is refused after six runs, never retried without end', async () => {
  const module = rememberSource(await WebAssembly.compile(TRAPS), TRAPS);
  const { error, made } = await planted(0, () => lexleanRun(module, new Map(), ['check']));
  assert.equal(error.code, 'lexlean.wasm-failed');
  assert.match(error.message, /trapped 6 times/);
  assert.equal(made.length, 6);
});

test('an error that is not a trap is thrown at once', async () => {
  const module = await WebAssembly.compile(QUIET);
  const real = WebAssembly.instantiate;
  let made = 0;
  WebAssembly.instantiate = async () => { made += 1; return { exports: { memory: new WebAssembly.Memory({ initial: 1 }), _start() { throw new TypeError('not a trap'); } } }; };
  try {
    await assert.rejects(lexleanRun(module, new Map(), ['check']), /not a trap/);
  } finally {
    WebAssembly.instantiate = real;
  }
  assert.equal(made, 1);
});
