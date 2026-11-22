// The LexLean card prism_init hands an agent: each rule it states holds in the starters, which LexLean checks and
// Lean's kernel proves. A card that teaches a form the starters do not use would teach an agent to be refused.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { LEXLEAN_CARD } from '../src/journey/card.mjs';

const root = new URL('../templates/starters/', import.meta.url);
const sources = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) =>
  readdirSync(new URL(`${e.name}/src/`, root)).filter((f) => f.endsWith('.lex.tex')).map((f) => readFileSync(new URL(`${e.name}/src/${f}`, root), 'utf8')));
const theorems = sources.flatMap((s) => [...s.matchAll(/theorem\{[\s\S]*?\n\}/g)].map((m) => m[0]));

test('the starters hold theorems for the card to describe', () => {
  assert.ok(sources.length >= 4 && theorems.length >= 3, `${sources.length} sources, ${theorems.length} theorems`);
});

test('every definitions list in a starter is sorted as text and without repeats, as the card says', () => {
  assert.match(LEXLEAN_CARD, /without repeats, sorted as text/);
  for (const t of theorems) {
    const m = t.match(/definitions:\s*\[([\s\S]*?)\]/);
    if (!m) continue;
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    assert.deepEqual(names, [...new Set(names)].sort(), names.join(', '));
  }
});

test('a guarantee is the card\'s shape: its breaks definition stated false, by a proof the kernel covers, on the card\'s axioms', () => {
  for (const t of theorems) {
    assert.match(t, /statement: \(\((breaks\w+)( [\w]+)*\) = false\)/, t.slice(0, 120));
    assert.match(t, /proof: (linear_arithmetic|decide|reflexivity)\b/);
    const axioms = t.match(/axioms: \[([^\]]*)\]/)[1].split(',').map((a) => a.trim());
    for (const a of axioms) assert.ok(['Quot.sound', 'propext', 'Classical.choice'].includes(a), a);
  }
  assert.match(LEXLEAN_CARD, /axioms: \[Quot\.sound, propext\]/);
});

test('the card\'s forms are the starters\': constants, records, fields, comparisons and types', () => {
  // Layout aside: a starter may break a record over lines where the card keeps it on one.
  const all = sources.join('\n').replace(/\s+/g, ' ');
  for (const form of ['definition{name: ', 'structure{', 'type_parameters: [], parameters: [], fields: [', '(project ', ' =? ', ' <? ', ' <=? ', ' && ', '(not ', '(if ', 'result: Bool', 'result: Nat', '\\importmodule{']) {
    assert.ok(all.includes(form), `the starters use ${form}`);
    assert.ok(LEXLEAN_CARD.includes(form.trim().replace(/\\\\/g, '\\')), `the card shows ${form}`);
  }
  // As types: the words may appear in a title or a string, never where a type is written.
  assert.doesNotMatch(all, /(result|type): (Boolean|Natural)\b/);
});

test('the skill reference an agent reads is this card, whole', () => {
  const reference = readFileSync(new URL('../skill/references/lexlean-1.2.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(reference.includes(LEXLEAN_CARD), 'skill/references/lexlean-1.2.md no longer holds the card; write it again from src/journey/card.mjs');
});
