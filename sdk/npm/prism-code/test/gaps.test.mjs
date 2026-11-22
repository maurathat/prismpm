// Gap telemetry: each point that records a gap, the ledger, delivery in the _meta of a hosted call,
// the opt-out, and the redaction: no text, name or number a user wrote ever leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAPS_SCHEMA, MODEL_STEPS, fingerprint, gapLedger, telemetryNotice, telemetryOn } from '../src/gaps.mjs';
import { VERSION } from '../src/version.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'prism-gaps-'));
const ledger = (env = {}) => gapLedger({ env, dir: scratch() });
const lines = (l) => (existsSync(l.file) ? readFileSync(l.file, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []);
const recorded = (l) => lines(l).map(({ kind, construct, code }) => ({ kind, construct, code }));

test('a fingerprint is a closed record: a kind, a construct from its vocabulary, a code and a version, and nothing else', () => {
  assert.deepEqual(fingerprint({ kind: 'model-refused', construct: 'check', code: 'PP2014', version: '0.6.0-rc.1', purpose: 'secret' }), { kind: 'model-refused', construct: 'check', code: 'PP2014', version: '0.6.0-rc.1' });
  for (const bad of [
    { kind: 'model-refused', construct: 'my-app', version: '0.6.0' },
    { kind: 'model-refused', construct: 'check', code: 'error: amount', version: '0.6.0' },
    { kind: 'model-refused', construct: 'check', code: 'llv7002', version: '0.6.0' },
    { kind: 'model-refused', construct: 'check', version: '0.6.0-secret' },
    { kind: 'refusal', construct: 'fields.none', version: '0.6.0' },
    { kind: 'unproved', construct: 'always:choice-is', version: '0.6.0' },
    null,
    'model-refused',
  ]) assert.equal(fingerprint(bad), null, JSON.stringify(bad));
});

// The gateway that receives the gaps (UOR-Foundation/lexlean-mcp, OB-16) keeps a gap only when it
// fits its grammar, and drops it silently otherwise.
test('every construct prism-code can emit fits the gateway\'s grammar', () => {
  assert.deepEqual([...MODEL_STEPS].sort(), ['build', 'check', 'format', 'lock', 'prelock', 'run', 'verify']);
});

test('PRISM_TELEMETRY=0 or DO_NOT_TRACK=1 records nothing and sends nothing; setup says what is sent and how to stop it', async () => {
  assert.equal(telemetryOn({}), true);
  assert.equal(telemetryOn({ DO_NOT_TRACK: '0' }), true);
  for (const env of [{ PRISM_TELEMETRY: '0' }, { PRISM_TELEMETRY: 'off' }, { DO_NOT_TRACK: '1' }, { DO_NOT_TRACK: 'true' }]) {
    assert.equal(telemetryOn(env), false, JSON.stringify(env));
    const gaps = ledger(env);
    assert.equal(gaps.record({ kind: 'model-refused', construct: 'lock' }), null);
    assert.equal(existsSync(gaps.file), false);
    appendFileSync(gaps.file, `${JSON.stringify({ kind: 'model-refused', construct: 'lock', code: null, version: VERSION })}\n`);
    assert.equal(gaps.pending(), null, 'a ledger written before it was turned off is not sent');
  }
  assert.match(telemetryNotice({}), /^telemetry: .*on this machine only; nothing is sent anywhere\. PRISM_TELEMETRY=0 turns it off\.$/);
  assert.match(telemetryNotice({ DO_NOT_TRACK: '1' }), /^telemetry: off/);
  assert.equal(telemetryNotice({}).split('\n').length, 1);
});

test('a ledger written by another tool, or replaced, is read safely', async () => {
  const dir = scratch();
  const gaps = gapLedger({ env: {}, dir });
  writeFileSync(join(dir, 'gaps.json'), '{"install":"zqx","sent":-1}');
  gaps.record({ kind: 'model-refused', construct: 'prelock' });
  const first = gaps.pending();
  assert.match(first.meta.install, /^[0-9a-f]{32}$/, 'a damaged state gets a new install ID');
  first.commit();
  writeFileSync(gaps.file, '');
  gaps.record({ kind: 'model-refused', construct: 'run' });
  assert.deepEqual(gaps.pending().meta.gaps.map((g) => g.construct), ['run'], 'a ledger shorter than what was sent is read from its start');
});
