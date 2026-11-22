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
 * R4 (no stub, no undeclared axiom) and R6 (locked imports) are LexLean's and the kernel's, in `check` itself. R5
 * (every typed failure has a rejecting example) is `build`'s and `verify`'s, through the acceptance vectors. A
 * workspace with no `model/ids.toml` is not a template workspace, and nothing here runs.
 *
 * Reads files and nothing else. Returns `{ applies, summary, diagnostics }`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PrismCodeError } from './errors.mjs';

export const LEVELS = Object.freeze(['some-true', 'build', 'open']);

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

  // R3: every ID has a test named for it. One pass over the files that may hold tests.
  const wanted = new Map([...registered.keys()].map((id) => [testNameOf(id), id]));
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
  const untested = [...registered.keys()].filter((id) => !tested.has(id));
  for (const id of untested) push(new PrismCodeError('contract.untested', `The ID ${id} is registered and no test is named for it.`), { file: 'model/ids.toml', line: lineOf(idsText, id), id, remediation: `Add a test whose name ends in ${testNameOf(id)}, failing first (R3).` });

  // R1: the generated conformance document lists every ID the register holds.
  const conformance = join(root, 'CONFORMANCE.md');
  if (existsSync(conformance) && registered.size > 0) {
    const text = readFileSync(conformance, 'utf8');
    const missing = [...registered.keys()].filter((id) => !text.includes(`\`${id}\``));
    for (const id of missing) push(new PrismCodeError('contract.conformance', `CONFORMANCE.md does not list ${id}, which model/ids.toml registers.`), { file: 'CONFORMANCE.md', id, remediation: 'Regenerate CONFORMANCE.md from the register; never edit it by hand (R1).' });
  }

  return {
    applies: true,
    summary: { contractRoot: forward(relative(process.cwd(), root) || '.'), idsRegistered: registered.size, scenarios: found.length, authorities: cited.length, claims: claims.length, contractViolations: diagnostics.length },
    diagnostics,
  };
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
