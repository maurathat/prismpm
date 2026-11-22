/**
 * The template contract's ratchet, `uor/template-contract/1`, as far as a workspace's own files decide it.
 *
 * A workspace made from the template keeps three registers and its scenarios:
 *
 *   model/ids.toml            every conformance ID it holds, each with a level and a statement
 *   model/authorities.toml    what it cites instead of proving
 *   model/ledger.toml         the claims that are not conformance IDs, each with its level
 *   features/suites/*.feature one scenario for each ID, tagged `@ID @level`
 *
 * `check` reads them when `model/ids.toml` is there, and refuses:
 *
 *   R1  contract.conformance   an ID that CONFORMANCE.md, generated from the register, does not list
 *   R2  contract.level         a level that is not some-true, build or open; a scenario tagged another level
 *       contract.authority     a some-true claim that cites no authority the workspace names; an authority
 *                              realized by an ID that is not registered
 *       contract.duplicate     one ID registered twice, in one register or across them
 *   R3  contract.unspecified   a registered ID with no scenario
 *       contract.unregistered  a scenario tagged with an ID the register does not hold
 *       contract.untested      a registered ID with no test named for it
 *       contract.register      a register that cannot be read
 *
 * R4 (no stub, no undeclared axiom) and R6 (locked imports) are LexLean's and the kernel's, in `check` itself. A
 * workspace with no `model/ids.toml` is not a template workspace, and nothing here runs.
 *
 * The register's `spec` decides the rest. `template/1` is contract 1: R3 asks for a test named for each ID, and R1
 * for CONFORMANCE.md to list every ID. `template/2` is contract 2, the standalone frame (TEMPLATE-CONTRACT.md):
 *
 *   R1  contract.conformance    CONFORMANCE.md that is not conformanceDocument(root), byte for byte
 *   R3  contract.untested       a build row that names no theorem in `theorems`
 *       contract.theorem-unstated  (checkTheorems) a named theorem the model does not state
 *       contract.theorem-unproved  (checkTheorems) a named theorem Lean's kernel did not prove within its axioms
 *   R5  contract.rejects-scenario  a row with `failure` whose scenario is not tagged @rejects
 *       contract.negative       a row with `failure` whose `negative` is not a registered build row
 *       contract.refusal-unreplayed (checkRefusals) a row with `failure` no replayed vector is refused with
 *       contract.policy-drift   a universal policy file whose bytes are not the BLAKE3 label template.lock binds
 *       contract.spec           a register spec that is neither template/1 nor template/2
 *
 * checkContract reads files and nothing else. checkTheorems and checkRefusals judge what check and build hand them:
 * the kernel's verdicts and the replayed vectors. Each returns `{ diagnostics }`, checkContract also
 * `{ applies, summary }`.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PrismCodeError } from './errors.mjs';
import { kappa } from './blake3.mjs';

export const LEVELS = Object.freeze(['some-true', 'build', 'open']);
/** The register specs this ratchet reads: contract 1, and contract 2, the standalone frame. */
export const SPECS = Object.freeze(['template/1', 'template/2']);
/** The universal policy files a `uor/template-lock/2` binds, the lock itself excepted. */
const LOCK_SCHEMA = 'uor/template-lock/2';

const forward = (path) => path.split(sep).join('/');
/** A code of this module's own, written as an error so that it is registered like every code prism-code raises. */
const coded = (error) => ({ code: error.code, message: error.message });

/** Folders a test is never kept in, and that are too large to read on every check. */
const SKIPPED = new Set(['node_modules', 'target', '.git', '.prism', '.lake', '.lexlean', '.claude', '.agents', 'dist', 'build', 'vendor']);
const TEST_FILE = /\.(rs|mjs|cjs|js|ts|tsx|py|go|sh|feature)$/;
const MAX_TEST_BYTES = 2 * 1024 * 1024;

/** Every file under `dir` that may hold a test, by path. Bounded: skipped folders and large files are not read. */
function testFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) testFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && TEST_FILE.test(entry.name) && !entry.name.endsWith('.feature')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** The name a test of an ID ends in: the ID lowercased, every other character an underscore. */
export const testNameOf = (id) => id.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * A register as rows: `{ <table>: [{ key: value }] }` for every `[[table]]` block. A register is flat TOML: arrays of
 * tables whose members are strings, numbers, booleans or arrays of strings. Anything else in it is a reading error.
 */
