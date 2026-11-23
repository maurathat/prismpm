// The workbench's colour theme, generated from the Hologram brand kit's tokens.
//
// The kit (Hologram-Technologies/hologram-brand-kit) is the source of truth: its DTCG file,
// brand/tokens/hologram-tokens.json, at the commit tools/brand-pins.json names, taken only as the bytes its BLAKE3
// label names. Nothing of the kit is copied by hand. This file says which token colours which part of the workbench,
// and writes:
//
//   src/theme/hologram-dark.json     a VS Code colour theme: the workbench's colours, the scopes other languages are
//                                    coloured by, and the semantic tokens LexLean is coloured by
//   src/theme/hologram-tokens.css    the same tokens as CSS variables, for the strip above the workbench (model.html)
//
// Both are committed, so building the workbench needs no network; tools/theme-test.mjs holds them to what this file
// generates from the pinned tokens, and to the contrast the kit asks for.
//
// What the kit does not have: colours for code. It names a ground, text, muted text, borders, three states (success,
// warning, destructive) and one accent, which it allows once in a view and never as a general highlight. So code is
// coloured from the text tokens, by weight and slant more than by hue, and the accent is used for one thing: the
// line over the tab that is open.
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
    'editor.background': ground, 'editor.foreground': text, 'editorCursor.foreground': text, 'editorGutter.background': ground,
    'editorLineNumber.foreground': faint, 'editorLineNumber.activeForeground': text,
    'editor.selectionBackground': held, 'editor.inactiveSelectionBackground': c.secondary, 'editor.selectionHighlightBackground': c.secondary, 'editor.wordHighlightBackground': c.secondary,
    'editor.wordHighlightStrongBackground': held, 'editor.lineHighlightBackground': raised, 'editor.lineHighlightBorder': NONE,
    'editor.findMatchBackground': c['warning-subtle'], 'editor.findMatchBorder': c.warning, 'editor.findMatchHighlightBackground': c['info-border'],
    'editorIndentGuide.background1': hair, 'editorIndentGuide.activeBackground1': line, 'editorWhitespace.foreground': line, 'editorRuler.foreground': hair,
    'editorBracketMatch.background': c.secondary, 'editorBracketMatch.border': c.ring,
    'editorBracketHighlight.foreground1': soft, 'editorBracketHighlight.foreground2': soft, 'editorBracketHighlight.foreground3': soft,
    'editorError.foreground': c.destructive, 'editorWarning.foreground': c.warning, 'editorInfo.foreground': c.info, 'editorHint.foreground': soft,
    'editorOverviewRuler.border': NONE, 'editorOverviewRuler.errorForeground': c.destructive, 'editorOverviewRuler.warningForeground': c.warning, 'editorOverviewRuler.infoForeground': c.info,
    'editorWidget.background': c.popover, 'editorWidget.foreground': text, 'editorWidget.border': line,
    'editorHoverWidget.background': c.popover, 'editorHoverWidget.border': line, 'editorSuggestWidget.background': c.popover, 'editorSuggestWidget.border': line,
    'editorSuggestWidget.foreground': text, 'editorSuggestWidget.selectedBackground': held, 'editorSuggestWidget.highlightForeground': text,
    'editorGroup.border': hair, 'editorGroupHeader.tabsBackground': side, 'editorGroupHeader.tabsBorder': hair, 'editorGroupHeader.noTabsBackground': side,
    'peekView.border': line, 'peekViewEditor.background': raised, 'peekViewResult.background': side, 'peekViewTitle.background': side,
    'diffEditor.insertedTextBackground': c['success-subtle'], 'diffEditor.removedTextBackground': c['destructive-subtle'],
    // Tabs. The accent's one use: the line over the tab that is open.
    'tab.activeBackground': ground, 'tab.activeForeground': text, 'tab.inactiveBackground': side, 'tab.inactiveForeground': soft, 'tab.border': hair,
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
    'breadcrumb.background': ground, 'breadcrumb.foreground': soft, 'breadcrumb.focusForeground': text, 'breadcrumb.activeSelectionForeground': text, 'breadcrumbPicker.background': c.popover,
    'settings.headerForeground': text, 'settings.modifiedItemIndicator': soft, 'welcomePage.tileBackground': raised, 'walkThrough.embeddedEditorBackground': raised,
    // The terminal. Its colours are the state tokens; the kit has no blue, magenta or cyan, so those three are greys.
    'terminal.background': ground, 'terminal.foreground': text, 'terminalCursor.foreground': text, 'terminal.selectionBackground': held, 'terminal.border': hair,
    'terminal.ansiBlack': raised, 'terminal.ansiRed': c.destructive, 'terminal.ansiGreen': c.success, 'terminal.ansiYellow': c.warning,
    'terminal.ansiBlue': c['chart-2'], 'terminal.ansiMagenta': c['chart-3'], 'terminal.ansiCyan': soft, 'terminal.ansiWhite': text,
    'terminal.ansiBrightBlack': faint, 'terminal.ansiBrightRed': c.destructive, 'terminal.ansiBrightGreen': c.success, 'terminal.ansiBrightYellow': c.warning,
    'terminal.ansiBrightBlue': text, 'terminal.ansiBrightMagenta': c['chart-2'], 'terminal.ansiBrightCyan': text, 'terminal.ansiBrightWhite': text,
  };
  // Code. Hue is kept for what a reader must not miss: a string is the success green, the one hue the kit has that
  // is not a warning. The rest is told apart by weight and slant on the text tokens.
  const code = {
    comment: { foreground: soft, fontStyle: 'italic' },
    keyword: { foreground: text, fontStyle: 'bold' },
    type: { foreground: c['primary-hover'], fontStyle: 'italic' },
    string: { foreground: c.success, fontStyle: '' },
    number: { foreground: c['chart-2'], fontStyle: '' },
    operator: { foreground: soft, fontStyle: '' },
    property: { foreground: c['chart-2'], fontStyle: '' },
    namespace: { foreground: soft, fontStyle: 'italic' },
  };
  const scopes = {
    comment: ['comment', 'punctuation.definition.comment'],
    keyword: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control'],
    type: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'],
    string: ['string', 'string.quoted', 'string.template', 'constant.other.symbol'],
    number: ['constant.numeric', 'constant.language', 'constant.character'],
    operator: ['keyword.operator', 'punctuation', 'meta.brace'],
    property: ['variable.other.property', 'support.type.property-name', 'entity.other.attribute-name', 'meta.object-literal.key', 'entity.name.tag'],
    namespace: ['entity.name.namespace', 'entity.name.module', 'support.module'],
  };
  const tokenColors = [
    ...Object.entries(scopes).map(([kind, scope]) => ({ name: kind, scope, settings: { foreground: code[kind].foreground, ...(code[kind].fontStyle ? { fontStyle: code[kind].fontStyle } : {}) } })),
    { name: 'function', scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: text } },
    { name: 'variable', scope: ['variable', 'variable.parameter', 'meta.definition.variable'], settings: { foreground: text } },
    { name: 'invalid', scope: ['invalid', 'invalid.illegal'], settings: { foreground: c.destructive } },
    { name: 'markup heading', scope: ['markup.heading', 'entity.name.section'], settings: { foreground: text, fontStyle: 'bold' } },
    { name: 'markup', scope: ['markup.inserted'], settings: { foreground: c.success } },
    { name: 'markup deleted', scope: ['markup.deleted'], settings: { foreground: c.destructive } },
  ];
  // LexLean is coloured by semantic tokens (src/lexlean-language.js gives these eight kinds).
  const semanticTokenColors = Object.fromEntries(Object.entries(code).map(([kind, style]) => [kind, { foreground: style.foreground, bold: style.fontStyle.includes('bold'), italic: style.fontStyle.includes('italic') }]));
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
    ['text on the line the cursor is on', k['editor.foreground'], k['editor.lineHighlightBackground']],
    ['an error\'s text', k.errorForeground, k['editor.background']],
    ['a warning in a list', k['list.warningForeground'], k['sideBar.background']],
    ['a link', k['textLink.foreground'], k['editor.background']],
    ['the terminal', k['terminal.foreground'], k['terminal.background']],
    ...['Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'].map((name) => [`the terminal's ${name.toLowerCase()}`, k['terminal.ansi' + name], k['terminal.background']]),
    ...Object.entries(theme.semanticTokenColors).map(([kind, style]) => [`code: ${kind}`, style.foreground, k['editor.background']]),
    ...Object.entries(theme.semanticTokenColors).map(([kind, style]) => [`code: ${kind}, on the cursor's line`, style.foreground, k['editor.lineHighlightBackground']]),
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
    ['a divider', k['panel.border'], k['editor.background']],
    ['a field\'s edge', k['input.border'], k['editor.background']],
    ['an indent guide', k['editorIndentGuide.background1'], k['editor.background']],
  ].map(([what, color, ground]) => ({ what, color, ground, ratio: Math.round(contrast(color, ground) * 100) / 100 }));
  return { held, failing: held.filter((pair) => pair.ratio < pair.least), hairlines };
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
}
