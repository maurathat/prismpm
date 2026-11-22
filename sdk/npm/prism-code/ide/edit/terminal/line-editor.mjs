// Keys into lines, with the editing a terminal user expects. No DOM and no xterm.js here, so Node can test it.
//
//   Left, Right, Home, End, Ctrl+A, Ctrl+E        move within the line
//   Ctrl+Left, Ctrl+Right, Alt+B, Alt+F           move by a word
//   Backspace, Delete, Ctrl+D                     remove a character
//   Ctrl+U, Ctrl+K, Ctrl+W, Alt+Backspace, Alt+D  cut to the start, to the end, a word back, a word on
//   Ctrl+Y                                        put back what was last cut
//   Up, Down, Ctrl+P, Ctrl+N                      walk the history
//   Ctrl+R                                        search the history; again for an older match
//   Tab                                           complete a command name or a file; twice lists what fits
//   Ctrl+C                                        abandon the line, or stop the running command
//   Ctrl+L                                        clear the screen
//   Ctrl+S, Ctrl+Q                                hold what a running command is writing, and let it go
//
// Several lines arriving at once (a paste) are one block: shown, then entered together, so a loop written over
// several lines is read whole. They are entered only when `multiline(lines)` says so.
//
// A key is echoed in the same turn it arrives: nothing here waits on anything. A character is as wide as terminals
// draw it: two columns for the wide scripts and most emoji, none for a mark that joins the character before it.

import { visible } from './session.mjs';

/**
 * `echo(text)` writes to the terminal at once; `submit(line)` runs a line and resolves when it is done;
 * `interrupt()` stops the running command; `clear()` clears the screen; `prompt()` is the prompt now;
 * `complete(before)` resolves { from, options } for the word the cursor is in (shell.mjs).
 */
/** The columns a character takes: 0 for a joining mark, 2 for a wide character, 1 otherwise. */
export function columns(ch) {
  const c = ch.codePointAt(0);
  if (c < 0x300) return 1;
  if (/^[\p{Mn}\p{Me}\u200b-\u200d\ufe00-\ufe0f]$/u.test(ch)) return 0;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f)
    || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)) return 2;
  return 1;
}
const span = (chars) => chars.reduce((n, ch) => n + columns(ch), 0);

