// What a holospace answers is said as it answered it: replaced or not, why, and the limits it names.
import assert from 'node:assert/strict';
import { limitsSaid, replaceSaid, stoppedSaid } from '../src/host-words.mjs';

const LABEL = 'blake3:' + 'a'.repeat(64);

// Replaced, with its state carried.
const kept = replaceSaid({ replaced: true, label: LABEL, carried: 3, judged: { verdict: 'verified' } });
assert.equal(kept.text, 'The running app was replaced, and kept its state.');
assert.deepEqual(kept.state, { replaced: true, reset: false, reason: null, why: null, label: LABEL, carried: 3, judged: { verdict: 'verified' } });

// Replaced, but its session could not be carried: said as a fresh start, with the holospace's own reason.
const reset = replaceSaid({ replaced: true, label: LABEL, carried: 0, reason: 'state.reset', why: 'the state has another shape in the new build' });
assert.equal(reset.text, 'The running app was replaced, and started afresh: the state has another shape in the new build.');
assert.equal(reset.state.reset, true);
assert.match(replaceSaid({ replaced: true, reason: 'state.reset' }).text, /started afresh: its state could not be carried into the new build\.$/);
// The earlier shape for the same thing is still read.
assert.equal(replaceSaid({ replaced: true, kept: 'restarted', reason: 'the journal does not replay' }).text, 'The running app was replaced, and started afresh: the journal does not replay.');

// Not replaced: each reason the holospace names, and nothing is ever said to be replaced that was not.
assert.match(replaceSaid({ replaced: false, reason: 'proof.unjudged' }).text, /^The running app was not replaced: its holospace cannot yet check the proof itself/);
assert.equal(replaceSaid({ replaced: false, reason: 'proof.refused', why: 'theorem accepts_exactly_a_request: refused' }).text,
  'The running app was not replaced: its holospace proved the build again itself, and the proof was refused (theorem accepts_exactly_a_request: refused).');
assert.equal(replaceSaid({ replaced: false, reason: 'holo.blocked' }).text, 'The running app was not replaced: its holospace judged the holo "blocked".');
assert.match(replaceSaid({ replaced: false, reason: 'replace.failed' }).text, /could not put it in place of the running app\.$/);
assert.match(replaceSaid({ replaced: false, reason: 'replace.unanswered' }).text, /did not answer within a minute\.$/);
assert.equal(replaceSaid({ replaced: false, reason: 'something.new' }).text, 'The running app was not replaced: something.new.');
for (const odd of [null, undefined, {}, { replaced: 'yes' }, { replaced: 1 }, 'replaced']) {
  const said = replaceSaid(odd);
  assert.equal(said.state.replaced, false, JSON.stringify(odd));
  assert.match(said.text, /^The running app was not replaced: /);
}

// Limits, as the holospace names them.
assert.equal(limitsSaid({ memoryMaxBytes: 67108864, cpuTimePerEventMs: 2000, storageQuotaBytes: 67108864 }), 'Its holospace holds it to 64 MB of memory, 2 s for each request and 64 MB of storage.');
assert.equal(limitsSaid({ memoryMaxBytes: 1536, cpuTimePerEventMs: 250 }), 'Its holospace holds it to 1536 bytes of memory and 250 ms for each request.');
assert.equal(limitsSaid({ storageQuotaBytes: 4096 }), 'Its holospace holds it to 4 KB of storage.');
// No limits named, or none that are numbers: nothing is said, and none is invented.
for (const none of [null, undefined, {}, { memoryMaxBytes: '64 MB' }, { cpuTimePerEventMs: 0 }, 'limits']) assert.equal(limitsSaid(none), '', JSON.stringify(none));

// A request the holospace stopped is said to be stopped, with its reason; anything else is the app not answering.
const coded = (code) => Object.assign(new Error('x'), { code });
assert.equal(stoppedSaid(coded('engine.time')), 'the app was stopped by its holospace: it ran longer than its holospace allows for one request (engine.time)');
for (const code of ['engine.memory', 'engine.trap', 'engine.contract', 'fs.quota']) assert.match(stoppedSaid(coded(code)), new RegExp(`^the app was stopped by its holospace: .* \\(${code.replace('.', '\\.')}\\)$`));
// A session that has ended is said to take no request, with why; it is not called stopped.
assert.equal(stoppedSaid(coded('session.full')), 'the app took no request: its session has taken the 10,000 steps it keeps; restart its holospace to begin a new one (session.full)');
for (const code of ['session.closed', 'session.diverged']) {
  const said = stoppedSaid(coded(code));
  assert.ok(said.startsWith('the app took no request: ') && said.endsWith(' (' + code + ')'), said);
}
assert.equal(stoppedSaid(new Error('no such export')), 'the app did not answer: no such export');
assert.equal(stoppedSaid(coded('something.else')), 'the app did not answer: x');

console.log('host-words: a holospace\'s answer to replace, its limits and a stopped request are each said as the holospace gave them');
