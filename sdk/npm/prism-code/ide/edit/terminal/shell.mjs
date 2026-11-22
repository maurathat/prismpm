// The terminal's command language: what a line means, and the commands that answer it. No DOM and no xterm.js
// here, so Node can test it.
//
// A line is commands joined by `;`, `&&` and `||`. A command may pipe its output to the next (`|`), take a file as
// its input (`< file`) and write its output to a file of the model (`> file`, `>> file`). Words are quoted with
// '…' and "…", a variable is written $NAME, and * and ? in a word match the model's files.
//
// It is still not a shell: it starts no native program, there is no operating system behind it, and the list of
// commands is fixed. Every command of a line, every redirection included, is put to the proved command table
// (model/ide-terminal-commands) before it runs; every use of a resource by a running command is put to the reach
// table (model/ide-terminal-reach). `> file` is the command `write file`, `>> file` is `append file` and `< file`
// is `cat file`, so a redirection is judged as the command it stands for.
// This file asks the tables and obeys them. That it does is tested (tools/terminal-test.mjs), not proved.

import { visible } from './session.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The commands, as `help` lists them: [usage, what it does, group]. The words are the command table's. */
export const USAGE = [
  ['help', 'list these commands', 'This terminal'],
  ['clear', 'clear the screen', 'This terminal'],
  ['history', 'list the lines entered', 'This terminal'],
  ['set NAME value', 'give a variable a value (also NAME=value)', 'This terminal'],
  ['unset NAME', 'forget a variable', 'This terminal'],
  ['env', 'list the variables', 'This terminal'],
  ['save [name]', "keep this session's transcript in this browser", 'This terminal'],
  ['restore [name]', 'print a kept transcript', 'This terminal'],
  ['sessions', 'list the kept transcripts', 'This terminal'],
  ['check', 'lexlean check, on the model as it is in the editor', 'The model'],
  ['snapshot', 'lexlean snapshot: what the model means, as JSON', 'The model'],
  ['prove', "have Lean's kernel judge each guarantee", 'The model'],
  ['audit', 'say what backs each guarantee: proved, tested, refused or unknown', 'The model'],
  ['ls [-l] [folder]', "list the model's files", 'Files of the model'],
  ['cd [folder]', 'change the folder paths start from', 'Files of the model'],
  ['pwd', 'print that folder', 'Files of the model'],
  ['cat [file…]', 'print files, control bytes written out', 'Files of the model'],
  ['kappa [file…]', 'print BLAKE3 labels', 'Files of the model'],
  ['touch file…', 'make an empty file', 'Files of the model'],
  ['write file', 'write what is piped in to a file (also > file)', 'Files of the model'],
  ['append file', 'add what is piped in to a file (also >> file)', 'Files of the model'],
  ['cp from to', 'copy a file', 'Files of the model'],
  ['mv from to', 'rename a file', 'Files of the model'],
  ['rm [-r] file…', 'remove files', 'Files of the model'],
  ['echo [-n] word…', 'print its words', 'Text'],
  ['grep [-ivnc] pattern [file…]', 'print the lines that hold a pattern', 'Text'],
  ['head [-n N] [file…]', 'print the first lines', 'Text'],
  ['tail [-n N] [file…]', 'print the last lines', 'Text'],
  ['wc [-lwc] [file…]', 'count lines, words and bytes', 'Text'],
  ['sort [-run] [file…]', 'print the lines in order', 'Text'],
  ['uniq [-c] [file…]', 'drop a line that repeats the one before', 'Text'],
  ['diff a b', 'print the lines in which two files differ', 'Text'],
];
export const WORDS = USAGE.map(([usage]) => usage.split(' ')[0]);

const PROGRAMS = ['check', 'snapshot', 'prove', 'audit'];
// Which of a command's words are paths, the options it takes, and the one option that takes a value.
const SHAPE = {
  ls: { paths: 'all', flags: 'l' }, cd: { paths: 'all' }, cat: { paths: 'all' }, kappa: { paths: 'all' }, touch: { paths: 'all' },
  write: { paths: 'all' }, append: { paths: 'all' }, cp: { paths: 'all' }, mv: { paths: 'all' }, rm: { paths: 'all', flags: 'r' },
  grep: { paths: 'rest', flags: 'ivnc' }, head: { paths: 'all', value: 'n' }, tail: { paths: 'all', value: 'n' },
  wc: { paths: 'all', flags: 'lwc' }, sort: { paths: 'all', flags: 'run' }, uniq: { paths: 'all', flags: 'c' }, diff: { paths: 'all' },
  check: { paths: 'first', free: true }, snapshot: { paths: 'first', free: true }, prove: { paths: 'first', free: true }, audit: { paths: 'first', free: true },
};

