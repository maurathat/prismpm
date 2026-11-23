/**
 * The lock of a LexLean project, written again after the project changed: `lexlean.toml` renamed or re-bounded, a
 * workspace file changed, a lexicon of the project's own edited or added.
 *
 * LexLean as WebAssembly runs no command that changes a project, so it cannot write the lock; it can check one,
 * byte for byte (`lexlean lock --check`). So the lock is proposed here and judged there: `lockCandidate` writes the
 * canonical bytes from the project's files, and the caller keeps them only when LexLean accepts them as the lock it
 * would have written (model-cli.mjs, `modelLock`). Nothing here is trusted on its own.
 *
 * What a candidate can hold: the hash of `lexlean.toml`, the hashes of the workspace files the lock already names,
 * every lexicon the project keeps in a folder (`kind = "path"`), and the embedded packages the lock already names.
 * The hashes of an embedded package are LexLean's own and are not computed here, so a project that newly needs one
 * the lock does not hold is refused, and so is a lock with a Git package, a source package or a PDF provider.
 *
 * No import of Node: files in, text out.
 */
import { PrismCodeError } from '../errors.mjs';
import { sha256HexSync } from '../sha256.mjs';
import { parseToml } from '../toml.mjs';

const text = (bytes) => new TextDecoder().decode(bytes);
const unresolved = (message) => new PrismCodeError('lock.unresolved', message);
const quoted = (value) => JSON.stringify(String(value));

/** The files as a Map of project-relative paths, forward slashes, no leading slash, to bytes. */
function relative(files) {
  const pairs = files instanceof Map ? [...files] : Array.isArray(files) ? files : Object.entries(files ?? {});
  return new Map(pairs.map(([path, content]) => [String(path).replace(/^\/+/, ''), typeof content === 'string' ? new TextEncoder().encode(content) : content]));
}