export function createLineEditor({ echo, submit, interrupt, clear, complete, prompt = () => 'model> ', hold = () => {}, release = () => {}, multiline = async () => false }) {
  let chars = [];
  let cursor = 0;
  let busy = false;
  let cut = '';
  let tabbed = false;
  // A history search in progress: what was typed, and which line it has found.
  let search = null;
  // Keys pressed while a command runs: entered, in order, when it is done.
  const ahead = [];
  const history = [];
  let at = 0;
  const text = () => chars.join('');
  /** Draw the line again from its start and put the cursor where it belongs. */
  const back = (n) => (n > 0 ? `\x1b[${n}D` : '');
  const redraw = () => echo('\r\x1b[K' + prompt() + text() + back(span(chars.slice(cursor))));
  const set = (next, where = null) => { chars = [...next]; cursor = where ?? chars.length; redraw(); };
  const done = async () => { busy = false; echo(prompt()); while (ahead.length && !busy) await feed(ahead.shift()); };
  const enter = (block = null) => {
    // A block is shown as it will be read, each further line marked, then entered whole.
    const line = block ?? text();
    if (block !== null) echo('\r\x1b[K' + prompt() + visible(block).split('\n').join('\r\n> '));
    echo('\r\n');
    chars = [];
    cursor = 0;
    const kept = line.replace(/\n/g, '; ');
    if (kept.trim() && history[history.length - 1] !== kept) history.push(kept);
    at = history.length;
    busy = true;
    return Promise.resolve(submit(line)).catch((error) => echo(visible(String(error?.message ?? error)).replace(/\n/g, '\r\n') + '\r\n')).then(done);
  };
  const insert = (data) => {
    const added = [...visible(data).replace(/[\n\t]/g, ' ')];
    chars.splice(cursor, 0, ...added);
    cursor += added.length;
    // At the end of the line a key is just echoed; in the middle the rest of the line moves.
    if (cursor === chars.length) echo(added.join('')); else redraw();
  };
  const wordStart = () => { let i = cursor; while (i > 0 && chars[i - 1] === ' ') i--; while (i > 0 && chars[i - 1] !== ' ') i--; return i; };
  const wordEnd = () => { let i = cursor; while (i < chars.length && chars[i] === ' ') i++; while (i < chars.length && chars[i] !== ' ') i++; return i; };
  const take = (from, to) => { cut = chars.splice(from, to - from).join(''); cursor = from; redraw(); };

  const searchDraw = () => echo('\r\x1b[K' + `(search)'${search.query}': ` + (search.found < 0 ? '' : history[search.found]));
  /** The newest line before `before` that holds the query, or -1. */
  const searchFrom = (before) => { for (let i = before - 1; i >= 0; i--) if (history[i].includes(search.query)) return i; return -1; };
  const searchEnd = (keep) => {
    const line = keep && search.found >= 0 ? history[search.found] : search.was;
    search = null;
    set(line);
  };
  /** A key while searching. Resolves whether the key was used up. */
  function searching(data) {
    if (data === '\x12') { const older = searchFrom(search.found < 0 ? history.length : search.found); if (older >= 0) search.found = older; searchDraw(); return true; }
    if (data === '\x7f') { search.query = search.query.slice(0, -1); search.found = search.query ? searchFrom(history.length) : -1; searchDraw(); return true; }
    if (data === '\x03' || data === '\x07') { searchEnd(false); return true; }
    if (data === '\x1b') { searchEnd(true); return true; }
    if (data === '\r') { searchEnd(true); return false; }
    if (data.startsWith('\x1b') || data < ' ') { searchEnd(true); return false; }
    search.query += visible(data).replace(/[\n\t]/g, ' ');
    search.found = searchFrom(history.length);
    searchDraw();
    return true;
  }

  function tab() {
    if (!complete) return;
    const before = chars.slice(0, cursor).join('');
    const { from, options } = complete(before);
    if (options.length === 0) return;
    const word = before.slice(from);
    // As far as every option agrees.
    let common = options[0];
    for (const option of options) { let n = 0; while (n < common.length && common[n] === option[n]) n++; common = common.slice(0, n); }
    if (options.length > 1) common = common.trimEnd();
    if (common.length > word.length) {
      const added = [...common.slice(word.length)];
      chars.splice(cursor, 0, ...added);
      cursor += added.length;
      redraw();
    } else if (options.length > 1 && tabbed) {
      // A second Tab with nothing more to add: list what fits, then the line again.
      echo('\r\n' + options.map((o) => visible(o.trimEnd())).join('  ') + '\r\n');
      redraw();
    }
    return options.length > 1;
  }

  const keys = {
    '\r': () => enter(),
    '\x7f': () => { if (cursor > 0) { chars.splice(--cursor, 1); redraw(); } },
    '\x1b[3~': () => { if (cursor < chars.length) { chars.splice(cursor, 1); redraw(); } },
    '\x04': () => { if (cursor < chars.length) { chars.splice(cursor, 1); redraw(); } },
    '\x03': () => { echo('^C\r\n'); chars = []; cursor = 0; at = history.length; echo(prompt()); },
    '\x0c': () => { clear(); redraw(); },
    '\x1b[A': () => { if (at > 0) set(history[--at]); },
    '\x1b[B': () => { if (at < history.length) { at++; set(history[at] ?? ''); } },
    '\x1b[D': () => { if (cursor > 0) { cursor--; echo(back(columns(chars[cursor]))); } },
    '\x1b[C': () => { if (cursor < chars.length) { const n = columns(chars[cursor++]); if (n > 0) echo(`\x1b[${n}C`); } },
    '\x01': () => { cursor = 0; redraw(); },
    '\x05': () => { cursor = chars.length; redraw(); },
    '\x15': () => take(0, cursor),
    '\x0b': () => take(cursor, chars.length),
    '\x17': () => take(wordStart(), cursor),
    '\x1b\x7f': () => take(wordStart(), cursor),
    '\x1bd': () => take(cursor, wordEnd()),
    '\x19': () => { if (cut) insert(cut); },
    '\x1bb': () => { cursor = wordStart(); redraw(); },
    '\x1bf': () => { cursor = wordEnd(); redraw(); },
    '\x12': () => { search = { query: '', found: -1, was: text() }; searchDraw(); },
    '\t': () => tab(),
  };
  keys['\x10'] = keys['\x1b[A'];
  keys['\x0e'] = keys['\x1b[B'];
  // Home, End and the word moves, as terminals variously send them.
  for (const home of ['\x1b[H', '\x1bOH', '\x1b[1~']) keys[home] = keys['\x01'];
  for (const end of ['\x1b[F', '\x1bOF', '\x1b[4~']) keys[end] = keys['\x05'];
  for (const back of ['\x1b[1;5D', '\x1b[1;3D', '\x1b[5D']) keys[back] = keys['\x1bb'];
  for (const on of ['\x1b[1;5C', '\x1b[1;3C', '\x1b[5C']) keys[on] = keys['\x1bf'];

  /** What the terminal reports for a key press, or a pasted line. */
  async function feed(data) {
    if (busy) {
      if (data === '\x03') { ahead.length = 0; interrupt(); echo('^C\r\n'); } else if (data === '\x13') hold(); else if (data === '\x11') release(); else ahead.push(data);
      return;
    }
    // Several lines at once are a paste: one block, entered whole, and only when the page says it may be.
    if (data.length > 1 && /[\r\n]/.test(data) && !data.startsWith('\x1b')) {
      const block = data.split(/\r\n|\r|\n/).filter((l) => l.trim()).map((l) => l.replace(/\t/g, ' '));
      if (block.length === 0) return;
      if (block.length === 1) { insert(block[0]); return; }
      if (await multiline(block)) return enter(block.join('\n'));
      echo('\r\n' + `(${block.length} pasted lines were not entered)` + '\r\n');
      redraw();
      return;
    }
    if (search && searching(data)) return;
    const again = data === '\t' && tabbed;
    tabbed = false;
    if (data === '\t') { tabbed = again; tabbed = tab() === true; return; }
    if (keys[data]) return keys[data]();
    // Any other control sequence a key sends (function keys, modified arrows) does nothing.
    if (data.startsWith('\x1b')) return;
    insert(data);
  }
  return {
    start() { echo(prompt()); },
    get busy() { return busy; },
    get line() { return text(); },
    get searching() { return search !== null; },
    feed,
    /** Lines the user chose to paste: each is entered in turn. */
    async lines(texts) {
      const block = texts.filter((l) => l.trim()).map((l) => l.replace(/\t/g, ' '));
      if (block.length === 0) return;
      if (busy) { ahead.push(block.join('\n') + (block.length === 1 ? '\r' : '')); return; }
      if (block.length === 1) { set(visible(block[0])); await enter(); } else await enter(block.join('\n'));
    },
  };
}
