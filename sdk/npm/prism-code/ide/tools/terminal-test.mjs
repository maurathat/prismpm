// The terminal's command line asks the proved tables and obeys them. Tested here, in Node, with no browser:
// the tables are read from the models as the published page gets them, and the programs are stand-ins that count
// how often they are started.
// Usage: node tools/terminal-test.mjs
import assert from 'node:assert/strict';
import { kappa } from '../../src/blake3.mjs';
import { reuseAdmits } from '../../src/journey/kappa-rules.mjs';
import { judgeTable } from '../../src/journey/rule-table.mjs';
import { cleanTitle, createEffects, schemeOf } from '../edit/terminal/effects.mjs';
import { createKeptIn, indexOf, materialize, openStore } from '../edit/terminal/kappa-space.mjs';
import { createLineEditor } from '../edit/terminal/line-editor.mjs';
import { createKept, createWriter, makeJudge, visible } from '../edit/terminal/session.mjs';
import { build, createSession, diffLines, lex, resolveTarget, USAGE, WORDS } from '../edit/terminal/shell.mjs';
import { terminalTables, vendorFiles } from './terminal-site.mjs';

const { tables, luts } = await terminalTables();
// The tests ask the tables as the pages do: through their lookup tables where they have one.
const made = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, materialize(table, judgeTable, kappa)]).filter(([, lut]) => lut));
const judge = makeJudge(tables, judgeTable, made);
const dec = new TextDecoder();
let passed = 0;
let failed = 0;
const test = async (name, body) => {
  try { await body(); passed++; console.log('ok  ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + String(error?.message ?? error).slice(0, 700)); }
};

/** Completion over a fixed list of command names, as shell.mjs gives it for the first word of a line. */
const completing = (words) => (before) => ({ from: 0, options: before.includes(' ') ? [] : words.filter((w) => w.startsWith(before)).map((w) => w + ' ') });

/** A session over a small model, with stand-in programs. `bytes` is what the executables turn out to be. */
function setup({ bytes = 'pinned', kept = createKept(), output = null, readOnly = false, delay = 0 } = {}) {
  const model = new Map([['/lexlean.toml', 'spec = "x"\n'], ['/src/App.lex.tex', 'model\n'], ['/src/evil.txt', 'before\x1b]52;c;aGVsbG8=\x07after\n']]);
  const shown = [];
  const started = { check: 0, snapshot: 0, prove: 0, audit: 0 };
  const writer = createWriter({ judge, sink: (part, done) => { shown.push(dec.decode(part)); done(); } });
  const programs = Object.fromEntries(Object.keys(started).map((name) => [name, async (project) => { started[name]++; if (delay) await new Promise((r) => setTimeout(r, delay)); return { text: output ?? `${name} of ${Object.keys(project).length} files` }; }]));
  const session = createSession({ judge, writer, files: () => model, bytesOf: async () => bytes, labelOf: (c) => (c in started ? 'blake3:' + '1'.repeat(64) : null), programs, kappa, reuseAdmits, kept, clear: () => shown.push('<clear>'),
    change: readOnly ? null : { write: async (path, text) => { model.set(path, text); }, remove: async (path) => { model.delete(path); } } });
  return { session, model, started, kept, writer, text: () => shown.join(''), take: () => shown.splice(0).join('') };
}

await test('xterm.js as installed is the pinned xterm.js', async () => {
  assert.deepEqual([...vendorFiles().keys()].sort(), ['addon-fit.mjs', 'addon-search.mjs', 'addon-unicode11.mjs', 'addon-web-links.mjs', 'addon-webgl.mjs', 'xterm.css', 'xterm.mjs']);
});

await test('a word that is not listed is refused, and nothing runs', async () => {
  const t = setup();
  for (const line of ['bash', 'curl https://example.org', 'sh -c check', 'sudo ls', 'python3 -c 1', 'ls | bash', 'check | sh']) assert.equal(await t.session.run(line), 'refuse', line);
  assert.deepEqual(t.started, { check: 0, snapshot: 0, prove: 0, audit: 0 });
  assert.match(t.text(), /bash: not a command here/);
  // A pipeline with a word that is not a command runs none of its commands.
  assert.ok(!t.text().includes('lexlean.toml'));
});

await test('a path outside the open model is refused, whatever the command', async () => {
  const t = setup();
  for (const line of ['cat ../secret', 'cat /etc/passwd', 'cat C:\\Windows\\win.ini', 'kappa https://example.org/x', 'check ../other', 'ls ..']) assert.equal(await t.session.run(line), 'refuse', line);
  assert.equal(t.started.check, 0);
  assert.equal(resolveTarget('src/../src/App.lex.tex', t.model).file, '/src/App.lex.tex');
});

await test('a program whose bytes are not the pinned ones, or are absent, never runs', async () => {
  for (const bytes of ['mismatch', 'absent']) {
    const t = setup({ bytes });
    for (const line of ['check', 'snapshot', 'prove', 'audit', 'lexlean check']) assert.equal(await t.session.run(line), 'refuse', `${line} with ${bytes}`);
    assert.deepEqual(t.started, { check: 0, snapshot: 0, prove: 0, audit: 0 });
    // The builtins start no executable, so they still answer.
    assert.equal(await t.session.run('ls'), 'builtin');
  }
});

await test('the same program on the same model is answered from what was kept, and only then', async () => {
  const t = setup();
  assert.equal(await t.session.run('check'), 'run');
  assert.equal(await t.session.run('check'), 'reuse');
  assert.equal(t.started.check, 1);
  assert.match(t.text(), /kept output blake3:[0-9a-f]{12}…, shown again; nothing was run/);
  // Another program has its own key.
  assert.equal(await t.session.run('snapshot'), 'run');
  // A changed model is another input: the kept output is not for it.
  t.model.set('/src/App.lex.tex', 'model, edited\n');
  assert.equal(await t.session.run('check'), 'run');
  assert.equal(t.started.check, 2);
});

await test('a kept output whose bytes were changed is not shown again', async () => {
  const t = setup();
  await t.session.run('check');
  // The key is the label of the program's label and the label of everything it read.
  const enc = new TextEncoder();
  const input = kappa(enc.encode(JSON.stringify([...t.model.keys()].sort().map((p) => [p, t.model.get(p)]))));
  const found = t.kept.get(kappa(enc.encode(JSON.stringify(['prism/terminal-output/1', 'check', 'blake3:' + '1'.repeat(64), input]))));
  assert.ok(found, 'the output was kept under the key of its program and input');
  // Change one byte of what is kept, as a fault in the store would.
  found.bytes[0] ^= 1;
  assert.equal(await t.session.run('check'), 'run');
  assert.equal(t.started.check, 2);
});

await test('a printed file cannot send a sequence to the terminal', async () => {
  const t = setup();
  assert.equal(await t.session.run('cat src/evil.txt'), 'builtin');
  assert.ok(!t.text().includes('\x1b'), 'no escape byte reaches the terminal');
  assert.match(t.text(), /before\^\[\]52;c;aGVsbG8=\^Gafter/);
  assert.equal(visible('a\x9bb\x7f'), 'a\\x9bb^?');
});

await test('a command uses only what the reach table allows it', async () => {
  const t = setup();
  for (const line of ['help', 'ls', 'cat lexlean.toml', 'kappa lexlean.toml', 'check', 'check', 'prove', 'audit']) await t.session.run(line);
  const uses = t.session.log.filter((e) => e.resource);
  assert.ok(uses.length > 10);
  for (const use of uses) assert.equal(use.answer, 'allow', `${use.command} ${use.resource}`);
  const by = (command) => new Set(uses.filter((u) => u.command === command).map((u) => u.resource));
  assert.deepEqual([...by('help')], ['screen']);
  assert.deepEqual([...by('cat')].sort(), ['readmodel', 'screen']);
  assert.deepEqual([...by('check')].sort(), ['readmodel', 'readstore', 'screen', 'writestore']);
  // Nothing in the session can even name these; the table would deny them all the same.
  for (const resource of ['network', 'clipboard', 'process']) for (const command of t.session.commands()) assert.equal(judge('reach', { command, resource }), 'deny');
  // Six commands change a file of the model, and no other.
  assert.deepEqual(t.session.commands().filter((command) => judge('reach', { command, resource: 'writemodel' }) === 'allow').sort(), ['append', 'cp', 'mv', 'rm', 'touch', 'write']);
});

await test('output is held at the high mark and released at the low one', async () => {
  const waiting = [];
  let delivered = 0;
  const writer = createWriter({ judge, sink: (part, done) => { waiting.push(() => { delivered += part.length; done(); }); } });
  // The terminal "draws" one piece every turn of the loop, slower than the command writes.
  const drain = setInterval(() => waiting.shift()?.(), 0);
  const text = 'x'.repeat(2 * 1024 * 1024);
  await writer.write(text);
  while (waiting.length) await new Promise((r) => setTimeout(r, 1));
  clearInterval(drain);
  assert.equal(delivered, text.length);
  assert.ok(writer.state.holds > 0, 'the writer was held');
  assert.ok(writer.state.peak <= 99999 + 16384, `at most the high mark and one piece were pending, not ${writer.state.peak}`);
});

await test('a terminal that acknowledges in batches does not strand the writer', async () => {
  // The workbench's terminal acknowledges characters, 5000 at a time, and never the remainder.
  const waiting = [];
  let unsent = 0;
  let fired = 0;
  const ack = (count) => { let left = count; while (left > 0 && waiting.length) { const head = waiting[0]; const took = Math.min(left, head[0]); head[0] -= took; left -= took; head[1](took); if (head[0] === 0) waiting.shift(); } };
  const writer = createWriter({ judge, sink: (part, drained) => {
    waiting.push([part.length, drained]);
    fired += part.length;
    setTimeout(() => { unsent += part.length; while (unsent >= 5000) { unsent -= 5000; ack(5000); } }, 0);
    return part.length;
  } });
  const text = 'y'.repeat(1024 * 1024 + 4688);
  const finished = await Promise.race([writer.write(text), new Promise((r) => setTimeout(() => r('stuck'), 4000))]);
  assert.equal(finished, true, 'the write finished');
  assert.equal(fired, text.length);
  assert.ok(writer.state.peak <= 99999 + 16384);
});

await test('an interrupted command writes nothing more', async () => {
  const waiting = [];
  let delivered = 0;
  const writer = createWriter({ judge, sink: (part, done) => { waiting.push(() => { delivered += part.length; done(); }); } });
  const writing = writer.write('x'.repeat(1024 * 1024));
  await new Promise((r) => setTimeout(r, 5));
  writer.stop();
  assert.equal(await writing, false);
  for (const go of waiting) go();
  assert.ok(delivered < 200000);
});

await test('what acts outside the grid is ignored, or asked about after a click', async () => {
  const asked = [];
  const opened = [];
  let yes = true;
  const effects = createEffects({ judge, ui: { setTitle() {}, confirm: async (text) => { asked.push(text); return yes; }, open: (uri) => opened.push(uri) } });
  for (const effect of ['other', 'clipboardwrite', 'clipboardread', 'notify', 'transfer', 'window']) for (const gesture of [false, true]) assert.equal(effects.decide(effect, { gesture }), 'ignore', effect);
  // Output, or a script, cannot open a link: only the browser's word that the user clicked counts.
  await effects.link({ isTrusted: false }, 'https://example.org/');
  await effects.link(undefined, 'https://example.org/');
  for (const uri of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.org/', 'data:text/html,x', 'example.org']) await effects.link({ isTrusted: true }, uri);
  assert.deepEqual([asked.length, opened.length], [0, 0]);
  await effects.link({ isTrusted: true }, 'https://example.org/a');
  assert.equal(asked.length, 1);
  assert.match(asked[0], /https:\/\/example\.org\/a/);
  assert.deepEqual(opened, ['https://example.org/a']);
  yes = false;
  await effects.link({ isTrusted: true }, 'https://example.org/b');
  assert.equal(opened.length, 1, 'a refused question opens nothing');
  // Paste: only the user's own, and more than one line only after the question.
  assert.equal(await effects.paste({ isTrusted: false }, 'check'), null);
  assert.deepEqual(await effects.paste({ isTrusted: true }, 'check'), { text: 'check' });
  assert.equal(await effects.paste({ isTrusted: true }, 'check\nprove\n'), null);
  yes = true;
  assert.deepEqual(await effects.paste({ isTrusted: true }, 'check\nprove\n'), { lines: ['check', 'prove'] });
  assert.equal(schemeOf('HTTPS://x'), 'https');
  assert.equal(cleanTitle('a\x1b[31m' + 'b'.repeat(200)).length, 80);
});

await test('keys become lines', async () => {
  const echoed = [];
  const lines = [];
  const editor = createLineEditor({ echo: (t) => echoed.push(t), submit: async (line) => { lines.push(line); }, interrupt() {}, clear() {}, complete: completing(['check', 'cat', 'snapshot']) });
  editor.start();
  for (const key of ['l', 's', 'x', '\x7f', '\r']) await editor.feed(key);
  for (const key of ['s', 'n', '\t', '\r']) await editor.feed(key);
  await editor.feed('\x1b[A');
  await editor.feed('\x1b[A');
  await editor.feed('\r');
  for (const key of ['a', '\x03', '\x1b[D', '\x1b]52;c;eA==\x07', '\r']) await editor.feed(key);
  assert.deepEqual(lines, ['ls', 'snapshot ', 'ls', '']);
  assert.ok(!echoed.join('').includes('\x1b]'), 'a sequence typed or pasted in is not echoed as one');
});

await test('keys typed while a command runs are entered after it', async () => {
  const lines = [];
  let release;
  const editor = createLineEditor({ echo() {}, submit: (line) => { lines.push(line); return new Promise((r) => { release = r; }); }, interrupt() {}, clear() {}, complete: completing([]) });
  for (const key of ['a', '\r']) editor.feed(key);
  for (const key of ['b', 'c', '\r', 'd']) editor.feed(key);
  assert.deepEqual(lines, ['a']);
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(lines, ['a', 'bc']);
  // Ctrl+C drops what was typed ahead.
  for (const key of ['e', '\r', '\x03']) editor.feed(key);
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(lines, ['a', 'bc']);
});

/** A directory handle as the origin's private file system gives one, held in memory. `files` is what is on "disk". */
function fakeDirectory(files = new Map(), dirs = new Map()) {
  const gone = () => { throw new DOMException('not found', 'NotFoundError'); };
  return {
    files, dirs,
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name) && !create) gone();
      return {
        async getFile() { if (!files.has(name)) gone(); const bytes = files.get(name); return { arrayBuffer: async () => bytes.slice().buffer }; },
        async createWritable() { let next = null; return { async write(bytes) { next = new Uint8Array(bytes); }, async close() { files.set(name, next); } }; },
      };
    },
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!dirs.has(name)) { if (!create) gone(); dirs.set(name, fakeDirectory()); }
      return dirs.get(name);
    },
  };
}