const MAX_PATH = 512;
const MAX_FILE = 4 << 20;
const MAX_FILES = 2000;
const MAX_TRANSCRIPT = 512 * 1024;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SESSION_NAME = /^[A-Za-z0-9._-]{1,40}$/;
const SESSION = 'prism/terminal-session/1';
const SESSIONS = 'prism/terminal-sessions/1';

/**
 * Where a path points, from the folder `cwd` ('/' or '/folder/'): 'model' with the file or folder it names, 'new'
 * with the file it would name inside the model, or 'outside'.
 */
export function resolveTarget(path, files, cwd = '/') {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/.test(path) || path.length > MAX_PATH) return { target: 'outside' };
  const parts = path.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (parts.length === 0) return { target: 'outside' }; parts.pop(); } else parts.push(part);
  }
  const at = '/' + parts.join('/');
  if (files.has(at)) return { target: 'model', file: at };
  const under = at === '/' ? '/' : at + '/';
  if (at === '/' || [...files.keys()].some((name) => name.startsWith(under))) return { target: 'model', folder: under };
  return { target: 'new', file: at };
}

/** A line as words and operators. A word is a list of parts: text as written, or a variable to look up later. */
export function lex(line) {
  const tokens = [];
  let word = null;
  const part = (p) => { (word ??= []).push(p); };
  const end = () => { if (word) { tokens.push({ word }); word = null; } };
  const variable = (at, quoted) => {
    // `at` is just past the $. Resolves [part, next index], or null when the $ stands for itself.
    if (line[at] === '(') throw new Error('$( … ) is not part of this command line: a command cannot be run inside a word.');
    if (line[at] === '?') return [{ name: '?', quoted }, at + 1];
    if (line[at] === '{') {
      const close = line.indexOf('}', at);
      const name = close < 0 ? '' : line.slice(at + 1, close);
      if (!NAME.test(name)) throw new Error('${ … } needs a variable name.');
      return [{ name, quoted }, close + 1];
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(at))?.[0];
    return name ? [{ name, quoted }, at + name.length] : null;
  };
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { end(); i++; continue; }
    if (ch === '#' && !word) break;
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) throw new Error("A ' is not closed.");
      part({ text: line.slice(i + 1, close), quoted: true });
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      let text = '';
      part({ text: '', quoted: true });
      for (i++; ; i++) {
        if (i >= line.length) throw new Error('A " is not closed.');
        const c = line[i];
        if (c === '"') { i++; break; }
        if (c === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) { text += line[++i]; continue; }
        if (c === '`') throw new Error('` … ` is not part of this command line: a command cannot be run inside a word.');
        if (c === '$') {
          const got = variable(i + 1, true);
          if (got) { if (text) part({ text, quoted: true }); text = ''; part(got[0]); i = got[1] - 1; continue; }
        }
        text += c;
      }
      if (text) part({ text, quoted: true });
      continue;
    }
    if (ch === '\\') { if (i + 1 < line.length) part({ text: line[i + 1], quoted: true }); i += 2; continue; }
    if (ch === '`') throw new Error('` … ` is not part of this command line: a command cannot be run inside a word.');
    if (ch === '$') {
      const got = variable(i + 1, false);
      if (got) { part(got[0]); i = got[1]; continue; }
      part({ text: '$', quoted: true });
      i++;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '>>') { end(); tokens.push({ op: two }); i += 2; continue; }
    if (ch === '&') throw new Error('& is not part of this command line: nothing runs in the background.');
    if ('|;<>'.includes(ch)) { end(); tokens.push({ op: ch }); i++; continue; }
    let j = i;
    while (j < line.length && !' \t\'"\\`$&|;<>'.includes(line[j])) j++;
    part({ text: line.slice(i, j), quoted: false });
    i = j;
  }
  end();
  return tokens;
}

