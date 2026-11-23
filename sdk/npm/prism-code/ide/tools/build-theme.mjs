// The workbench's colour theme, generated from the Hologram brand kit's tokens.
//
// The kit (Hologram-Technologies/hologram-brand-kit) is the source of truth: its DTCG file,
// brand/tokens/hologram-tokens.json, at the commit tools/brand-pins.json names, taken only as the bytes its BLAKE3
// label names. Nothing of the kit is copied by hand. This file says which token colours which part of the workbench,
// and writes:
//
//   src/theme/hologram-dark.json     a VS Code colour theme: the workbench's colours from the kit, and code coloured
//                                    as Dark+ colours it (the scopes of other languages, LexLean's semantic tokens)
//   src/theme/hologram-tokens.css    the same tokens as CSS variables, for the strip above the workbench (model.html)
//
// Both are committed, so building the workbench needs no network; tools/theme-test.mjs holds them to what this file
// generates from the pinned tokens, and to the contrast the kit asks for.
//
// What the kit does not have: colours for code. It names a ground, text, muted text, borders, three states (success,
// warning, destructive) and one accent, which it allows once in a view and never as a general highlight. Code is
// therefore coloured as VS Code's own Dark+ colours it, on Dark+'s own ground (the owner's choice: the code area
// should read as it does in VS Code); everything around the code is the kit's. The accent is used for one thing:
// the line over the tab that is open.
//
// Usage: node tools/build-theme.mjs            fetch the pinned tokens and write both files
//        node tools/build-theme.mjs <file>     the same, from a local copy of the tokens (held to the same label)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from '../../src/blake3.mjs';

const ide = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PINS = JSON.parse(readFileSync(join(ide, 'tools', 'brand-pins.json'), 'utf8'));
export const THEME_FILE = join(ide, 'src', 'theme', 'hologram-dark.json');
export const CSS_FILE = join(ide, 'src', 'theme', 'hologram-tokens.css');
export const THEME_NAME = 'Hologram Dark';