await test('each finite table as a lookup table answers every request as its rules do', async () => {
  assert.deepEqual(Object.keys(made).sort(), ['audit', 'commands', 'effects', 'reach']);
  let requests = 0;
  for (const [name, lut] of Object.entries(made)) {
    assert.equal(lut.kappa, luts[name], `${name} has the label the site is built with`);
    const table = tables[name];
    const request = new Array(lut.sizes.length).fill(0);
    for (;;) {
      requests++;
      assert.equal(lut.bytes[indexOf(lut.sizes, request)], judgeTable(table, request).answer, `${name} ${request}`);
      let f = request.length - 1;
      while (f >= 0 && ++request[f] === lut.sizes[f]) request[f--] = 0;
      if (f < 0) break;
    }
  }
  assert.equal(requests, 792 + 264 + 108 + 108);
  // A table with a number in it has no finite list of requests, and is judged rule by rule.
  assert.equal(materialize(tables.flow, judgeTable, kappa), null);
  assert.equal(judge('flow', { pending: 100000, paused: 'no' }), 'hold');
});

await test('the store keeps bytes by label, in the layout of Hologram\'s browser store, and returns only what re-derives', async () => {
  const disk = fakeDirectory();
  const store = await openStore({ kappa, root: disk });
  const bytes = new TextEncoder().encode('kept by content');
  const label = await store.put(bytes);
  assert.equal(label, kappa(bytes));
  // One file to a blob, named by its label with the colon as an underscore.
  assert.deepEqual([...disk.files.keys()], [label.replace(':', '_')]);
  assert.deepEqual(await store.get(label), bytes);
  // The same bytes again write nothing new.
  await store.put(bytes);
  assert.equal(disk.files.size, 1);
  // Another visit: a new store over the same disk.
  const later = await openStore({ kappa, root: disk });
  assert.deepEqual(await later.get(label), bytes);
  // One changed byte on disk, and the label has nothing under it.
  disk.files.get(label.replace(':', '_'))[0] ^= 1;
  assert.equal(await later.get(label), null);
  assert.equal(await later.get('blake3:' + '0'.repeat(64)), null);
  assert.equal(await later.get('../etc/passwd'), null);
  // Where there is no file system to keep things in, it keeps them for the visit.
  const none = await openStore({ kappa, root: { getFileHandle: async () => { throw new Error('refused'); }, getDirectoryHandle: async () => { throw new Error('refused'); } } });
  const held = await none.put(bytes);
  assert.equal(none.durable, false);
  assert.deepEqual(await none.get(held), bytes);
});