/** Tokens as a list of pipelines: [{ join, stages: [{ words, from, to, append }] }]. */
export function build(tokens) {
  const list = [];
  let join = null;
  let stages = [];
  let stage = { words: [], from: null, to: null, append: false };
  const closeStage = () => {
    if (stage.words.length === 0) throw new Error(stage.from || stage.to ? 'A redirection needs a command.' : 'A command is missing.');
    stages.push(stage);
    stage = { words: [], from: null, to: null, append: false };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.word) { stage.words.push(t.word); continue; }
    if (t.op === '<' || t.op === '>' || t.op === '>>') {
      const next = tokens[++i];
      if (!next?.word) throw new Error(`${t.op} needs a file.`);
      if (t.op === '<') stage.from = next.word; else { stage.to = next.word; stage.append = t.op === '>>'; }
      continue;
    }
    if (t.op === '|') { closeStage(); continue; }
    // ; && ||. A line may end with a ; and nothing after it.
    if (stage.words.length === 0 && stages.length === 0 && !stage.from && !stage.to) {
      if (t.op === ';' && list.length > 0 && i === tokens.length - 1) break;
      throw new Error('A command is missing.');
    }
    closeStage();
    list.push({ join, stages });
    stages = [];
    join = t.op;
  }
  if (stage.words.length || stage.from || stage.to || stages.length) { closeStage(); list.push({ join, stages }); } else if (join && join !== ';') throw new Error('A command is missing.');
  return list;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linesOf = (text) => { const all = text.split('\n'); if (all[all.length - 1] === '') all.pop(); return all; };
const ended = (text) => (text === '' || text.endsWith('\n') ? text : text + '\n');

/** The lines in which two texts differ, by their longest common run of lines; null when either is too long. */
export function diffLines(a, b) {
  const x = linesOf(a);
  const y = linesOf(b);
  if (x.length * y.length > 4_000_000) return null;
  const w = y.length + 1;
  const table = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i * w + j] = x[i] === y[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; } else if (j >= y.length || (i < x.length && table[(i + 1) * w + j] >= table[i * w + j + 1])) { out.push(`-${i + 1} ${x[i]}`); i++; } else { out.push(`+${j + 1} ${y[j]}`); j++; }
  }
  return out;
}

/**
 * The command line.
 *   judge            makeJudge's
 *   writer           createWriter's
 *   files()          the open model now: Map of '/path' to text
 *   change           { write(path, text), remove(path) }: how the page changes a file of the model, or nothing when
 *                    the page holds the model read-only
 *   bytesOf(command) 'absent' | 'mismatch' | 'pinned': the executable the program needs, as held in this tab
 *   labelOf(command) the label the program is pinned to, or null
 *   programs         { check, snapshot, prove, audit }: each takes { '/path': text } and resolves its output as text
 *   kappa(bytes)     BLAKE3 label
 *   reuseAdmits      kappa-rules.mjs's rule, proved in model/rule-app
 *   kept             createKept's, or kappa-space.mjs's
 *   clear()          clear the screen
 */
