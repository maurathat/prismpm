/**
 * What an author needs to fix a model in one pass. LexLean reports the first problem it meets, anchored where the
 * phase that found it started, and names the thing it could not use in backticks. This adds, from the model's own
 * sources and nothing else: the line where that name is written, the text of the line, and the names in scope
 * closest to it. It never changes a diagnostic; it only adds to what the author sees.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The types and constructors every model can use without declaring them (LexLean language 1.2). */
export const BUILTIN = Object.freeze(['Bool', 'Nat', 'Int', 'String', 'Bytes', 'Option', 'List', 'Result', 'Prod', 'Unit', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'Int8', 'Int16', 'Int32', 'Int64', 'true', 'false', 'Option.some', 'Option.none', 'Result.ok', 'Result.error']);

const sources = (dir) => {
  const out = [];
  const walk = (at) => {
    if (!existsSync(at)) return;
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(at, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.lex.tex')) out.push({ path: relative(dir, p).split(sep).join('/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') });
    }
  };
  walk(join(dir, 'src'));
  return out;
};

/** Every name the model declares: modules, structures, inductives, definitions, theorems, fields and constructors. */
export function declaredNames(files) {
  const names = new Set();
  for (const { text } of files) {
    for (const m of text.matchAll(/\\begin\{lexlean\}\{([\w.]+)\}/g)) names.add(m[1]);
    for (const m of text.matchAll(/\bname:\s*([A-Za-z_][\w']*)/g)) names.add(m[1]);
  }
  return names;
}

/** Edit distance, bounded: past `max` it stops counting. */
export function distance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** The names in scope closest to `name`, nearest first; none when `name` is itself in scope. */
export function nearest(name, scope, limit = 3) {
  const bare = name.includes('::') ? name.slice(name.lastIndexOf('::') + 2) : name;
  if (scope.has(bare)) return [];
  const max = Math.max(1, Math.floor(bare.length / 3));
  // A namespace the name is written in (`Bool` for `Bool.and_eq_true`) is where it was looked for, never what to write instead.
  const namespace = (n) => bare.startsWith(`${n}.`);
  // A name that one of them begins (`Boolean` for `Bool`) is as near as one edit.
  const prefix = (n) => n.length >= 3 && (bare.toLowerCase().startsWith(n.toLowerCase()) || n.toLowerCase().startsWith(bare.toLowerCase()));
  return [...scope].filter((n) => !namespace(n)).map((n) => [n, prefix(n) ? 1 : distance(bare, n, max)]).filter(([, d]) => d <= max).sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).slice(0, limit).map(([n]) => n);
}

/**
 * The hints for one diagnostic (`{ code, message, span: { file, line } }`): `at` and `line`, where the first name it
 * quotes is written (the diagnostic's own place when that name is written nowhere), and `didYouMean`, the closest
 * names in scope for a name that is not.
 */
export function hintFor(diagnostic, files, scope) {
  const quoted = [...String(diagnostic.message).matchAll(/`([A-Za-z_][\w'.:]*)`/g)].map((m) => m[1]).filter((q) => !/^(\\|lexlean)/.test(q));
  const hint = {};
  // The name the problem is about is the one not in scope: `netwrk` in "record `Skill` has no field `netwrk`".
  const inScope = (q) => scope.has(q.includes('::') ? q.slice(q.lastIndexOf('::') + 2) : q);
  quoted.sort((a, b) => inScope(a) - inScope(b));
  for (const q of quoted) {
    const bare = q.includes('::') ? q.slice(q.lastIndexOf('::') + 2) : q;
    const pattern = new RegExp(`(^|[^\\w'.])${bare.replace(/[.'$]/g, '\\$&')}(?![\\w'])`);
    const ordered = diagnostic.span ? [...files.filter((f) => f.path === diagnostic.span.file), ...files.filter((f) => f.path !== diagnostic.span.file)] : files;
    for (const f of ordered) {
      const lines = f.text.split('\n');
      const from = f.path === diagnostic.span?.file ? Math.max(0, (diagnostic.span.line ?? 1) - 1) : 0;
      const i = lines.findIndex((l, n) => n >= from && pattern.test(l) && !/^\s*name:\s/.test(l));
      if (i >= 0) {
        hint.at = `${f.path}:${i + 1}`;
        hint.line = lines[i].trim();
        break;
      }
    }
    const near = nearest(q, scope);
    if (near.length) hint.didYouMean = near;
    if (hint.at || hint.didYouMean) {
      hint.name = q;
      break;
    }
  }
  return hint;
}

/** Hints for each diagnostic, read from the model under `dir`. */
export function hints(diagnostics, dir) {
  const files = sources(dir);
  const scope = new Set([...BUILTIN, ...declaredNames(files)]);
  return diagnostics.map((d) => hintFor(d, files, scope));
}