export function parseRegister(text) {
  const out = {};
  let row = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const table = /^\[\[([A-Za-z0-9_-]+)\]\]$/.exec(line);
    if (table) {
      row = {};
      (out[table[1]] ??= []).push(row);
      continue;
    }
    if (/^\[[A-Za-z0-9_.-]+\]$/.test(line)) {
      row = {};
      continue;
    }
    const member = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!member) throw new Error(`line ${i + 1}: not a member, a table or a comment`);
    let value = member[2];
    // An array may run over several lines; read to the bracket that closes it.
    if (value.startsWith('[')) {
      while (!/\]\s*(#.*)?$/.test(value) && i + 1 < lines.length) value += ` ${lines[++i].trim()}`;
      value = value.replace(/\s+#[^"]*$/, '').replace(/,\s*\]$/, ']');
    }
    // A string may be followed by a comment; the string ends at its closing quote.
    const quoted = /^("(?:[^"\\]|\\.)*")\s*(#.*)?$/.exec(value);
    if (quoted) value = quoted[1];
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value.replace(/\s+#.*$/, '');
    }
    if (row) row[member[1]] = parsed;
    else if (!Array.isArray(parsed) || parsed.length > 0) out[member[1]] = parsed;
  }
  return out;
}

function readRegister(root, file, diagnostics) {
  const path = join(root, 'model', file);
  if (!existsSync(path)) return null;
  try {
    return parseRegister(readFileSync(path, 'utf8'));
  } catch (error) {
    diagnostics.push({ ...coded(new PrismCodeError('contract.register', `model/${file} cannot be read: ${error.message}`)), file: `model/${file}`, line: null, remediation: 'Repair the register; it is TOML.' });
    return null;
  }
}

/** The line a row's `id = "..."` is written on, for a diagnostic. */
function lineOf(text, id) {
  const at = text.indexOf(`id = "${id}"`);
  return at < 0 ? null : text.slice(0, at).split('\n').length;
}

/** The scenarios of every suite: `[{ file, line, ids: [...], levels: [...] }]`. A tag is an ID when it is `@LETTERS-digits...`. */
export function scenarios(root) {
  const dir = join(root, 'features', 'suites');
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.feature')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/^\s*@/.test(line)) return;
      // The tags of a scenario are on the line or lines directly above it; a Feature's own tags are not a scenario's.
      let next = index + 1;
      while (next < lines.length && /^\s*(@|#|$)/.test(lines[next])) next++;
      if (!/^\s*Scenario( Outline)?:/.test(lines[next] ?? '')) return;
      if (index > 0 && /^\s*@/.test(lines[index - 1])) return;
      const tags = lines.slice(index, next).join(' ').match(/@[^\s@]+/g) ?? [];
      out.push({
        file: `features/suites/${name}`,
        line: index + 1,
        ids: tags.map((t) => t.slice(1)).filter((t) => /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/.test(t)),
        levels: tags.map((t) => t.slice(1)).filter((t) => LEVELS.includes(t)),
        rejects: tags.includes('@rejects'),
      });
    });
  }
  return out;
}

/** The template workspace a project belongs to: `dir` or the folder above it, whichever holds `model/ids.toml`. */
export function contractRoot(...candidates) {
  for (const dir of candidates) if (dir && existsSync(join(dir, 'model', 'ids.toml'))) return dir;
  return null;
}

