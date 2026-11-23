// The workbench's theme is what the Hologram brand kit's tokens generate, and it has the contrast the kit asks for.
//
//   node tools/theme-test.mjs            what is committed: its contrast, its one use of the accent, code as Dark+ has it
//   node tools/theme-test.mjs --fetch    and that it is, byte for byte, what tools/build-theme.mjs writes from the
//                                        kit's tokens at the pinned commit (asks the network for that one file)
//   node tools/theme-test.mjs <file>     the same, from a local copy of the tokens
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_FILE, THEME_FILE, THEME_NAME, colorsOf, contrast, contrastReport, generate, over, pinnedTokens, themeOf } from './build-theme.mjs';

const ide = join(dirname(fileURLToPath(import.meta.url)), '..');
const themeText = readFileSync(THEME_FILE, 'utf8');
const theme = JSON.parse(themeText);

// The arithmetic the check rests on: WCAG's own two ends, and a colour that is not opaque laid over its ground.
assert.equal(Math.round(contrast('#ffffff', '#000000') * 100) / 100, 21);
assert.equal(contrast('#777777', '#777777'), 1);
// The kit's border, white at one part in ten over its ground, is the colour the kit itself names border-solid.
assert.equal(over('#ffffff1a', '#151312'), '#2d2b2a');
assert.equal(over('#ffffff', '#151312'), '#ffffff');

// The committed theme: dark, named, and every pair that is text or marks a state has the contrast asked of it.
assert.equal(theme.name, THEME_NAME);
assert.equal(theme.type, 'dark');
assert.equal(theme.semanticHighlighting, true);
const report = contrastReport(theme);
assert.deepEqual(report.failing, [], 'every text pair is at least 4.5:1 and every mark at least 3:1');
assert.ok(report.held.filter((pair) => pair.least === 4.5).length >= 40 && report.held.filter((pair) => pair.least === 3).length >= 8);
// A theme that fails is caught: the same theme with its muted text made the ground's own colour.
const dim = { ...theme, colors: { ...theme.colors, descriptionForeground: theme.colors['editor.background'] } };
assert.ok(contrastReport(dim).failing.some((pair) => pair.what === 'muted text on the editor'));

// The kit's rule for its accent: once in a view, never a general highlight. It colours one thing here.
const accent = '#e93b01';
const uses = Object.entries(theme.colors).filter(([, value]) => value.toLowerCase().startsWith(accent)).map(([id]) => id);
assert.deepEqual(uses, ['tab.activeBorderTop'], 'the accent is the line over the open tab and nothing else');
assert.ok(!JSON.stringify([theme.tokenColors, theme.semanticTokenColors]).toLowerCase().includes(accent), 'no code is coloured with the accent');
// No shadows on the dark ground.
assert.equal(theme.colors['widget.shadow'], '#00000000');
assert.equal(theme.colors['scrollbar.shadow'], '#00000000');
// LexLean's eight kinds of token each have a colour (src/lexlean-language.js gives these names).
const kinds = /const KINDS = \[([^\]]+)\]/.exec(readFileSync(join(ide, 'src', 'lexlean-language.js'), 'utf8'))[1].split(',').map((name) => name.trim().replace(/'/g, ''));
assert.deepEqual(Object.keys(theme.semanticTokenColors).sort(), [...kinds].sort());

// A token the theme is built from and the kit does not have stops the build; it is not guessed.
assert.throws(() => themeOf({ background: '#151312' }), /the kit has no "foreground" token/);
assert.throws(() => colorsOf({ 'hologram-dark': { color: { background: { $value: 'rgb(0,0,0)' } } } }), /not a hex colour/);

// Code reads as it does in VS Code: Dark+'s colours for LexLean's kinds and for plain text, and no font or size of
// the page's own (the workbench is left on VS Code's).
assert.deepEqual(theme.semanticTokenColors, { keyword: '#569cd6', type: '#4ec9b0', string: '#ce9178', number: '#b5cea8', operator: '#d4d4d4', property: '#9cdcfe', namespace: '#4ec9b0', comment: '#6a9955' });
assert.equal(theme.colors['editor.foreground'], '#d4d4d4');
for (const [name, color] of [['comment', '#6a9955'], ['string', '#ce9178'], ['keyword', '#569cd6'], ['control keyword', '#c586c0'], ['function', '#dcdcaa'], ['variable', '#9cdcfe']]) {
  assert.equal(theme.tokenColors.find((rule) => rule.name === name)?.settings.foreground, color, `${name} as Dark+ has it`);
}
assert.ok(!Object.keys(theme.colors).some((id) => id.startsWith('terminal.ansi') || id.startsWith('editorBracketHighlight')), 'the terminal\'s sixteen colours and bracket colours are left to VS Code');
assert.ok(!/fontFamily|fontSize/.test(readFileSync(join(ide, 'src', 'model-editor.js'), 'utf8')), 'the page sets no font of its own on the workbench');

// The committed files are what the pinned tokens generate.
const from = process.argv[2] === '--fetch' ? null : process.argv[2];
if (process.argv[2]) {
  const made = generate(await pinnedTokens(from));
  assert.equal(themeText, made.themeText, 'src/theme/hologram-dark.json is what tools/build-theme.mjs writes from the pinned tokens');
  assert.equal(readFileSync(CSS_FILE, 'utf8'), made.cssText, 'src/theme/hologram-tokens.css is what it writes too');
}

const closest = report.held.reduce((a, b) => (b.ratio - b.least < a.ratio - a.least ? b : a));
console.log(`theme: ${report.held.length} pairs have the contrast asked (closest: ${closest.what}, ${closest.ratio}:1 against ${closest.least}:1); the accent colours one thing; code is coloured as Dark+ has it`
  + (process.argv[2] ? '; the files are what the pinned tokens generate' : '; not compared with the kit (pass --fetch)'));