export function createSession({ judge, writer, files, change = null, bytesOf, labelOf, programs, kappa, reuseAdmits, kept, clear }) {
  const log = [];
  const entered = [];
  const vars = new Map();
  let cwd = '/';
  let status = 0;
  let stopped = false;
  // What was typed and what was shown, as text, for `save`. Kept in this tab only until then.
  const transcript = [];
  let transcriptSize = 0;
  const record = (text) => {
    transcript.push(text);
    transcriptSize += text.length;
    while (transcriptSize > MAX_TRANSCRIPT && transcript.length > 1) transcriptSize -= transcript.shift().length;
  };
  // Everything a command prints is text: a control byte in it is written out, never sent. So no output, whatever
  // file or program it came from, can carry a sequence to the terminal. Only the line editor writes sequences.
  const say = (text) => { const shown = visible(text); record(shown); return writer.write(shown); };
  const rel = (path) => (path.startsWith(cwd) ? path.slice(cwd.length) : path);
  const label = (text) => kappa(enc.encode(text));

  /** A word's parts as one string, and whether it is a pattern over the model's files. */
  function expand(word) {
    let text = '';
    let pattern = '';
    let wild = false;
    for (const p of word) {
      const piece = p.name === undefined ? p.text : p.name === '?' ? String(status) : p.name === 'PWD' ? (cwd === '/' ? '/' : cwd.slice(0, -1)) : vars.get(p.name) ?? '';
      text += piece;
      if (p.name === undefined && !p.quoted && /[*?]/.test(piece)) { wild = true; pattern += escape(piece).replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]'); } else pattern += escape(piece);
    }
    if (!wild) return [text];
    const at = resolveTarget(text.replace(/[*?]/g, 'x'), files(), cwd);
    if (at.target === 'outside') return [text];
    // The pattern is matched against each file's path as it would be written from here.
    const test = new RegExp('^' + pattern + '$');
    const found = [...files().keys()].map((name) => (text.startsWith('/') ? name : rel(name))).filter((name) => test.test(name)).sort();
    return found.length ? found : [text];
  }

  /** A command's words after its name: its options, the words left, and which of those are paths. */
  function shaped(command, args) {
    const shape = SHAPE[command] ?? { paths: 'none', free: true };
    const flags = new Set();
    const rest = [];
    let value = null;
    let bad = null;
    let open = true;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!open || shape.free || !a.startsWith('-') || a === '-') { rest.push(a); continue; }
      if (a === '--') { open = false; continue; }
      if (shape.value && /^-\d+$/.test(a)) { value = Number(a.slice(1)); continue; }
      for (const letter of a.slice(1)) {
        if (letter === shape.value) { value = Number(args[++i]); if (!Number.isInteger(value) || value < 0) bad = `-${letter} needs a number`; } else if ((shape.flags ?? '').includes(letter)) flags.add(letter); else bad = `unknown option -${letter}`;
      }
    }
    const named = shape.paths === 'all' ? rest : shape.paths === 'rest' ? rest.slice(1) : shape.paths === 'first' ? rest.filter((a) => !a.startsWith('-')).slice(0, 1) : [];
    return { flags, rest, value, bad, named };
  }

  // What a running command is handed. Each use is put to the reach table first; there is no network, clipboard or
  // process here to ask for, and the table would deny them.
  function handOf(command, io) {
    const need = (resource) => {
      const answer = judge('reach', { command, resource });
      log.push({ command, resource, answer });
      if (answer !== 'allow') throw new Error(`${command} may not use ${resource}`);
    };
    return {
      stdin: io.stdin,
      /** The command's output: to the screen, or to whatever the line sends it to. */
      print: (text) => { if (io.piped) { io.out.push(text); return true; } need('screen'); return say(text); },
      /** What the command says about itself, always to the screen. */
      note: (text) => { need('screen'); return say(text); },
      fail: (text) => { io.status = 1; need('screen'); return say(text); },
      list: () => { need('readmodel'); return [...files().keys()].sort(); },
      read: (path) => { need('readmodel'); return files().get(path); },
      write: async (path, text) => {
        need('writemodel');
        if (!change) throw new Error('this page holds the model read-only');
        if (enc.encode(text).length > MAX_FILE) throw new Error(`${rel(path)}: more than ${MAX_FILE} bytes`);
        if (!files().has(path) && files().size >= MAX_FILES) throw new Error(`the model already holds ${MAX_FILES} files`);
        await change.write(path, text);
      },
      remove: async (path) => { need('writemodel'); if (!change) throw new Error('this page holds the model read-only'); await change.remove(path); },
      kept: (key) => { need('readstore'); return kept.get(key); },
      keep: (key, entry) => { need('writestore'); return kept.set(key, entry); },
    };
  }

  /** The texts a command works on: the files it names, or what is piped in. Null, after saying why, when neither. */
  async function sources(hand, command, c) {
    if (c.ats.length === 0) {
      if (hand.stdin !== null) return [{ name: '', text: hand.stdin }];
      await hand.fail(`${command} needs a file of the open model.\n`);
      return null;
    }
    const out = [];
    for (const [i, at] of c.ats.entries()) {
      if (!at.file) { await hand.fail(`${command}: ${c.named[i]} is a folder.\n`); return null; }
      out.push({ name: rel(at.file), text: hand.read(at.file) });
    }
    return out;
  }
  const sessionKey = (name) => label(JSON.stringify([SESSION, name]));
  const indexKey = label(JSON.stringify([SESSIONS]));
  async function sessionNames(hand) {
    const found = await hand.kept(indexKey);
    if (!found || found.output !== kappa(found.bytes)) return [];
    try { const names = JSON.parse(dec.decode(found.bytes)); return Array.isArray(names) ? names.filter((n) => typeof n === 'string' && SESSION_NAME.test(n)) : []; } catch { return []; }
  }
  const entry = (key, name, bytes) => ({ key, program: SESSION, input: label(name), output: kappa(bytes), bytes });

  const builtins = {
    help: (hand) => {
      const groups = [...new Set(USAGE.map(([, , group]) => group))];
      return hand.print('A command line for the open model. It starts no native program: the commands are these, and nothing else runs.\n'
        + groups.map((group) => group + '\n' + USAGE.filter(([, , g]) => g === group).map(([usage, what]) => '  ' + usage.padEnd(30) + what).join('\n')).join('\n')
        + '\nOn a line: a | b pipes, a ; b and a && b and a || b join, > file and >> file write, < file reads,\n\'…\' and "…" quote, $NAME is a variable, * and ? match files. Tab completes; Ctrl+R searches the history.\n');
    },
    clear: () => clear(),
    history: (hand) => hand.print(entered.map((line, i) => String(i + 1).padStart(4) + '  ' + line).join('\n') + (entered.length ? '\n' : '')),
    echo: (hand, c) => { const bare = c.args[0] === '-n'; return hand.print((bare ? c.args.slice(1) : c.args).join(' ') + (bare ? '' : '\n')); },
    pwd: (hand) => hand.print((cwd === '/' ? '/' : cwd.slice(0, -1)) + '\n'),
    cd: async (hand, c) => {
      if (c.ats.length > 1) return hand.fail('cd takes one folder.\n');
      const at = c.ats[0] ?? { folder: '/' };
      if (!at.folder) return hand.fail(`cd: ${c.named[0]} is not a folder.\n`);
      hand.list();
      cwd = at.folder;
    },
    set: (hand, c) => {
      if (c.args.length === 0) return builtins.env(hand);
      if (!NAME.test(c.args[0]) || c.args[0] === 'PWD') return hand.fail(`set: ${c.args[0]} is not a name a variable can have.\n`);
      if (vars.size >= 256 && !vars.has(c.args[0])) return hand.fail('set: there are 256 variables already.\n');
      vars.set(c.args[0], c.args.slice(1).join(' '));
    },
    unset: (hand, c) => { for (const name of c.args) vars.delete(name); },
    env: (hand) => hand.print([...vars].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, value]) => `${name}=${value}\n`).join('')),
    ls: async (hand, c) => {
      const names = hand.list();
      const shown = [];
      for (const at of c.ats.length ? c.ats : [{ folder: cwd }]) shown.push(...(at.file ? [at.file] : names.filter((name) => name.startsWith(at.folder))));
      const all = files();
      return hand.print(shown.map((name) => (c.flags.has('l') ? String(enc.encode(all.get(name)).length).padStart(8) + '  ' : '') + rel(name) + '\n').join(''));
    },
    cat: async (hand, c) => { const from = await sources(hand, 'cat', c); if (from) for (const s of from) await hand.print(ended(s.text)); },
    kappa: async (hand, c) => { const from = await sources(hand, 'kappa', c); if (from) for (const s of from) await hand.print(label(s.text) + '  ' + (s.name || '-') + '\n'); },
    grep: async (hand, c) => {
      if (c.rest.length === 0) return hand.fail('grep needs a pattern.\n');
      let test;
      try { test = new RegExp(c.rest[0], c.flags.has('i') ? 'i' : ''); } catch { test = new RegExp(escape(c.rest[0]), c.flags.has('i') ? 'i' : ''); }
      const from = await sources(hand, 'grep', c);
      if (!from) return;
      let found = 0;
      const out = [];
      for (const s of from) {
        let count = 0;
        const prefix = from.length > 1 ? s.name + ':' : '';
        linesOf(s.text).forEach((line, i) => {
          if (test.test(line) === c.flags.has('v')) return;
          count++;
          if (!c.flags.has('c')) out.push(prefix + (c.flags.has('n') ? i + 1 + ':' : '') + line + '\n');
        });
        if (c.flags.has('c')) out.push(prefix + count + '\n');
        found += count;
      }
      if (found === 0) hand.status(1);
      return hand.print(out.join(''));
    },
    head: async (hand, c) => { const from = await sources(hand, 'head', c); if (from) for (const s of from) await hand.print(linesOf(s.text).slice(0, c.value ?? 10).map((l) => l + '\n').join('')); },
    tail: async (hand, c) => { const from = await sources(hand, 'tail', c); if (from) for (const s of from) { const n = c.value ?? 10; await hand.print((n === 0 ? [] : linesOf(s.text).slice(-n)).map((l) => l + '\n').join('')); } },
    wc: async (hand, c) => {
      const from = await sources(hand, 'wc', c);
      if (!from) return;
      const which = c.flags.size ? ['l', 'w', 'c'].filter((f) => c.flags.has(f)) : ['l', 'w', 'c'];
      const count = (text) => ({ l: (text.match(/\n/g) ?? []).length, w: (text.match(/\S+/g) ?? []).length, c: enc.encode(text).length });
      return hand.print(from.map((s) => { const n = count(s.text); return which.map((f) => String(n[f]).padStart(8)).join('') + (s.name ? ' ' + s.name : '') + '\n'; }).join(''));
    },
    sort: async (hand, c) => {
      const from = await sources(hand, 'sort', c);
      if (!from) return;
      let all = from.flatMap((s) => linesOf(s.text));
      all.sort(c.flags.has('n') ? (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || (a < b ? -1 : a > b ? 1 : 0) : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (c.flags.has('r')) all.reverse();
      if (c.flags.has('u')) all = all.filter((line, i) => i === 0 || line !== all[i - 1]);
      return hand.print(all.map((l) => l + '\n').join(''));
    },
    uniq: async (hand, c) => {
      const from = await sources(hand, 'uniq', c);
      if (!from) return;
      const runs = [];
      for (const line of from.flatMap((s) => linesOf(s.text))) { const last = runs[runs.length - 1]; if (last && last[0] === line) last[1]++; else runs.push([line, 1]); }
      return hand.print(runs.map(([line, n]) => (c.flags.has('c') ? String(n).padStart(7) + ' ' : '') + line + '\n').join(''));
    },
    diff: async (hand, c) => {
      if (c.ats.length !== 2) return hand.fail('diff takes two files of the open model.\n');
      const from = await sources(hand, 'diff', c);
      if (!from) return;
      const out = diffLines(from[0].text, from[1].text);
      if (!out) return hand.fail('diff: the files are too long to compare here.\n');
      if (out.length) hand.status(1);
      return hand.print(out.map((l) => l + '\n').join(''));
    },
    touch: async (hand, c) => {
      if (c.ats.length === 0) return hand.fail('touch needs a file.\n');
      for (const at of c.ats) if (at.target === 'new') await hand.write(at.file, '');
    },
    write: async (hand, c) => {
      if (c.ats.length !== 1 || !c.ats[0].file) return hand.fail('write takes one file of the model.\n');
      if (hand.stdin === null) return hand.fail('write needs something piped in: echo text | write file\n');
      await hand.write(c.ats[0].file, hand.stdin);
    },
    append: async (hand, c) => {
      if (c.ats.length !== 1 || !c.ats[0].file) return hand.fail('append takes one file of the model.\n');
      if (hand.stdin === null) return hand.fail('append needs something piped in: echo text | append file\n');
      await hand.write(c.ats[0].file, (c.ats[0].target === 'model' ? hand.read(c.ats[0].file) : '') + hand.stdin);
    },
    rm: async (hand, c) => {
      if (c.ats.length === 0) return hand.fail('rm needs a file.\n');
      for (const [i, at] of c.ats.entries()) {
        if (at.file) { await hand.remove(at.file); continue; }
        if (at.folder === '/') { await hand.fail('rm: that is the whole model; it is not removed from here.\n'); continue; }
        if (!c.flags.has('r')) { await hand.fail(`rm: ${c.named[i]} is a folder; rm -r removes a folder.\n`); continue; }
        for (const name of [...files().keys()].filter((n) => n.startsWith(at.folder))) await hand.remove(name);
      }
    },
    cp: (hand, c) => copy(hand, c, 'cp'),
    mv: (hand, c) => copy(hand, c, 'mv'),
    save: async (hand, c) => {
      const name = c.args[0] ?? 'last';
      if (!SESSION_NAME.test(name)) return hand.fail('save: a name is 1 to 40 letters, digits, dots, dashes or underscores.\n');
      const bytes = enc.encode(transcript.join(''));
      const names = await sessionNames(hand);
      await hand.keep(sessionKey(name), entry(sessionKey(name), name, bytes));
      const listed = enc.encode(JSON.stringify([...new Set([...names, name])].sort()));
      await hand.keep(indexKey, entry(indexKey, SESSIONS, listed));
      return hand.print(`Kept as ${name}: ${bytes.length} bytes, ${kappa(bytes)}. It is in this browser only.\n`);
    },
    restore: async (hand, c) => {
      const name = c.args[0] ?? 'last';
      const found = SESSION_NAME.test(name) ? await hand.kept(sessionKey(name)) : null;
      // What comes back is shown only when it is the bytes its record names.
      if (!found || found.output !== kappa(found.bytes)) return hand.fail(`restore: no transcript is kept as ${name}.\n`);
      return hand.print(ended(dec.decode(found.bytes)));
    },
    sessions: async (hand) => hand.print((await sessionNames(hand)).map((n) => n + '\n').join('')),
  };
  async function copy(hand, c, command) {
    if (c.ats.length !== 2) return hand.fail(`${command} takes a file and where it goes.\n`);
    const [from, to] = c.ats;
    if (!from.file || from.target !== 'model') return hand.fail(`${command}: ${c.named[0]} is not a file of the open model.\n`);
    const dest = to.file ?? to.folder + from.file.slice(from.file.lastIndexOf('/') + 1);
    if (dest === from.file) return hand.fail(`${command}: ${c.named[0]} and ${c.named[1]} are the same file.\n`);
    await hand.write(dest, hand.read(from.file));
    if (command === 'mv') await hand.remove(from.file);
  }

  /** The key a program's output is kept under: the program's label and the label of everything it reads. */
  function keyOf(command, program, project) {
    const input = label(JSON.stringify(Object.keys(project).sort().map((path) => [path, project[path]])));
    return { input, key: label(JSON.stringify(['prism/terminal-output/1', command, program, input])) };
  }

  /** Run one command. `io` is { stdin, piped }. Resolves { answer, status, out }. */
  async function exec(first, args, io, line) {
    const command = WORDS.includes(first) ? first : 'other';
    const c = shaped(command, args);
    c.args = args;
    c.ats = c.named.map((path) => resolveTarget(path, files(), cwd));
    const target = c.ats.length === 0 ? 'none' : c.ats.some((at) => at.target === 'outside') ? 'outside' : c.ats.some((at) => at.target === 'new') ? 'new' : 'model';

    // The reuse rule is asked only for a command the reach table lets read the store, and only for a program.
    let stored = 'no';
    let found = null;
    let named = null;
    const program = PROGRAMS.includes(command) ? labelOf(command) : null;
    if (program && judge('reach', { command, resource: 'readstore' }) === 'allow') {
      const project = Object.fromEntries(files());
      named = keyOf(command, program, project);
      found = await kept.get(named.key);
      const admitted = reuseAdmits({
        present: found ? 1 : 0, storedKey: found?.key ?? '', computedKey: named.key, storedKernel: found?.program ?? '', kernelPinned: program,
        storedLibrary: found?.input ?? '', libraryPinned: named.input, storedBytes: found?.output ?? '', derivedBytes: found ? kappa(found.bytes) : '',
      });
      stored = admitted ? 'yes' : 'no';
    }
    // The executable is looked at only when the answer can turn on it.
    const bytes = program && stored === 'no' ? await bytesOf(command) : 'absent';
    const answer = judge('commands', { command, target, bytes, stored });
    log.push({ line, command, target, bytes, stored, answer });

    const state = { stdin: io.stdin, piped: io.piped, out: [], status: 0 };
    const hand = handOf(command, state);
    hand.status = (n) => { state.status = n; };
    try {
      if (answer === 'builtin') {
        if (c.bad) await hand.fail(`${command}: ${c.bad}.\n`); else await builtins[command](hand, c);
      } else if (answer === 'reuse') {
        hand.kept(named.key);
        await hand.print(dec.decode(found.bytes));
        if (!io.piped) await hand.note(`(kept output ${found.output.slice(0, 19)}…, shown again; nothing was run)\n`);
      } else if (answer === 'run') {
        const project = Object.fromEntries(hand.list().map((name) => [name, hand.read(name)]));
        const made = await programs[command](project);
        const out = enc.encode(made.text.replace(/\n?$/, '\n'));
        // Only an output the program finished is kept, under the key of exactly what it read.
        if (made.keep !== false && named) await hand.keep(named.key, { key: named.key, program, input: named.input, output: kappa(out), bytes: out });
        if (made.keep === false) state.status = 1;
        await hand.print(dec.decode(out));
      } else {
        state.status = command === 'other' ? 127 : 126;
        const at = c.ats.findIndex((a) => a.target === (target === 'outside' ? 'outside' : 'new'));
        if (command === 'other') await say(`${first}: not a command here. Type help.\n`);
        else if (target === 'outside') await say(`${c.named[at]}: not in the open model.\n`);
        else if (target === 'new') await say(`${c.named[at]}: no such file in the open model.\n`);
        else if (bytes === 'mismatch') await say(`${command}: its program is not the pinned one, so nothing was run.\n`);
        else await say(`${command}: its program could not be fetched, so nothing was run.\n`);
      }
    } catch (error) {
      state.status = 1;
      await say(`${command}: ${String(error?.message ?? error)}\n`);
    }
    return { answer, status: state.status, out: state.out.join('') };
  }

  /** Run the commands of one pipeline, each handed the output of the one before. Resolves the last answer. */
  async function pipeline(stages, line) {
    const plan = [];
    for (const stage of stages) {
      let argv = stage.words.flatMap(expand);
      // NAME=value is `set NAME value`; `lexlean check` and `lexlean snapshot` are the commands' full names.
      const assigned = argv.length === 1 && stage.words[0][0].name === undefined && !stage.words[0][0].quoted ? /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(argv[0]) : null;
      if (assigned) argv = ['set', assigned[1], assigned[2]];
      if (argv[0] === 'lexlean' && ['check', 'snapshot'].includes(argv[1])) argv.shift();
      const one = (word, what) => { const got = expand(word); if (got.length !== 1) throw new Error(`${what} names ${got.length} files; it takes one.`); return got[0]; };
      plan.push({ argv, from: stage.from ? one(stage.from, '<') : null, to: stage.to ? one(stage.to, stage.append ? '>>' : '>') : null, append: stage.append });
    }
    // Nothing of a pipeline runs when one of its words is not a command.
    const unknown = plan.find((p) => !WORDS.includes(p.argv[0]));
    if (unknown) {
      const refused = await exec(unknown.argv[0], unknown.argv.slice(1), { stdin: null, piped: false }, line);
      status = refused.status;
      return refused.answer;
    }
    let stdin = null;
    let answer = null;
    for (const [i, p] of plan.entries()) {
      if (stopped) { status = 130; return answer; }
      if (p.from !== null) {
        const read = await exec('cat', [p.from], { stdin: null, piped: true }, line);
        if (read.answer !== 'builtin' || read.status !== 0) { status = read.status || 1; return read.answer === 'builtin' ? answer : read.answer; }
        stdin = read.out;
      }
      const last = i === plan.length - 1;
      const ran = await exec(p.argv[0], p.argv.slice(1), { stdin, piped: !last || p.to !== null }, line);
      answer = ran.answer;
      status = ran.status;
      if (ran.answer === 'refuse') return answer;
      stdin = ran.out;
      if (p.to !== null) {
        const wrote = await exec(p.append ? 'append' : 'write', [p.to], { stdin, piped: false }, line);
        if (wrote.answer !== 'builtin') { status = wrote.status; return wrote.answer; }
        if (wrote.status !== 0) status = wrote.status;
        stdin = '';
      }
    }
    return answer;
  }

  /** Run one line. Resolves the table's answer to its last command, for the caller's record. */
  async function run(line) {
    writer.resume();
    stopped = false;
    record('model> ' + visible(line) + '\n');
    if (line.trim()) entered.push(line);
    let list;
    try { list = build(lex(line)); } catch (error) { status = 2; await say(String(error?.message ?? error) + '\n'); return 'refuse'; }
    let answer = null;
    for (const item of list) {
      if (stopped) break;
      if ((item.join === '&&' && status !== 0) || (item.join === '||' && status === 0)) continue;
      try { answer = await pipeline(item.stages, line); } catch (error) { status = 2; answer = 'refuse'; await say(String(error?.message ?? error) + '\n'); }
    }
    return answer;
  }

  /**
   * What could finish the word the cursor is in. `before` is the line up to the cursor. Resolves
   * { from, options }: the word starts at `from`, and each option is a whole word that could stand there.
   */
  function complete(before) {
    let from = before.length;
    while (from > 0 && !' \t|;&<>'.includes(before[from - 1])) from--;
    const word = before.slice(from);
    const head = before.slice(0, from).trimEnd();
    const first = head === '' || /[|;&]$/.test(head);
    if (first) return { from, options: WORDS.filter((name) => name.startsWith(word)).sort().map((name) => name + ' ') };
    if (/['"$\\*?]/.test(word)) return { from, options: [] };
    const slash = word.lastIndexOf('/');
    const base = word.slice(0, slash + 1);
    const at = resolveTarget(base || '.', files(), cwd);
    if (!at.folder) return { from, options: [] };
    const options = new Set();
    for (const name of files().keys()) {
      if (!name.startsWith(at.folder)) continue;
      const tail = name.slice(at.folder.length);
      const cut = tail.indexOf('/');
      const next = cut < 0 ? tail + ' ' : tail.slice(0, cut + 1);
      if (next.startsWith(word.slice(slash + 1))) options.add(base + next);
    }
    return { from, options: [...options].sort() };
  }

  return {
    run, log, complete,
    commands: () => WORDS,
    interrupt() { stopped = true; writer.stop(); },
    get cwd() { return cwd; },
    get status() { return status; },
    prompt: () => (cwd === '/' ? 'model> ' : `model${cwd.slice(0, -1)}> `),
    history: () => entered,
  };
}