/** Run the ratchet over the workspace at `root`. */
export function checkContract(root) {
  const diagnostics = [];
  if (!root || !existsSync(join(root, 'model', 'ids.toml'))) return { applies: false, summary: {}, diagnostics };
  const push = (error, { file = null, line = null, id = null, remediation = null } = {}) => diagnostics.push({ ...coded(error), file, line, id, remediation });

  const idsText = readFileSync(join(root, 'model', 'ids.toml'), 'utf8');
  const ids = readRegister(root, 'ids.toml', diagnostics);
  const authorities = readRegister(root, 'authorities.toml', diagnostics);
  const ledger = readRegister(root, 'ledger.toml', diagnostics);
  const rows = Array.isArray(ids?.id) ? ids.id : [];
  const spec = ids?.spec ?? 'template/1';
  const contract2 = spec === 'template/2';
  // A template register names its contract; a register of another spec (this repository's own) is read as contract 1.
  if (ids && spec.startsWith('template/') && !SPECS.includes(spec)) push(new PrismCodeError('contract.spec', `model/ids.toml has spec ${JSON.stringify(spec)}; this prism-code reads ${SPECS.join(' and ')}.`), { file: 'model/ids.toml', remediation: 'Write the register as template/2 (TEMPLATE-CONTRACT.md), or upgrade prism-code.' });
  const cited = Array.isArray(authorities?.authority) ? authorities.authority : [];
  const claims = Array.isArray(ledger?.claim) ? ledger.claim : [];

  // R2: one ID, one row, one level.
  const registered = new Map();
  for (const row of rows) {
    const at = { file: 'model/ids.toml', line: lineOf(idsText, row.id), id: row.id };
    if (registered.has(row.id)) push(new PrismCodeError('contract.duplicate', `The ID ${row.id} is registered twice in model/ids.toml.`), { ...at, remediation: 'Keep one row for each ID (R2): a claim has one source.' });
    registered.set(row.id, row);
    if (!LEVELS.includes(row.level)) push(new PrismCodeError('contract.level', `The ID ${row.id} has the level ${JSON.stringify(row.level)}; a level is some-true, build or open.`), { ...at, remediation: 'Choose the level first (R2): it decides what evidence the claim owes.' });
  }
  const authorityIds = new Set(cited.map((a) => a.id));
  for (const claim of claims) {
    const at = { file: 'model/ledger.toml', id: claim.id };
    if (registered.has(claim.id)) push(new PrismCodeError('contract.duplicate', `The claim ${claim.id} is in model/ledger.toml and is also a conformance ID in model/ids.toml.`), { ...at, remediation: 'A conformance ID lives in model/ids.toml alone (R1, R2).' });
    if (!LEVELS.includes(claim.level)) push(new PrismCodeError('contract.level', `The claim ${claim.id} has the level ${JSON.stringify(claim.level)}; a level is some-true, build or open.`), { ...at, remediation: 'Choose the level first (R2).' });
    if (claim.level === 'some-true' && !authorityIds.has(claim.authority)) push(new PrismCodeError('contract.authority', `The claim ${claim.id} is reproduced from an authority (some-true) and cites ${JSON.stringify(claim.authority ?? null)}, which model/authorities.toml does not name.`), { ...at, remediation: 'Name the authority in model/authorities.toml before a claim says some-true (R2).' });
  }
  for (const authority of cited) {
    for (const id of Array.isArray(authority.realized_by) ? authority.realized_by : []) {
      if (!registered.has(id)) push(new PrismCodeError('contract.authority', `The authority ${authority.id} is realized by ${id}, which model/ids.toml does not register.`), { file: 'model/authorities.toml', id, remediation: 'Register the ID, or take it off the authority (R2).' });
    }
  }

  // R3: every ID has a scenario, and every scenario's ID is registered. A scenario's level is its ID's.
  const found = scenarios(root);
  const specified = new Set();
  for (const scenario of found) {
    for (const id of scenario.ids) {
      const row = registered.get(id);
      if (!row) {
        push(new PrismCodeError('contract.unregistered', `A scenario is tagged @${id}, which model/ids.toml does not register.`), { file: scenario.file, line: scenario.line, id, remediation: `Register ${id} in model/ids.toml first, with its level and statement (R3).` });
        continue;
      }
      specified.add(id);
      for (const level of scenario.levels) {
        if (LEVELS.includes(row.level) && level !== row.level) push(new PrismCodeError('contract.level', `The scenario of ${id} is tagged @${level}, and the register gives ${id} the level ${row.level}.`), { file: scenario.file, line: scenario.line, id, remediation: 'Tag the scenario with the level its ID has (R2).' });
      }
    }
  }
  const unspecified = [...registered.keys()].filter((id) => !specified.has(id));
  for (const id of unspecified) push(new PrismCodeError('contract.unspecified', `The ID ${id} is registered and has no scenario.`), { file: 'model/ids.toml', line: lineOf(idsText, id), id, remediation: `Add a scenario tagged @${id} under features/suites/ before the behavior is built (R3).` });

  // R3 (template/2): a build row is proved, not tested: it names the theorems of the model that prove it, which
  // checkTheorems holds to the kernel's verdicts. R5: a row that specifies a failure has a rejecting scenario and a
  // registered build row that proves the refusal's condition.
  if (contract2) {
    const rejecting = new Set(found.filter((f) => f.rejects).flatMap((f) => f.ids));
    for (const row of registered.values()) {
      const at = { file: 'model/ids.toml', line: lineOf(idsText, row.id), id: row.id };
      const named = Array.isArray(row.theorems) ? row.theorems : [];
      if (row.level === 'build' && named.length === 0) push(new PrismCodeError('contract.untested', `The build ID ${row.id} names no theorem in \`theorems\`.`), { ...at, remediation: 'Name the theorems of the model that prove it, each Module.name (R3).' });
      if (row.failure === undefined) continue;
      if (typeof row.failure !== 'string' || row.failure === '') push(new PrismCodeError('contract.negative', `The ID ${row.id} declares a failure that is not the text of a refusal.`), { ...at, remediation: 'Write `failure` as the exact response the application refuses with (R5).' });
      if (!rejecting.has(row.id)) push(new PrismCodeError('contract.rejects-scenario', `The ID ${row.id} declares a failure, and no scenario tagged @${row.id} is also tagged @rejects.`), { ...at, remediation: `Tag the scenario of ${row.id} @rejects, and say in it what is refused (R5).` });
      const negative = registered.get(row.negative);
      if (!negative || negative.level !== 'build') push(new PrismCodeError('contract.negative', `The ID ${row.id} declares a failure whose negative ${JSON.stringify(row.negative ?? null)} is not a registered build ID.`), { ...at, remediation: 'Name in `negative` the build ID whose theorems prove the refusal, or the row itself (R5).' });
    }
  }

  // R3 (template/1): every ID has a test named for it. One pass over the files that may hold tests.
  const wanted = new Map(contract2 ? [] : [...registered.keys()].map((id) => [testNameOf(id), id]));
  const tested = new Set();
  if (wanted.size > 0) {
    const pattern = new RegExp(`(?<![a-z0-9])(${[...wanted.keys()].sort((a, b) => b.length - a.length).join('|')})(?![a-z0-9])`, 'g');
    for (const file of testFiles(root)) {
      let text;
      try {
        if (statSync(file).size > MAX_TEST_BYTES) continue;
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(pattern)) tested.add(wanted.get(match[1]));
      if (tested.size === wanted.size) break;
    }
  }
  const untested = contract2 ? [] : [...registered.keys()].filter((id) => !tested.has(id));
  for (const id of untested) push(new PrismCodeError('contract.untested', `The ID ${id} is registered and no test is named for it.`), { file: 'model/ids.toml', line: lineOf(idsText, id), id, remediation: `Add a test whose name ends in ${testNameOf(id)}, failing first (R3).` });

  // R1: the generated conformance document is the register's own. Under template/2, byte for byte.
  const conformance = join(root, 'CONFORMANCE.md');
  if (contract2 && ids) {
    const want = conformanceDocument(root);
    if (!existsSync(conformance) || readFileSync(conformance, 'utf8') !== want) push(new PrismCodeError('contract.conformance', 'CONFORMANCE.md is not the document the register generates.'), { file: 'CONFORMANCE.md', remediation: 'Run prism-code build, which writes it from the register; never edit CONFORMANCE.md by hand (R1).' });
  } else if (existsSync(conformance) && registered.size > 0) {
    const text = readFileSync(conformance, 'utf8');
    const missing = [...registered.keys()].filter((id) => !text.includes(`\`${id}\``));
    for (const id of missing) push(new PrismCodeError('contract.conformance', `CONFORMANCE.md does not list ${id}, which model/ids.toml registers.`), { file: 'CONFORMANCE.md', id, remediation: 'Regenerate CONFORMANCE.md from the register; never edit it by hand (R1).' });
  }

  // The universal policy (template/2): every file template.lock binds still has the label it binds.
  if (contract2) for (const drift of policyDrift(root)) push(new PrismCodeError('contract.policy-drift', drift.message), { file: drift.file, remediation: 'Restore the universal policy file; it changes only with a template release (TEMPLATE-CONTRACT.md).' });

  return {
    applies: true,
    summary: { contractRoot: forward(relative(process.cwd(), root) || '.'), spec, idsRegistered: registered.size, scenarios: found.length, authorities: cited.length, claims: claims.length, contractViolations: diagnostics.length },
    diagnostics,
  };
}