await test('a kept output is shown again on a later visit, and not after its bytes change', async () => {
  const disk = fakeDirectory();
  const first = setup({ kept: createKeptIn(await openStore({ kappa, root: disk })) });
  assert.equal(await first.session.run('check'), 'run');
  // A later visit: another session, another store, the same disk.
  const second = setup({ kept: createKeptIn(await openStore({ kappa, root: disk })) });
  assert.equal(await second.session.run('check'), 'reuse');
  assert.equal(second.started.check, 0);
  assert.match(second.text(), /check of 3 files\r\n\(kept output/);
  // Every blob on disk changed by one byte: nothing is admitted, and the program runs.
  for (const bytes of disk.files.values()) bytes[bytes.length - 1] ^= 1;
  const third = setup({ kept: createKeptIn(await openStore({ kappa, root: disk })) });
  assert.equal(await third.session.run('check'), 'run');
  assert.equal(third.started.check, 1);
});

await test('a program\'s output cannot send a sequence to the terminal either', async () => {
  const t = setup({ output: 'diagnostic \x1b]52;c;aGVsbG8=\x07 quoted \x1b[8;1;1t\x9b31m' });
  assert.equal(await t.session.run('check'), 'run');
  assert.equal(await t.session.run('check'), 'reuse');
  assert.ok(!/[\x1b\x9b\x07]/.test(t.text()), 'no control byte reaches the terminal, run or kept');
});

await test('the line is edited where the cursor is', async () => {
  const echoed = [];
  const lines = [];
  const editor = createLineEditor({ echo: (t) => echoed.push(t), submit: async (line) => { lines.push(line); }, interrupt() {}, clear() {}, complete: completing(['check']) });
  const type = async (...keys) => { for (const key of keys) await editor.feed(key); };
  const LEFT = '\x1b[D', RIGHT = '\x1b[C', DELETE = '\x1b[3~', HOME = '\x1b[H', END = '\x1b[F';
  await type('a', 'c', LEFT, 'b');
  assert.equal(editor.line, 'abc');
  await type(HOME, '>', END, '!', LEFT, LEFT, DELETE, '\x7f');
  assert.equal(editor.line, '>a!');
  await type('\x01', RIGHT, '\x0b');
  assert.equal(editor.line, '>');
  await type('\x15', 'c', 'a', 't', ' ', 's', 'r', 'c', '/', 'x', '\x17');
  assert.equal(editor.line, 'cat ');
  await type('\x15', 'c', 'h', '\t', '\r');
  assert.deepEqual(lines, ['check ']);
  // The cursor is put back after a redraw: the last redraw of 'abc' with the cursor before 'c' moved it one left.
  assert.ok(echoed.includes('\r\x1b[Kmodel> abc\x1b[1D'));
});

await test('the command line answers exactly the words the proved table lists', async () => {
  assert.deepEqual([...WORDS].sort(), tables.commands.fields[0].values.filter((word) => word !== 'other').sort());
  assert.deepEqual([...WORDS].sort(), tables.reach.fields[0].values.filter((word) => word !== 'other').sort());
  assert.equal(new Set(WORDS).size, USAGE.length);
});

await test('a line is commands joined by pipes, ; && and ||, with quotes, variables and patterns', async () => {
  const t = setup();
  const out = async (line) => { t.take(); await t.session.run(line); return t.take(); };
  assert.equal(await out('echo one two'), 'one two\r\n');
  assert.equal(await out("echo 'a | b' \"c ; d\" e\\ f"), 'a | b c ; d e f\r\n');
  assert.equal(await out('ls | grep tex | wc -l'), '       1\r\n');
  assert.equal(await out('cat lexlean.toml src/App.lex.tex | sort -r | head -n 1'), 'spec = "x"\r\n');
  assert.equal(await out('echo a; echo b'), 'a\r\nb\r\n');
  assert.equal(await out('cat nothing && echo yes'), 'nothing: no such file in the open model.\r\n');
  assert.equal(await out('cat nothing || echo no'), 'nothing: no such file in the open model.\r\nno\r\n');
  assert.equal(await out('grep absent lexlean.toml || echo none'), 'none\r\n');
  assert.equal(await out('NAME=world; echo "hello $NAME" ${NAME}s \'$NAME\''), 'hello world worlds $NAME\r\n');
  assert.equal(await out('grep zzz lexlean.toml; echo $?'), '1\r\n');
  assert.equal(await out('ls src/*.tex'), 'src/App.lex.tex\r\n');
  assert.equal(await out('ls *.none'), '*.none: no such file in the open model.\r\n');
  assert.equal(await out('echo "*"'), '*\r\n');
  assert.equal(await out('wc -l < lexlean.toml'), '       1\r\n');
  assert.equal(await out('echo b a b | cat # a comment'), 'b a b\r\n');
  assert.equal(await out('check | grep -c files'), '1\r\n');
  assert.equal(t.started.check, 1);
});

await test('what the command line does not do, it says, and runs nothing', async () => {
  const t = setup();
  for (const line of ['echo $(ls)', 'echo `ls`', 'check &', 'echo "open', "echo 'open", '| ls', 'ls |', 'ls > ', 'ls ; ; ls', '&& ls', 'cat < src/*']) {
    t.take();
    assert.equal(await t.session.run(line), 'refuse', line);
    assert.ok(t.take().length > 0, line);
  }
  assert.deepEqual(t.started, { check: 0, snapshot: 0, prove: 0, audit: 0 });
  assert.equal(t.session.log.filter((e) => e.answer === 'builtin' || e.answer === 'run').length, 0);
});

await test('a redirection is judged as the command it stands for', async () => {
  const t = setup();
  assert.equal(await t.session.run('echo hello > notes.txt'), 'builtin');
  assert.equal(t.model.get('/notes.txt'), 'hello\n');
  await t.session.run('echo again >> notes.txt');
  assert.equal(t.model.get('/notes.txt'), 'hello\nagain\n');
  const judged = t.session.log.filter((e) => e.line).map((e) => e.command + ' ' + e.target);
  assert.deepEqual(judged, ['echo none', 'write new', 'echo none', 'append model']);
  // Outside the model: the write is refused by the table, and nothing is written anywhere.
  for (const line of ['echo x > ../out.txt', 'echo x > /../../etc/passwd', 'echo x > C:\\out.txt', 'echo x >> https://example.org/x', 'ls | write ../x', 'cp lexlean.toml ../x', 'mv lexlean.toml file:///x', 'touch ../x', 'rm ../x']) {
    assert.equal(await t.session.run(line), 'refuse', line);
  }
  assert.deepEqual([...t.model.keys()].sort(), ['/lexlean.toml', '/notes.txt', '/src/App.lex.tex', '/src/evil.txt']);
  // A file that is not there can be made by the five that make one, and by no other command.
  for (const line of ['cat new.txt', 'kappa new.txt', 'grep x new.txt', 'rm new.txt', 'check new.txt', 'head new.txt', 'cd new']) assert.equal(await t.session.run(line), 'refuse', line);
  assert.ok(!t.model.has('/new.txt'));
});

await test('the six commands that change the model change it, through the page and only through it', async () => {
  const t = setup();
  await t.session.run('touch a.txt src/b.txt');
  assert.equal(t.model.get('/a.txt'), '');
  await t.session.run('cat lexlean.toml | write a.txt');
  assert.equal(t.model.get('/a.txt'), 'spec = "x"\n');
  await t.session.run('cp a.txt src');
  assert.equal(t.model.get('/src/a.txt'), 'spec = "x"\n');
  await t.session.run('mv src/a.txt src/c.txt');
  assert.ok(!t.model.has('/src/a.txt') && t.model.get('/src/c.txt') === 'spec = "x"\n');
  await t.session.run('rm a.txt src/b.txt src/c.txt');
  assert.deepEqual([...t.model.keys()].sort(), ['/lexlean.toml', '/src/App.lex.tex', '/src/evil.txt']);
  // A folder goes only with -r, and the whole model never.
  t.take();
  await t.session.run('rm src');
  await t.session.run('rm -r /');
  await t.session.run('rm -rf /');
  assert.equal(t.model.size, 3);
  assert.match(t.take(), /rm -r removes a folder[\s\S]*whole model[\s\S]*unknown option -f/);
  await t.session.run('touch d/e.txt; rm -r d');
  assert.ok(!t.model.has('/d/e.txt'));
  for (const use of t.session.log.filter((e) => e.resource === 'writemodel')) assert.ok(['write', 'append', 'touch', 'rm', 'mv', 'cp'].includes(use.command) && use.answer === 'allow');
  // A page that holds the model read-only is not written to.
  const fixed = setup({ readOnly: true });
  await fixed.session.run('echo x > a.txt');
  assert.ok(!fixed.model.has('/a.txt'));
  assert.match(fixed.text(), /read-only/);
});

await test('paths start from the folder cd names, and never leave the model', async () => {
  const t = setup();
  const out = async (line) => { t.take(); await t.session.run(line); return t.take(); };
  assert.equal(t.session.prompt(), 'model> ');
  assert.equal(await out('cd src; pwd; ls'), '/src\r\nApp.lex.tex\r\nevil.txt\r\n');
  assert.equal(t.session.prompt(), 'model/src> ');
  assert.equal(await out('cat ../lexlean.toml'), 'spec = "x"\r\n');
  assert.equal(await t.session.run('cat ../../lexlean.toml'), 'refuse');
  assert.equal(await out('ls /lexlean.toml'), '/lexlean.toml\r\n');
  assert.equal(await out('cd lexlean.toml'), 'cd: lexlean.toml: no such file in the open model.\r\n'.replace('cd: ', ''));
  assert.equal(await out('cd; pwd'), '/\r\n');
  assert.equal(resolveTarget('x', t.model, '/src/').file, '/src/x');
  assert.equal(resolveTarget('a\u0007b', t.model).target, 'outside');
});

await test('the text commands answer as their names say', async () => {
  const t = setup();
  t.model.set('/n.txt', 'b\na\nb\nb\n10\n9\n');
  const out = async (line) => { t.take(); await t.session.run(line); return t.take().replace(/\r\n/g, '\n'); };
  assert.equal(await out('sort n.txt'), '10\n9\na\nb\nb\nb\n');
  assert.equal(await out('sort -n -r n.txt | head -2'), '10\n9\n');
  assert.equal(await out('sort -u n.txt | wc -l'), '       4\n');
  assert.equal(await out('uniq -c n.txt'), '      1 b\n      1 a\n      2 b\n      1 10\n      1 9\n');
  assert.equal(await out('tail -n 2 n.txt'), '10\n9\n');
  assert.equal(await out('grep -n b n.txt'), '1:b\n3:b\n4:b\n');
  assert.equal(await out('grep -v -c b n.txt'), '3\n');
  assert.equal(await out('grep -i SPEC lexlean.toml n.txt'), 'lexlean.toml:spec = "x"\n');
  assert.equal(await out('grep "[" n.txt; echo $?'), '1\n');
  assert.equal(await out('wc n.txt'), '       6       6      13 n.txt\n');
  assert.equal(await out('echo -n x | wc -c'), '       1\n');
  assert.equal(await out('echo x | kappa'), kappa(new TextEncoder().encode('x\n')) + '  -\n');
  assert.equal(await out('ls -l lexlean.toml'), '      11  lexlean.toml\n');
  await t.session.run('grep -v a n.txt > m.txt');
  assert.equal(await out('diff n.txt m.txt; echo $?'), '-2 a\n1\n');
  assert.equal(await out('diff n.txt n.txt; echo $?'), '0\n');
  assert.deepEqual(diffLines('a\nb\nc\n', 'a\nx\nc\nd\n'), ['-2 b', '+2 x', '+4 d']);
  assert.equal(await out('head -x n.txt'), 'head: unknown option -x.\n');
  assert.equal(await out('set A 1; set B two words; env; unset A; env'), 'A=1\nB=two words\nB=two words\n');
  assert.match(await out('history'), /^ {3}1 {2}sort n\.txt\n/);
  assert.match(await out('help'), /Files of the model[\s\S]*grep \[-ivnc\]/);
  // A file's control bytes are written out by every command that prints them.
  for (const line of ['grep before src/evil.txt', 'head src/evil.txt', 'sort src/evil.txt', 'cat src/evil.txt | tail', 'echo "\u001b]52;c;eA==\u0007"']) assert.ok(!/[\u001b\u0007]/.test(await out(line)), line);
});

await test('a transcript is kept only when asked, by label, and shown again only when it re-derives', async () => {
  const kept = createKept();
  const t = setup({ kept });
  await t.session.run('echo first');
  assert.equal(kept.size(), 0);
  t.take();
  await t.session.run('save demo');
  assert.match(t.take(), /^Kept as demo: \d+ bytes, blake3:[0-9a-f]{64}\./);
  await t.session.run('save; sessions');
  assert.match(t.take(), /demo\r\nlast\r\n$/);
  // Another visit: a new session over the same store.
  const later = setup({ kept });
  await later.session.run('restore demo');
  assert.match(later.text(), /model> echo first\r\nfirst\r\nmodel> save demo\r\n/);
  assert.equal(await later.session.run('restore none'), 'builtin');
  assert.match(later.text(), /no transcript is kept as none/);
  for (const line of ['save ../x', 'save "a b"', 'restore ../x']) { later.take(); await later.session.run(line); assert.match(later.take(), /a name is 1 to 40|no transcript/, line); }
  // Changed bytes are not shown.
  const store = new Map();
  const loose = { get: (key) => store.get(key) ?? null, set: (key, entry) => { store.set(key, entry); }, size: () => store.size };
  const first = setup({ kept: loose });
  await first.session.run('echo secret; save demo');
  for (const entry of store.values()) entry.bytes = new TextEncoder().encode('forged');
  first.take();
  await first.session.run('restore demo; sessions');
  assert.ok(!first.take().includes('forged'));
  const uses = first.session.log.filter((e) => e.resource === 'readstore' || e.resource === 'writestore');
  for (const use of uses) assert.ok(['save', 'restore', 'sessions'].includes(use.command) && use.answer === 'allow');
});

await test('Ctrl+C stops the rest of the line', async () => {
  const t = setup({ delay: 30 });
  const running = t.session.run('check; echo after; echo more');
  await new Promise((r) => setTimeout(r, 5));
  t.session.interrupt();
  await running;
  assert.equal(t.text(), '');
  t.take();
  await t.session.run('echo next');
  assert.equal(t.take(), 'next\r\n');
});

await test('Tab completes commands and files, and lists what fits', async () => {
  const t = setup();
  assert.deepEqual(t.session.complete('ch'), { from: 0, options: ['check '] });
  assert.deepEqual(t.session.complete('s').options, ['save ', 'sessions ', 'set ', 'snapshot ', 'sort ']);
  assert.deepEqual(t.session.complete('cat '), { from: 4, options: ['lexlean.toml ', 'src/'] });
  assert.deepEqual(t.session.complete('ls | grep x src/A'), { from: 12, options: ['src/App.lex.tex '] });
  assert.deepEqual(t.session.complete('cat l; c').options, ['cat ', 'cd ', 'check ', 'clear ', 'cp ']);
  assert.deepEqual(t.session.complete('cat ../').options, []);
  assert.deepEqual(t.session.complete('echo x > src/e'), { from: 9, options: ['src/evil.txt '] });
  const echoed = [];
  const lines = [];
  const editor = createLineEditor({ echo: (text) => echoed.push(text), submit: async (line) => { lines.push(line); }, interrupt() {}, clear() {}, complete: t.session.complete, prompt: t.session.prompt });
  const type = async (...keys) => { for (const key of keys) await editor.feed(key); };
  await type(...'cat sr', '\t');
  assert.equal(editor.line, 'cat src/');
  await type('\t');
  assert.equal(editor.line, 'cat src/');
  echoed.length = 0;
  await type('\t');
  assert.match(echoed.join(''), /\r\nsrc\/App\.lex\.tex {2}src\/evil\.txt\r\n/);
  await type('A', '\t', '\r');
  assert.deepEqual(lines, ['cat src/App.lex.tex ']);
});

await test('the history is searched with Ctrl+R, and the line is moved through by words', async () => {
  const echoed = [];
  const lines = [];
  const editor = createLineEditor({ echo: (text) => echoed.push(text), submit: async (line) => { lines.push(line); }, interrupt() {}, clear() {}, complete: completing([]) });
  const type = async (...keys) => { for (const key of keys) await editor.feed(key); };
  for (const line of ['check', 'cat src/App.lex.tex', 'kappa lexlean.toml', 'cat lexlean.toml']) await type(...line, '\r');
  await type('\x12', ...'cat');
  assert.ok(editor.searching);
  assert.match(echoed[echoed.length - 1], /\(search\)'cat': cat lexlean\.toml$/);
  await type('\x12');
  assert.match(echoed[echoed.length - 1], /cat src\/App\.lex\.tex$/);
  await type('\r');
  assert.equal(lines[lines.length - 1], 'cat src/App.lex.tex');
  // Ctrl+C leaves the search with the line as it was.
  await type(...'pwd', '\x12', 'k', '\x03');
  assert.equal(editor.line, 'pwd');
  await type('\x15', ...'one two three', '\x1bb', '\x1bb', '\x1b\x7f');
  assert.equal(editor.line, 'two three');
  await type('\x1bf', '\x1bd', '\x19', '\x01', '\x04');
  assert.equal(editor.line, 'wo three');
  await type('\x1b[1;5C', '\x1b[1;5C', 'X', '\x1b[1;5D', 'Y');
  assert.equal(editor.line, 'wo YthreeX');
});

console.log(`${passed} tests passed` + (failed ? `, ${failed} FAILED` : ''));
if (failed) process.exit(1);
