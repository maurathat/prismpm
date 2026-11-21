// The workbench's own terminal panel, answered by the Prism command line.
//
// The panel, its tabs, its find box, its renderer and its xterm.js are the workbench's (VS Code's terminal, through
// @codingame/monaco-vscode-terminal-service-override). VS Code's terminal expects a process behind it. In a browser
// there is none, so the "process" here is the command line of ../edit/terminal: the same fixed list of commands,
// judged by the same proved tables, as the plain edit page's terminal. There is no shell behind this panel.
//
// What differs from the plain page, and why:
//   - Output cannot carry a control sequence here either: the command line writes every command's output as text.
//     That is the whole defence in this panel, because the emulator and its handlers are the workbench's, not ours.
//   - Links and paste are handled by the workbench as VS Code handles them; the effects table is not asked.
//   - Flow control is VS Code's own acknowledgement of what it has drawn, counted in characters, put to the same
//     flow table.

import getTerminalOverride, { SimpleTerminalBackend, SimpleTerminalProcess } from '@codingame/monaco-vscode-terminal-service-override';
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';

/**
 * The service override for `initialize`. `makeLine({ sink, echo, clear })` resolves a command line
 * (programs.mjs, createCommandLine) that writes through the three it is given. `seen` records each terminal made.
 */
export function prismTerminal(makeLine, seen = []) {
  let next = 0;
  class Process extends SimpleTerminalProcess {
    constructor(id, out) {
      super(id, id, '/workspace', out.event);
      this.out = out;
      // Output handed to the panel and not yet acknowledged as drawn: [characters left, drained].
      this.waiting = [];
      this.decoder = new TextDecoder('utf-8');
      // The panel names a terminal after its process. Left alone it shows the name of the machine's usual shell,
      // which this is not: nothing here is a shell. So the process says what it is.
      this.properties = new Emitter();
      this.onDidChangeProperty = this.properties.event;
    }
    async start() {
      const fire = (text) => { if (text) this.out.fire(text); };
      this.line = await makeLine({
        // A piece may end inside a character, so the decoder keeps what is unfinished for the next piece.
        // The panel acknowledges characters, in batches of 5000, so the piece is counted in characters and drained
        // as each batch comes: a piece is never left waiting on an acknowledgement that will not come.
        sink: (bytes, drained) => { const text = this.decoder.decode(bytes, { stream: true }); if (text) { this.waiting.push([text.length, drained]); fire(text); } return text.length; },
        echo: fire,
        // Clear the screen and what is above it, and put the cursor home.
        clear: () => fire('\x1b[2J\x1b[3J\x1b[H'),
      });
      seen.push(this);
      setTimeout(() => this.properties.fire({ type: 'title', value: 'prism model' }), 0);
      fire(this.line.greeting + '\r\n');
      this.line.editor.start();
      return undefined;
    }
    input(data) { this.line?.editor.feed(data); }
    /** The panel has drawn this many more characters. */
    acknowledgeDataEvent(count) {
      let left = count;
      while (left > 0 && this.waiting.length) {
        const head = this.waiting[0];
        const taken = Math.min(left, head[0]);
        head[0] -= taken;
        left -= taken;
        head[1](taken);
        if (head[0] === 0) this.waiting.shift();
      }
    }
    sendSignal() { this.line?.writer.stop(); }
    shutdown() { this.line?.writer.stop(); }
    resize() {}
    clearBuffer() {}
  }
  class Backend extends SimpleTerminalBackend {
    getDefaultSystemShell = async () => 'prism';
    createProcess = async () => new Process(++next, new Emitter());
  }
  return getTerminalOverride(new Backend());
}