/** The register's rows, read without diagnostics: `{ spec, rows, authorities, claims }`, or null when it cannot be read. */
function registerOf(root) {
  const read = (file) => {
    const path = join(root, 'model', file);
    if (!existsSync(path)) return {};
    try {
      return parseRegister(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  };
  const ids = read('ids.toml');
  if (!ids) return null;
  const authorities = read('authorities.toml') ?? {};
  const ledger = read('ledger.toml') ?? {};
  return { spec: ids.spec ?? 'template/1', rows: Array.isArray(ids.id) ? ids.id : [], authorities: Array.isArray(authorities.authority) ? authorities.authority : [], claims: Array.isArray(ledger.claim) ? ledger.claim : [] };
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text) => '`' + cell(text) + '`';

/**
 * CONFORMANCE.md as the register generates it (template/2, R1): the IDs by suite, in the order the register first
 * names each suite, each with its level, its statement and its evidence; then the cited authorities and the ledger.
 * The same register gives the same bytes on every machine.
 */
export function conformanceDocument(root) {
  const register = registerOf(root);
  if (!register) throw new PrismCodeError('contract.register', 'model/ids.toml cannot be read, so CONFORMANCE.md cannot be generated from it.');
  const out = [
    '<!-- @generated by `prism-code build` from model/. -->',
    '<!-- Do not edit. R1: the model is the single source. -->',
    '',
    '# CONFORMANCE',
    '',
    'The conformance ID register. A `build` ID names the theorems of the model that',
    "prove it, and `prism-code check` refuses one that Lean's kernel did not prove,",
    'within its declared axioms, in the same check (R3). A failure names the exact',
    'refusal it answers, and `prism-code build` replays a vector refused with it (R5).',
    '',
    'The three honesty levels (R2):',
    '',
    '| Level | Meaning |',
    '| --- | --- |',
    '| `some-true` | A fact reproduced from an authority. **Not established here.** |',
    "| `build` | Constructed here and proved by Lean's kernel. |",
    '| `open` | Measured and reported. **Never asserted.** |',
  ];
  const suites = [];
  for (const row of register.rows) if (!suites.includes(row.suite)) suites.push(row.suite);
  for (const suite of suites) {
    out.push('', '## ' + cell(suite), '', '| ID | Level | Statement | Evidence |', '| --- | --- | --- | --- |');
    for (const row of register.rows.filter((r) => r.suite === suite)) {
      const evidence = [
        ...(Array.isArray(row.theorems) ? row.theorems.map(code) : []),
        ...(row.failure !== undefined ? ['refuses with ' + code(row.failure)] : []),
      ].join(', ');
      out.push('| ' + code(row.id) + ' | ' + code(row.level) + ' | ' + cell(row.statement) + ' | ' + evidence + ' |');
    }
  }
  out.push('', '## Cited authorities', '', 'An authority is cited, never re-derived: what it states is not claimed as established here, so the claim that reproduces it stays `some-true`.', '', '| Authority | Citation | Realized by |', '| --- | --- | --- |');
  for (const a of register.authorities) out.push('| ' + code(a.id) + ' | ' + cell(a.citation ?? a.statement) + ' | ' + (Array.isArray(a.realized_by) ? a.realized_by : []).map(code).join(', ') + ' |');
  out.push('', '## Claims that are not conformance IDs', '', '| ID | Level | Claim |', '| --- | --- | --- |');
  for (const c of register.claims) out.push('| ' + code(c.id) + ' | ' + code(c.level) + ' | ' + cell(c.statement ?? c.claim) + ' |');
  return out.join('\n') + '\n';
}

/** Whether the workspace at `root` keeps contract 2: its register says `spec = "template/2"`. */
export const isContract2 = (root) => registerOf(root)?.spec === 'template/2';

/** Write CONFORMANCE.md from the register (`build`, under contract 2). Returns the path written. */
export function writeConformance(root) {
  const path = join(root, 'CONFORMANCE.md');
  writeFileSync(path, conformanceDocument(root));
  return path;
}

/**
 * The universal policy files whose bytes are not the BLAKE3 label `template.lock` binds them to (template/2):
 * `[{ file, message }]`. A missing or unreadable lock is itself a drift: a template workspace carries one.
 */
export function policyDrift(root) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, 'template.lock'), 'utf8'));
  } catch {
    return [{ file: 'template.lock', message: 'template.lock is missing or is not JSON, so the universal policy cannot be checked.' }];
  }
  if (lock.schema !== LOCK_SCHEMA || !Array.isArray(lock.policy_files)) return [{ file: 'template.lock', message: 'template.lock is not ' + LOCK_SCHEMA + '.' }];
  const drift = [];
  for (const file of lock.policy_files) {
    const at = join(root, ...String(file.path).split('/'));
    if (!existsSync(at)) {
      drift.push({ file: file.path, message: file.path + ' is a universal policy file and is missing.' });
      continue;
    }
    const bytes = readFileSync(at);
    const label = kappa(new Uint8Array(bytes));
    if (label === file.blake3) continue;
    // A checkout that rewrote line endings changes only those bytes: say so, since the fix is the checkout, not the file.
    const lf = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    if (lf.length !== bytes.length && kappa(new Uint8Array(lf)) === file.blake3) drift.push({ file: file.path, message: file.path + ' has CRLF line endings, and template.lock binds its LF bytes: a checkout rewrote them. Keep every file as committed (.gitattributes: * -text, or core.autocrlf false).' });
    else drift.push({ file: file.path, message: file.path + ' has the label ' + label + ', and template.lock binds it to ' + file.blake3 + '.' });
  }
  return drift;
}