/** The pinned tokens, as bytes: from `file` when given, else from the kit at the pinned commit. Held to the label. */
export async function pinnedTokens(file = null) {
  const pin = PINS.files.tokens;
  let bytes;
  if (file) bytes = new Uint8Array(readFileSync(file));
  else {
    const address = `${PINS.raw}${PINS.commit}/${pin.path}`;
    const response = await fetch(address);
    if (!response.ok) throw new Error(`${address} answered HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const got = kappa(bytes);
  if (got !== pin.kappa || bytes.length !== pin.bytes) throw new Error(`the tokens are ${got}, ${bytes.length} bytes, not the pinned ${pin.kappa}, ${pin.bytes} bytes`);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** The colours of one of the kit's themes, by token name: { background: '#151312', ... }. A token that is not a plain hex colour stops the build. */
export function colorsOf(tokens, set = PINS.set) {
  const colors = tokens?.[set]?.color;
  if (!colors || typeof colors !== 'object') throw new Error(`the tokens have no "${set}" colour set`);
  const out = {};
  for (const [name, token] of Object.entries(colors)) {
    const value = token?.$value;
    if (typeof value !== 'string' || !/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) throw new Error(`${set}.color.${name} is ${JSON.stringify(value)}, not a hex colour`);
    out[name] = value.toLowerCase();
  }
  return out;
}

const channels = (hex) => [1, 3, 5, 7].map((at) => (hex.length > at ? parseInt(hex.slice(at, at + 2), 16) : 255));
/** A colour laid over an opaque ground: what the eye is given. The kit's borders are white at a low alpha. */
export function over(hex, ground) {
  const [r, g, b, a] = channels(hex);
  const [gr, gg, gb] = channels(ground);
  const mix = (top, under) => Math.round(top * (a / 255) + under * (1 - a / 255));
  return '#' + [mix(r, gr), mix(g, gg), mix(b, gb)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
const luminance = (hex) => {
  const [r, g, b] = channels(hex).slice(0, 3).map((n) => { const c = n / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast of a colour on a ground, the colour laid over the ground first if it is not opaque. */
export function contrast(color, ground) {
  const [a, b] = [luminance(over(color, ground)), luminance(ground)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const NONE = '#00000000';

// Code, as VS Code's Dark+ colours it (extensions/theme-defaults: dark_vs.json and dark_plus.json). These are not the
// kit's: the kit has no colours for code.
const DARK_PLUS = {
  // The code area itself: its ground, the line the cursor is on, and what is selected.
  ground: '#1e1e1e', lineBorder: '#282828', selection: '#264f78', inactiveSelection: '#3a3d41', selectionHighlight: '#add6ff26',
  text: '#d4d4d4', comment: '#6a9955', string: '#ce9178', number: '#b5cea8', keyword: '#569cd6', control: '#c586c0', type: '#4ec9b0',
  function: '#dcdcaa', variable: '#9cdcfe', constant: '#4fc1ff', regexp: '#d16969', escape: '#d7ba7d', invalid: '#f44747',
};

/** The theme: which token colours what. `c` is colorsOf(tokens). */
export function themeOf(c) {
  const need = ['background', 'foreground', 'card', 'popover', 'primary', 'primary-foreground', 'primary-hover', 'secondary', 'muted-foreground', 'muted-foreground-subtle', 'brand',
    'destructive', 'success', 'warning', 'info', 'ring', 'sidebar', 'sidebar-foreground', 'accent-pressed', 'border-solid', 'border-strong', 'link', 'link-hover', 'chart-2', 'chart-3',
    'warning-subtle', 'info-border', 'destructive-subtle', 'success-subtle', 'scrim'];
  for (const name of need) if (!(name in c)) throw new Error(`the kit has no "${name}" token, which the theme is built from`);
  const text = c.foreground, soft = c['muted-foreground'], faint = c['muted-foreground-subtle'];
  const ground = c.background, raised = c.card, side = c.sidebar, hair = c['border-solid'], line = c['border-strong'], held = c['accent-pressed'];
  const colors = {
    // The ground and its text.
    'foreground': text, 'descriptionForeground': soft, 'disabledForeground': faint, 'errorForeground': c.destructive, 'icon.foreground': soft,
    'focusBorder': c.ring, 'selection.background': held, 'widget.shadow': NONE, 'scrollbar.shadow': NONE, 'widget.border': line,
    'textLink.foreground': c.link, 'textLink.activeForeground': c['link-hover'], 'textPreformat.foreground': text, 'textBlockQuote.background': raised, 'textCodeBlock.background': raised,
    // The editor.
    // The code area is Dark+'s, ground included (the owner's choice); everything around it is the kit's.
    'editor.background': DARK_PLUS.ground, 'editor.foreground': DARK_PLUS.text, 'editorCursor.foreground': text, 'editorGutter.background': DARK_PLUS.ground,
    'editorLineNumber.foreground': faint, 'editorLineNumber.activeForeground': text,
    'editor.selectionBackground': DARK_PLUS.selection, 'editor.inactiveSelectionBackground': DARK_PLUS.inactiveSelection, 'editor.selectionHighlightBackground': DARK_PLUS.selectionHighlight,
    'editor.lineHighlightBackground': NONE, 'editor.lineHighlightBorder': DARK_PLUS.lineBorder,
    'editor.findMatchBackground': c['warning-subtle'], 'editor.findMatchBorder': c.warning, 'editor.findMatchHighlightBackground': c['info-border'],
    'editorIndentGuide.background1': hair, 'editorIndentGuide.activeBackground1': line, 'editorWhitespace.foreground': line, 'editorRuler.foreground': hair,
    'editorBracketMatch.background': c.secondary, 'editorBracketMatch.border': c.ring,
    'editorError.foreground': c.destructive, 'editorWarning.foreground': c.warning, 'editorInfo.foreground': c.info, 'editorHint.foreground': soft,
    'editorOverviewRuler.border': NONE, 'editorOverviewRuler.errorForeground': c.destructive, 'editorOverviewRuler.warningForeground': c.warning, 'editorOverviewRuler.infoForeground': c.info,
    'editorWidget.background': c.popover, 'editorWidget.foreground': text, 'editorWidget.border': line,
    'editorHoverWidget.background': c.popover, 'editorHoverWidget.border': line, 'editorSuggestWidget.background': c.popover, 'editorSuggestWidget.border': line,
    'editorSuggestWidget.foreground': text, 'editorSuggestWidget.selectedBackground': held, 'editorSuggestWidget.highlightForeground': text,
    'editorGroup.border': hair, 'editorGroupHeader.tabsBackground': side, 'editorGroupHeader.tabsBorder': hair, 'editorGroupHeader.noTabsBackground': side,
    'peekView.border': line, 'peekViewEditor.background': raised, 'peekViewResult.background': side, 'peekViewTitle.background': side,
    'diffEditor.insertedTextBackground': c['success-subtle'], 'diffEditor.removedTextBackground': c['destructive-subtle'],
    // Tabs. The accent's one use: the line over the tab that is open.
    'tab.activeBackground': DARK_PLUS.ground, 'tab.activeForeground': text, 'tab.inactiveBackground': side, 'tab.inactiveForeground': soft, 'tab.border': hair,
    'tab.activeBorder': NONE, 'tab.activeBorderTop': c.brand, 'tab.unfocusedActiveBorderTop': line, 'tab.hoverBackground': c.secondary, 'tab.unfocusedActiveForeground': soft,
    // The bars around it.
    'activityBar.background': side, 'activityBar.foreground': text, 'activityBar.inactiveForeground': soft, 'activityBar.border': hair, 'activityBar.activeBorder': text,
    'activityBarBadge.background': c.primary, 'activityBarBadge.foreground': c['primary-foreground'],
    'sideBar.background': side, 'sideBar.foreground': c['sidebar-foreground'], 'sideBar.border': hair, 'sideBarTitle.foreground': text,
    'sideBarSectionHeader.background': side, 'sideBarSectionHeader.foreground': text, 'sideBarSectionHeader.border': hair,
    'titleBar.activeBackground': side, 'titleBar.activeForeground': text, 'titleBar.inactiveBackground': side, 'titleBar.inactiveForeground': soft, 'titleBar.border': hair,
    'statusBar.background': side, 'statusBar.foreground': soft, 'statusBar.border': hair, 'statusBar.noFolderBackground': side, 'statusBar.noFolderForeground': soft,
    'statusBar.debuggingBackground': side, 'statusBar.debuggingForeground': soft, 'statusBarItem.hoverBackground': c.secondary,
    'statusBarItem.remoteBackground': c.secondary, 'statusBarItem.remoteForeground': text, 'statusBarItem.errorBackground': c['destructive-subtle'], 'statusBarItem.errorForeground': text,
    'statusBarItem.warningBackground': c['warning-subtle'], 'statusBarItem.warningForeground': text,
    'panel.background': ground, 'panel.border': hair, 'panelTitle.activeForeground': text, 'panelTitle.inactiveForeground': soft, 'panelTitle.activeBorder': text,
    'panelSectionHeader.background': side, 'panelSection.border': hair,
    // Lists, menus, inputs, buttons.
    'list.activeSelectionBackground': held, 'list.activeSelectionForeground': text, 'list.inactiveSelectionBackground': c.secondary, 'list.inactiveSelectionForeground': text,
    'list.hoverBackground': c.secondary, 'list.focusBackground': held, 'list.focusOutline': c.ring, 'list.highlightForeground': text,
    'list.errorForeground': c.destructive, 'list.warningForeground': c.warning, 'tree.indentGuidesStroke': line,
    'menu.background': c.popover, 'menu.foreground': text, 'menu.selectionBackground': held, 'menu.selectionForeground': text, 'menu.border': line, 'menu.separatorBackground': hair,
    'menubar.selectionBackground': c.secondary, 'menubar.selectionForeground': text,
    'quickInput.background': c.popover, 'quickInput.foreground': text, 'quickInputTitle.background': side, 'quickInputList.focusBackground': held, 'quickInputList.focusForeground': text,
    'pickerGroup.foreground': soft, 'pickerGroup.border': hair, 'commandCenter.background': raised, 'commandCenter.border': line, 'commandCenter.foreground': soft,
    'input.background': raised, 'input.foreground': text, 'input.border': line, 'input.placeholderForeground': soft,
    'inputOption.activeBorder': c.ring, 'inputOption.activeBackground': held, 'inputOption.activeForeground': text,
    'inputValidation.errorBackground': c['destructive-subtle'], 'inputValidation.errorBorder': c.destructive, 'inputValidation.warningBackground': c['warning-subtle'], 'inputValidation.warningBorder': c.warning,
    'dropdown.background': c.popover, 'dropdown.foreground': text, 'dropdown.border': line, 'checkbox.background': raised, 'checkbox.border': line, 'checkbox.foreground': text,
    'button.background': c.primary, 'button.foreground': c['primary-foreground'], 'button.hoverBackground': c['primary-hover'], 'button.border': NONE,
    'button.secondaryBackground': c.secondary, 'button.secondaryForeground': text, 'button.secondaryHoverBackground': held,
    'badge.background': c.secondary, 'badge.foreground': text, 'progressBar.background': soft, 'keybindingLabel.background': c.secondary, 'keybindingLabel.foreground': text,
    'keybindingLabel.border': line, 'keybindingLabel.bottomBorder': line,
    'scrollbarSlider.background': line + '99', 'scrollbarSlider.hoverBackground': c.ring + '99', 'scrollbarSlider.activeBackground': c.ring + 'cc',
    'notifications.background': c.popover, 'notifications.foreground': text, 'notifications.border': line, 'notificationCenterHeader.background': side,
    'notificationsErrorIcon.foreground': c.destructive, 'notificationsWarningIcon.foreground': c.warning, 'notificationsInfoIcon.foreground': c.info,
    'problemsErrorIcon.foreground': c.destructive, 'problemsWarningIcon.foreground': c.warning, 'problemsInfoIcon.foreground': c.info,
    'breadcrumb.background': DARK_PLUS.ground, 'breadcrumb.foreground': soft, 'breadcrumb.focusForeground': text, 'breadcrumb.activeSelectionForeground': text, 'breadcrumbPicker.background': c.popover,
    'settings.headerForeground': text, 'settings.modifiedItemIndicator': soft, 'welcomePage.tileBackground': raised, 'walkThrough.embeddedEditorBackground': raised,
    // The terminal, on the kit's ground. Its sixteen colours are left to VS Code's own, as in Dark+.
    'terminal.background': ground, 'terminal.foreground': text, 'terminalCursor.foreground': text, 'terminal.selectionBackground': held, 'terminal.border': hair,
  };
  const d = DARK_PLUS;
  const rule = (name, scope, foreground, fontStyle) => ({ name, scope, settings: { foreground, ...(fontStyle ? { fontStyle } : {}) } });
  const tokenColors = [
    rule('comment', ['comment', 'punctuation.definition.comment'], d.comment),
    rule('string', ['string', 'string.quoted', 'string.template', 'meta.embedded.assembly'], d.string),
    rule('regular expression', ['string.regexp'], d.regexp),
    rule('escape', ['constant.character.escape'], d.escape),
    rule('number', ['constant.numeric', 'keyword.other.unit'], d.number),
    rule('keyword', ['keyword', 'storage', 'storage.type', 'storage.modifier', 'constant.language', 'meta.preprocessor', 'entity.name.tag', 'variable.language'], d.keyword),
    rule('control keyword', ['keyword.control', 'keyword.operator.new', 'keyword.other.using', 'keyword.other.operator'], d.control),
    rule('operator', ['keyword.operator', 'punctuation', 'meta.brace'], d.text),
    rule('type', ['entity.name.type', 'entity.name.class', 'entity.name.namespace', 'entity.name.scope-resolution', 'support.type', 'support.class', 'entity.other.inherited-class'], d.type),
    rule('function', ['entity.name.function', 'support.function', 'support.constant.handlebars'], d.function),
    rule('variable', ['variable', 'meta.definition.variable.name', 'support.variable', 'entity.name.variable', 'entity.other.attribute-name', 'support.type.property-name', 'meta.object-literal.key'], d.variable),
    rule('constant', ['variable.other.constant', 'variable.other.enummember'], d.constant),
    rule('invalid', ['invalid', 'invalid.illegal'], d.invalid),
    rule('markup heading', ['markup.heading', 'entity.name.section'], d.keyword, 'bold'),
    rule('markup bold', ['markup.bold'], d.keyword, 'bold'),
    rule('markup italic', ['markup.italic'], d.text, 'italic'),
    rule('markup inserted', ['markup.inserted'], d.number),
    rule('markup deleted', ['markup.deleted'], d.string),
  ];
  // LexLean is coloured by semantic tokens (src/lexlean-language.js gives these eight kinds), each as Dark+ colours
  // the same kind in any language.
  const semanticTokenColors = { keyword: d.keyword, type: d.type, string: d.string, number: d.number, operator: d.text, property: d.variable, namespace: d.type, comment: d.comment };
  return {
    $schema: 'vscode://schemas/color-theme',
    name: THEME_NAME,
    type: 'dark',
    semanticHighlighting: true,
    colors,
    tokenColors,
    semanticTokenColors,
  };
}

/**
 * What the kit asks of contrast, read off the theme: each pair with its ratio and the least it must reach.
 * Text is held to 4.5:1 and what marks a state or a place (the cursor, the focus ring, line numbers, the open tab's
 * line, icons) to 3:1. `hairlines` are listed and not held to anything: the kit draws its dividers as hairlines on
 * purpose, and a divider that only separates is not something a reader has to find.
 */
export function contrastReport(theme) {
  const k = theme.colors;
  const text = [
    ['text on the editor', k['editor.foreground'], k['editor.background']],
    ['muted text on the editor', k.descriptionForeground, k['editor.background']],
    ['text in the side bar', k['sideBar.foreground'], k['sideBar.background']],
    ['a tab that is not open', k['tab.inactiveForeground'], k['tab.inactiveBackground']],
    ['the open tab', k['tab.activeForeground'], k['tab.activeBackground']],
    ['the status bar', k['statusBar.foreground'], k['statusBar.background']],
    ['a panel title that is not open', k['panelTitle.inactiveForeground'], k['panel.background']],
    ['text in a field', k['input.foreground'], k['input.background']],
    ['a field\'s placeholder', k['input.placeholderForeground'], k['input.background']],
    ['a button', k['button.foreground'], k['button.background']],
    ['a button under the pointer', k['button.foreground'], k['button.hoverBackground']],
    ['a second button', k['button.secondaryForeground'], k['button.secondaryBackground']],
    ['a badge', k['badge.foreground'], k['badge.background']],
    ['a selected row', k['list.activeSelectionForeground'], k['list.activeSelectionBackground']],
    ['a menu', k['menu.foreground'], k['menu.background']],
    ['selected text in the editor', k['editor.foreground'], k['editor.selectionBackground']],
    ['muted text over the code (the breadcrumb)', k['breadcrumb.foreground'], k['breadcrumb.background']],
    ['selected text when the editor is not in use', k['editor.foreground'], k['editor.inactiveSelectionBackground']],
    ['an error\'s text', k.errorForeground, k['editor.background']],
    ['a warning in a list', k['list.warningForeground'], k['sideBar.background']],
    ['a link', k['textLink.foreground'], k['editor.background']],
    ['the terminal', k['terminal.foreground'], k['terminal.background']],
    ...Object.entries(theme.semanticTokenColors).map(([kind, color]) => [`code: ${kind}`, color, k['editor.background']]),
    ...theme.tokenColors.map((r) => [`code in other languages: ${r.name}`, r.settings.foreground, k['editor.background']]),
  ].map(([what, color, ground]) => ({ what, color, ground, least: 4.5 }));
  const marks = [
    ['the cursor', k['editorCursor.foreground'], k['editor.background']],
    ['the focus ring', k.focusBorder, k['editor.background']],
    ['the focus ring on a field', k.focusBorder, k['input.background']],
    ['line numbers', k['editorLineNumber.foreground'], k['editor.background']],
    ['the line over the open tab', k['tab.activeBorderTop'], k['tab.activeBackground']],
    ['icons', k['icon.foreground'], k['sideBar.background']],
    ['an error\'s underline', k['editorError.foreground'], k['editor.background']],
    ['a warning\'s underline', k['editorWarning.foreground'], k['editor.background']],
    ['the bracket that matches', k['editorBracketMatch.border'], k['editor.background']],
  ].map(([what, color, ground]) => ({ what, color, ground, least: 3 }));
  const held = [...text, ...marks].map((pair) => ({ ...pair, ratio: Math.round(contrast(pair.color, pair.ground) * 100) / 100 }));
  const hairlines = [
    ['a divider', k['panel.border'], k['panel.background']],
    ['a field\'s edge', k['input.border'], k['panel.background']],
    ['an indent guide', k['editorIndentGuide.background1'], k['editor.background']],
  ].map(([what, color, ground]) => ({ what, color, ground, ratio: Math.round(contrast(color, ground) * 100) / 100 }));
  // Dark+'s own selection colour under Dark+'s own code colours: listed, and held to nothing. It is what VS Code shows.
  const selected = Object.entries(theme.semanticTokenColors).map(([kind, color]) => ({ what: `code: ${kind}, selected`, color, ground: k['editor.selectionBackground'], ratio: Math.round(contrast(color, k['editor.selectionBackground']) * 100) / 100 }));
  return { held, failing: held.filter((pair) => pair.ratio < pair.least), hairlines, selected };
}

/** The tokens as CSS variables, for the page's own strip: the dark set, each colour that is not opaque laid over the ground. */
export function cssOf(tokens, c) {
  const font = tokens.global?.font?.family ?? {};
  const lines = Object.entries(c).map(([name, value]) => `  --hg-${name}: ${value.length === 9 && !['scrim', 'shadow'].includes(name) ? over(value, c.background) : value};`);
  for (const [name, token] of Object.entries(font)) if (typeof token?.$value === 'string') lines.push(`  --hg-font-${name}: ${token.$value};`);
  return `/* Written by tools/build-theme.mjs from the Hologram brand kit's tokens (${PINS.repository} at ${PINS.commit.slice(0, 7)},\n * ${PINS.files.tokens.path}, the "${PINS.set}" set). Do not edit: change the mapping in that tool, or the pin. */\n:root {\n${lines.join('\n')}\n}\n`;
}

/** Both files, as text, from the tokens. */
export function generate(tokens) {
  const c = colorsOf(tokens);
  const theme = themeOf(c);
  return { theme, themeText: JSON.stringify(theme, null, 1) + '\n', cssText: cssOf(tokens, c) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { theme, themeText, cssText } = generate(await pinnedTokens(process.argv[2] ?? null));
  const report = contrastReport(theme);
  for (const pair of report.failing) console.error(`too little contrast: ${pair.what}, ${pair.color} on ${pair.ground}, ${pair.ratio}:1, needs ${pair.least}:1`);
  if (report.failing.length) process.exit(1);
  mkdirSync(dirname(THEME_FILE), { recursive: true });
  writeFileSync(THEME_FILE, themeText);
  writeFileSync(CSS_FILE, cssText);
  const least = report.held.reduce((a, b) => (b.ratio - b.least < a.ratio - a.least ? b : a));
  console.log(`${THEME_NAME}: ${Object.keys(theme.colors).length} colours, ${theme.tokenColors.length} scope rules, ${Object.keys(theme.semanticTokenColors).length} semantic kinds`);
  console.log(`contrast: ${report.held.length} pairs held; the closest to its limit is ${least.what}, ${least.ratio}:1 against ${least.least}:1`);
  console.log(`hairlines, not held: ${report.hairlines.map((h) => `${h.what} ${h.ratio}:1`).join(', ')}`);
  console.log(`selected code, Dark+'s own colours, not held: ${report.selected.map((h) => `${h.what.slice(6, -10)} ${h.ratio}:1`).join(', ')}`);
}