/** LexLean's tree digest (`lexlean-tree-v1`): each file, sorted by path, framed by the lengths of its path and bytes. */
export function treeDigest(entries) {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [new TextEncoder().encode('lexlean-tree-v1'), new Uint8Array([0])];
  for (const [path, bytes] of sorted) {
    const name = new TextEncoder().encode(path);
    const head = new DataView(new ArrayBuffer(4));
    head.setUint32(0, name.length);
    const size = new DataView(new ArrayBuffer(8));
    size.setBigUint64(0, BigInt(bytes.length));
    parts.push(new Uint8Array(head.buffer), name, new Uint8Array(size.buffer), bytes);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return sha256HexSync(all);
}

/** The `[[package]]` rows of a lock, by id, each with the members the canonical lock writes. */
function lockedPackages(lock) {
  const rows = new Map();
  for (const block of lock.split(/\n(?=\[\[)/).filter((b) => b.startsWith('[[package]]'))) {
    const member = (name) => new RegExp(`^${name} = "([^"\\n]*)"$`, 'm').exec(block)?.[1] ?? null;
    const imports = [.../^imports = \[(.*)\]$/m.exec(block)?.[1].matchAll(/"([^"]*)"/g) ?? []].map((m) => m[1]);
    rows.set(member('id'), { id: member('id'), version: member('version'), kind: member('kind'), source: member('source'), revision: member('revision'), tree: member('tree_sha256'), manifest: member('manifest_sha256'), imports });
  }
  return rows;
}

/**
 * The lock the project's files call for, as text. `files` is the project: a Map, pairs or an object of path to
 * bytes or text, paths relative to the folder that holds `lexlean.toml`. Throws `lock.unresolved` when the lock
 * cannot be written here; the message says what stands in the way.
 */
export function lockCandidate(files) {
  const project = relative(files);
  const configBytes = project.get('lexlean.toml');
  if (!configBytes) throw unresolved('The project has no lexlean.toml.');
  // lexlean.toml holds arrays of tables, which the manifest reader does not take: only what a lock depends on is read.
  const configText = text(configBytes).replace(/\r\n/g, '\n');
  const blocks = configText.split(/\n(?=\[)/);
  const member = (block, name) => new RegExp(`^${name}\\s*=\\s*"([^"\\n]*)"`, 'm').exec(block)?.[1] ?? null;
  const config = {
    lockfile: member(blocks[0], 'lockfile'),
    lexicon_source: blocks.filter((b) => b.startsWith('[[lexicon_source]]')).map((b) => ({ package: member(b, 'package'), kind: member(b, 'kind'), path: member(b, 'path') })),
    source_package: blocks.some((b) => b.startsWith('[[source_package]]')),
    pdf: blocks.some((b) => b.startsWith('[pdf]')),
  };
  const lockfile = config.lockfile ?? 'lexlean.lock';
  const held = project.get(lockfile);
  if (!held) throw unresolved(`The project has no ${lockfile} to write again: a lock starts from the one the template ships, which holds LexLean's own hashes of its embedded packages.`);
  const lock = text(held).replace(/\r\n/g, '\n');
  if (/^\[\[source_package\]\]$|^\[pdf\]$/m.test(lock) || config.source_package || config.pdf) throw unresolved('The project declares a source package or a PDF provider, which this command does not lock.');
  const head = {};
  for (const name of ['spec', 'language', 'compiler_semantics', 'lean_toolchain']) {
    head[name] = new RegExp(`^${name} = "([^"\\n]*)"$`, 'm').exec(lock)?.[1];
    if (!head[name]) throw unresolved(`${lockfile} names no ${name}, so it is not a lock to write again.`);
  }

  // The workspace files the lock already pins, each by the bytes it has now.
  const workspace = [...lock.matchAll(/^\[\[workspace_file\]\]\npath = "([^"\n]+)"$/gm)].map((m) => m[1]).sort();
  for (const path of workspace) if (!project.has(path)) throw unresolved(`${lockfile} pins the workspace file ${path}, which the project no longer has.`);

  // The closure of the lexicons the project configures: its own, from their folders, and LexLean's, from the lock.
  const locked = lockedPackages(lock);
  const sources = new Map((config.lexicon_source ?? []).map((s) => [s.package, s]));
  const rows = new Map();
  const queue = [...sources.keys()];
  while (queue.length > 0) {
    const id = queue.shift();
    if (rows.has(id)) continue;
    const source = sources.get(id);
    let row;
    if (source?.kind === 'path') {
      const root = String(source.path).replace(/\/+$/, '');
      const manifest = project.get(`${root}/lexicon.toml`);
      if (!manifest) throw unresolved(`The lexicon ${id} is configured at ${root}, which holds no lexicon.toml.`);
      const stated = parseToml(text(manifest));
      if (stated.package !== id) throw unresolved(`${root}/lexicon.toml states the package ${stated.package}, and lexlean.toml configures it as ${id}.`);
      const tree = [...project].filter(([path]) => path === `${root}/lexicon.toml` || path.startsWith(`${root}/entries/`)).map(([path, bytes]) => [path.slice(root.length + 1), bytes]);
      row = { id, version: stated.version, kind: 'path', source: root, revision: 'none', tree: treeDigest(tree), manifest: sha256HexSync(manifest), imports: stated.imports ?? [] };
    } else {
      row = locked.get(id);
      if (!row || (source && row.kind !== source.kind)) {
        throw unresolved(`The project needs the ${source?.kind ?? 'embedded'} package ${id}, which ${lockfile} does not hold. Its hashes are LexLean's own, so this command cannot add it: start from a template whose lock holds it.`);
      }
      if (row.kind !== 'builtin') throw unresolved(`${lockfile} holds the ${row.kind} package ${id}, which this command does not lock.`);
    }
    rows.set(id, row);
    for (const needed of row.imports) queue.push(needed.slice(0, needed.lastIndexOf('@')));
  }

  const out = [`spec = ${quoted(head.spec)}`, `language = ${quoted(head.language)}`, `compiler_semantics = ${quoted(head.compiler_semantics)}`, `project_config_sha256 = ${quoted(sha256HexSync(configBytes))}`, `lean_toolchain = ${quoted(head.lean_toolchain)}`];
  for (const path of workspace) out.push('', '[[workspace_file]]', `path = ${quoted(path)}`, `sha256 = ${quoted(sha256HexSync(project.get(path)))}`);
  const ordered = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : 1));
  for (const row of ordered) {
    out.push('', '[[package]]', `id = ${quoted(row.id)}`, `version = ${quoted(row.version)}`, `kind = ${quoted(row.kind)}`, `source = ${quoted(row.source)}`, `revision = ${quoted(row.revision)}`, `tree_sha256 = ${quoted(row.tree)}`, `manifest_sha256 = ${quoted(row.manifest)}`, `imports = [${row.imports.map(quoted).join(', ')}]`);
  }
  return { lockfile, text: `${out.join('\n')}\n` };
}