/**
 * R3 under template/2, after the kernel has judged the model: every theorem a build row names must be stated by the
 * model and proved within its declared axioms. `proved` maps each theorem's qualified name (Module.name) to the
 * kernel's row `{ theorem, status, axioms }`; a status that starts with "proved" is proved. Returns `{ diagnostics }`.
 */
export function checkTheorems(root, proved) {
  const diagnostics = [];
  const register = root ? registerOf(root) : null;
  if (!register || register.spec !== 'template/2') return { diagnostics };
  const idsText = readFileSync(join(root, 'model', 'ids.toml'), 'utf8');
  for (const row of register.rows) {
    for (const name of Array.isArray(row.theorems) ? row.theorems : []) {
      const at = { file: 'model/ids.toml', line: lineOf(idsText, row.id), id: row.id };
      const judged = proved.get(name);
      if (!judged) diagnostics.push({ ...coded(new PrismCodeError('contract.theorem-unstated', 'The ID ' + row.id + ' names the theorem ' + name + ', which the model does not state.')), ...at, remediation: 'Name the theorem as Module.name, as the model states it, or state it in app/src (R3).' });
      else if (!String(judged.status).startsWith('proved')) diagnostics.push({ ...coded(new PrismCodeError('contract.theorem-unproved', 'The ID ' + row.id + ' names the theorem ' + name + ", which Lean's kernel did not prove: " + judged.status + '.')), ...at, remediation: 'Repair the definition or the proof; never weaken the theorem to make it pass (R3).' });
    }
  }
  return { diagnostics };
}

