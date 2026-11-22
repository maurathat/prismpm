// What the terminal's command line stands on: asking a proved table, writing output as text, holding it under flow
// control, and keeping a program's output. No DOM and no xterm.js here, so Node can test it.
//
// The command language is shell.mjs; the keys are line-editor.mjs. Every line is put to the proved command table
// (model/ide-terminal-commands), every use of a resource by a running command to the reach table
// (model/ide-terminal-reach), and every piece of output waits on the flow table (model/ide-terminal-flow).

const enc = new TextEncoder();

/**
 * Ask a table. `tables` is { name: table as rule-table.mjs reads it }, `judgeTable` is that module's own judge.
 * `words` is { field name: word or number }. A word the table does not list throws: the caller refuses.
 */
export function makeJudge(tables, judgeTable, luts = {}) {
  return (name, words) => {
    // A table that was materialized (kappa-space.mjs) answers with one read; `luts` is { name: { bytes, sizes } }.
    const lut = luts[name];
    const table = tables[name];
    if (!table) throw new Error(`there is no ${name} table`);
    const request = table.fields.map((f) => {
      const given = words[f.name];
      if (f.kind === 'choice') {
        const at = f.values.indexOf(given);
        if (at < 0) throw new Error(`${name}: ${f.name} has no value "${given}"`);
        return at;
      }
      if (!Number.isInteger(given) || given < f.least) throw new Error(`${name}: ${f.name} is not a number from ${f.least}`);
      // Past the field's top the answer is the top's: the table's bounds are the terminal's own buffer.
      return Math.min(given, f.greatest);
    });
    if (lut) return table.answers[lut.bytes[request.reduce((at, value, f) => at * lut.sizes[f] + value, 0)]];
    return table.answers[judgeTable(table, request).answer];
  };
}

/** Text as a terminal may safely show it: every control byte but a line break and a tab is written out. */
export function visible(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => {
    const n = c.charCodeAt(0);
    return n < 0x20 ? '^' + String.fromCharCode(n + 64) : n === 0x7f ? '^?' : '\\x' + n.toString(16);
  });
}

/**
 * Output on its way to the terminal, held by the flow table. `sink(bytes, drained)` is the terminal's write.
 * `drained()` says the whole piece has been drawn; `drained(n)` says n more of it has, for a terminal that
 * acknowledges in batches. A sink that counts in something other than bytes returns the piece's size in its own
 * unit and drains in that unit. `write` resolves when the last piece has been handed over; `stop` drops what has
 * not been.
 */
export function createWriter({ judge, sink, piece = 16384 }) {
  let pending = 0;
  let paused = false;
  let stopped = false;
  let wake = null;
  const state = { peak: 0, holds: 0 };
  const settled = () => new Promise((resolve) => { wake = resolve; });
  return {
    state,
    stop() { stopped = true; wake?.(); },
    /** A new line starts: what the last one was stopped from writing stays unwritten. */
    resume() { stopped = false; },
    async write(text) {
      const bytes = enc.encode(text.replace(/\r?\n/g, '\r\n'));
      for (let at = 0; at < bytes.length; at += piece) {
        for (;;) {
          if (stopped) return false;
          if (judge('flow', { pending, paused: paused ? 'yes' : 'no' }) === 'write') { paused = false; break; }
          paused = true;
          state.holds++;
          await settled();
        }
        const part = bytes.subarray(at, at + piece);
        let left = part.length;
        pending += left;
        const drained = (n = left) => { const took = Math.min(left, n); left -= took; pending -= took; const go = wake; wake = null; go?.(); };
        const size = sink(part, drained);
        // The sink's own count of the piece, when it gave one and has drawn none of it yet.
        if (Number.isInteger(size) && left === part.length) { pending += size - left; left = size; }
        state.peak = Math.max(state.peak, pending);
      }
      return true;
    },
  };
}

/**
 * A program's output kept in this tab, by the label of what made it. Nothing here outlives the tab;
 * kept-opfs.mjs keeps the same entries between visits. `get` and `set` may be asynchronous.
 */
export function createKept() {
  const entries = new Map();
  return { get: (key) => entries.get(key) ?? null, set: (key, entry) => { entries.set(key, entry); }, size: () => entries.size };
}
