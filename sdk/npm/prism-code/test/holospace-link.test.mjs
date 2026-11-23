// The link a build gives to the app's own holospace (src/holospace-link.mjs), and how the report shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLOSPACE_PAGE, holospaceLink, holospaceOf } from '../src/holospace-link.mjs';
import { formatReport } from '../src/model-cli.mjs';

const label = `blake3:${'0123456789abcdef'.repeat(4)}`;

test('the link names the app by its κ-label on the published Holospace page, and nothing else', () => {
  assert.equal(HOLOSPACE_PAGE, 'https://hologram-technologies.github.io/holospace-shell/space.html');
  assert.equal(holospaceLink(label), `${HOLOSPACE_PAGE}#app=${label}`);
  const url = new URL(holospaceLink(label));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.search, '');
  assert.deepEqual([...new URLSearchParams(url.hash.slice(1)).keys()], ['app']);
});

test('no link for anything that is not a BLAKE3 κ-label', () => {
  for (const address of [undefined, null, '', 'sha256:' + 'a'.repeat(64), 'blake3:' + 'A'.repeat(64), 'blake3:' + 'a'.repeat(63), `${label}&holo=https://example.com/x.holo`]) {
    assert.equal(holospaceLink(address), null, String(address));
  }
});

test('the report member names the file the page asks for, and only for a holo', () => {
  assert.deepEqual(holospaceOf(label, 'app/.prism/build/demo.holo'), { link: `${HOLOSPACE_PAGE}#app=${label}`, choose: 'app/.prism/build/demo.holo' });
  assert.equal(holospaceOf(label, 'app/.prism/build/rule-app.json'), null);
  assert.equal(holospaceOf('sha256:' + 'a'.repeat(64), 'demo.holo'), null);
});

test('a person reading the build report is told where the app runs', () => {
  const text = formatReport({ ok: true, command: 'build', durationMs: 1, diagnostics: [], summary: { artifact: 'app/.prism/build/demo.holo', address: label, vectorsPassed: 9, vectorsTotal: 9, holospace: holospaceOf(label, 'app/.prism/build/demo.holo') } });
  assert.match(text, new RegExp(`  holospace  open ${HOLOSPACE_PAGE.replace(/[.]/g, '\\.')}#app=${label}\\n`));
  assert.match(text, /\n {13}and choose app\/\.prism\/build\/demo\.holo: the app runs there, in its own holospace, in your browser\n/);
  assert.doesNotMatch(formatReport({ ok: true, command: 'build', durationMs: 1, diagnostics: [], summary: { artifact: 'x.json' } }), /holospace/);
});