/**
 * R5 under template/2, after the build has replayed the acceptance vectors: every row with `failure` needs at least
 * one replayed vector whose response is exactly the failure's text. `vectors` is `[{ request, response }]` as bytes.
 * Returns `{ diagnostics }`.
 */
export function checkRefusals(root, vectors) {
  const diagnostics = [];
  const register = root ? registerOf(root) : null;
  if (!register || register.spec !== 'template/2') return { diagnostics };
  const idsText = readFileSync(join(root, 'model', 'ids.toml'), 'utf8');
  const responses = new Set(vectors.map((v) => Buffer.from(v.response).toString('hex')));
  for (const row of register.rows) {
    if (typeof row.failure !== 'string' || row.failure === '') continue;
    if (!responses.has(Buffer.from(row.failure, 'utf8').toString('hex'))) diagnostics.push({ ...coded(new PrismCodeError('contract.refusal-unreplayed', 'The ID ' + row.id + ' declares the failure ' + JSON.stringify(row.failure) + ', and no replayed acceptance vector is refused with it.')), file: 'model/ids.toml', line: lineOf(idsText, row.id), id: row.id, remediation: 'Add an acceptance vector whose request the app refuses with exactly that response (R5).' });
  }
  return { diagnostics };
}

/** How many lexicon entries a project binds: the entry files under `language/<lexicon>/entries/`. */
export function lexiconEntries(projectDir) {
  const language = join(projectDir, 'language');
  if (!existsSync(language)) return 0;
  let count = 0;
  for (const lexicon of readdirSync(language, { withFileTypes: true })) {
    if (!lexicon.isDirectory()) continue;
    const entries = join(language, lexicon.name, 'entries');
    if (existsSync(entries)) count += readdirSync(entries).filter((n) => n.endsWith('.toml')).length;
  }
  return count;
}
