// The terminal of the edit page: xterm.js, with the command line of programs.mjs behind it.
//
// xterm.js is the real emulator (@xterm/xterm, MIT), published beside the page as the files npm ships. Each file is
// run only when its bytes hash to the BLAKE3 label pins.json names. It draws what is written to it and reports
// keys; it runs nothing. What answers the keys is shell.mjs: a fixed list of commands, each judged by the proved
// tables before it runs. There is no native program and no connection to any machine here.
//
// Phase 2f of docs/proposals/prism-ide-phase-2.md. The same command line is the terminal panel of the workbench
// page (../../src/model-terminal.js).

import { kappa } from '../prism-code/blake3.mjs';
import * as rules from '../prism-code/journey/rule-table.mjs';
import { reuseAdmits } from '../prism-code/journey/kappa-rules.mjs';
import { createEffects } from './effects.mjs';
import { createKeptIn, openStore } from './kappa-space.mjs';
import { createCommandLine } from './programs.mjs';

const here = (path) => new URL(path, import.meta.url).href;
const json = async (url) => (await fetch(url, { cache: 'no-store' })).json();

/** A published file of xterm.js, or a refusal: its bytes are used only when they are the pinned ones. */
async function admitted(pins, name) {
  const want = pins.files[name];
  if (!want) throw new Error(`${name} is not a pinned file`);
  const response = await fetch(here('../vendor/xterm/' + name));
  if (!response.ok) throw new Error(`${name} is not beside the page (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const label = kappa(bytes);
  if (label !== want.kappa) throw new Error(`${name} hashes to ${label}, not the pinned ${want.kappa}`);
  return bytes;
}
async function module(pins, name) {
  const url = URL.createObjectURL(new Blob([await admitted(pins, name)], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

/**
 * Start the terminal in `element`. The page hands over what it already has:
 *   project()            the model as it is in the editor: { '/path': text }
 *   check, snapshotOf    the LexLean worker's two questions
 *   prove(words, gs)     the kernel worker's
 *   held()               resolves { lexlean, kernel }, each 'pinned' | 'mismatch' | 'absent', once each has settled
 *   pin                  the LexLean executable's pin
 *   setTitle(text)       where a title set by output is shown
 *   find                 an input the user types a search into, or nothing
 *   change               { write(path, text), remove(path) }: how the page changes a file of the model
 */
export async function startTerminal(element, { project, check, snapshotOf, prove, held, pin, setTitle, find = null, change = null }) {
  const started = performance.now();
  // `timing` says when each part of starting was done, in milliseconds since the terminal was asked to start.
  const state = (window.prismTerminal = { ready: false, error: null, timing: {} });
  const done = (what) => { state.timing[what] = Math.round(performance.now() - started); };
  try {
    const [pins, published, manifest, store] = await Promise.all([json(here('./pins.json')), json(here('./tables.json')), json(here('../kernel/manifest.json')).catch(() => null), openStore({ kappa })]);
    done('tables');
    // The fast renderer is fetched with the rest and put in after the prompt is drawn, so the prompt does not wait for it.
    const fast = module(pins, 'addon-webgl.mjs').catch((error) => ({ error }));
    const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { SearchAddon }, { Unicode11Addon }, css] = await Promise.all([
      module(pins, 'xterm.mjs'), module(pins, 'addon-fit.mjs'), module(pins, 'addon-web-links.mjs'), module(pins, 'addon-search.mjs'), module(pins, 'addon-unicode11.mjs'), admitted(pins, 'xterm.css'),
    ]);
    document.head.append(Object.assign(document.createElement('style'), { textContent: new TextDecoder().decode(css) }));
    done('emulator');

    let term;
    const line = createCommandLine({
      tables: published.tables, luts: published.luts, rules, kappa, reuseAdmits, project, check, snapshotOf, prove, held, pin, manifest,
      sink: (bytes, done) => term.write(bytes, done), echo: (text) => term.write(text), clear: () => term.clear(), kept: createKeptIn(store), change,
    });
    const effects = createEffects({ judge: line.judge, ui: { setTitle, confirm: async (text) => window.confirm(text), open: (uri) => window.open(uri, '_blank', 'noopener,noreferrer') } });
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    term = new Terminal({
      scrollback: 10000, fontSize: 13, fontFamily: 'ui-monospace, Consolas, monospace', cursorBlink: true,
      // The Unicode 11 width table is one of xterm.js's proposed interfaces.
      allowProposedApi: true,
      theme: dark ? { background: '#161513', foreground: '#ece9e3', cursor: '#ece9e3' } : { background: '#fbfaf8', foreground: '#1d1c1a', cursor: '#1d1c1a', selectionBackground: '#c9d7ee' },
      linkHandler: effects.linkHandler,
    });
    effects.install(term);
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.loadAddon(new WebLinksAddon((event, uri) => effects.link(event, uri)));
    term.open(element);
    fit.fit();
    done('opened');
    new ResizeObserver(() => fit.fit()).observe(element);

    term.onData((data) => { line.editor.feed(data); });
    // A paste goes to the effects table before the terminal sees it.
    element.addEventListener('paste', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const got = await effects.paste(event, event.clipboardData?.getData('text/plain') ?? '');
      if (got?.lines) line.editor.lines(got.lines); else if (got?.text) line.editor.feed(got.text);
    }, true);
    // Search in what is on the screen and above it: Enter for the next match, Shift+Enter for the one before.
    if (find) {
      find.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) search.findPrevious(find.value); else search.findNext(find.value); }
        if (event.key === 'Escape') { find.value = ''; search.clearDecorations(); term.focus(); }
      });
      find.addEventListener('input', () => search.findNext(find.value, { incremental: true }));
    }

    term.writeln(line.greeting);
    line.editor.start();
    // When the prompt was drawn: since the page was opened, and since the terminal was asked to start.
    term.write('', () => { state.promptMs = Math.round(performance.now()); state.startMs = Math.round(performance.now() - started); done('prompt'); });
    state.renderer = 'dom';
    Object.assign(state, { ready: true, term, search, session: line.session, effects, writer: line.writer, editor: line.editor, judge: line.judge, pins, luts: line.luts, durable: store.durable, tables: Object.fromEntries(Object.entries(published.tables).map(([name, t]) => [name, t.semanticId])) });
    // The fast renderer where the browser has WebGL2; xterm.js's own DOM renderer otherwise, and after a lost context.
    try {
      const { WebglAddon, error } = await fast;
      if (error) throw error;
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => { webgl.dispose(); state.renderer = 'dom'; });
      term.loadAddon(webgl);
      state.renderer = 'webgl';
    } catch (error) { state.rendererWhy = String(error?.message ?? error); }
    done('renderer');
  } catch (error) {
    state.error = String(error?.message ?? error);
    element.textContent = 'The terminal could not start: ' + state.error;
  }
  return state;
}
