/**
 * Skills as Prism apps: every skill setup installs is admitted by a LexLean model, the skill gate
 * (skill/gate/src/SkillGate.lex.tex), whose theorems Lean's kernel proves in this process before anything is written.
 *
 * The gate decides `installs` from fifteen facts. Each fact is computed here from the bytes and the code, never
 * declared by the skill:
 *
 *   markdownNamed / markdownRendered   the BLAKE3 label of SKILL.md, and the label skill/skills.json pins for it
 *   modelNamed / modelPinned           the label of the gate model's sources, and the pinned one
 *   commandsNamed / commandsShipped    every `prism-code <verb>` the skill names, and how many this CLI's --help has
 *   toolsNamed / toolsServed           every `prism_<tool>` the skill names, and how many the MCP server answers
 *   network                            URLs to hosts outside the skill's own sites
 *   secrets                            strings shaped like a credential
 *   execution                          files in the skill folder that are not text the agent reads
 *   sendsWithoutOptIn                  1 when the front end, with nothing set and no LexLean here, would send a model
 *   proofNeedsDocker                   1 when the prover, with nothing set, is anything but Lean's kernel here
 *   theoremsDeclared / theoremsProved  the gate's theorems, and how many Lean's kernel proved just now
 *
 * `installs` below is the model's own definition, written out; test/skills.test.mjs holds it to every theorem.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kappa } from './blake3.mjs';
import { PrismCodeError } from './errors.mjs';

const SKILL_DIR = fileURLToPath(new URL('../skill/', import.meta.url));
export const GATE_DIR = join(SKILL_DIR, 'gate');
const BIN = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
export const RECEIPT_SCHEMA = 'prism/skill-receipt/1';

/** The pins: { skills: { <name>: { markdown: κ } }, gate: κ }, written by `node sdk/docs/skill.mjs`. */
export const readPins = (dir = SKILL_DIR) => JSON.parse(readFileSync(join(dir, 'skills.json'), 'utf8'));

/** Hosts a skill may point at: Prism's own sites and the registries it installs from. */
export const SKILL_HOSTS = Object.freeze(['github.com', 'universal-coordinate-foundation.lovable.app', 'www.npmjs.com', 'docs.anthropic.com', 'claude.ai', 'chatgpt.com', 'cursor.com', 'code.visualstudio.com']);
const SECRET = /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const TEXT = /\.(md|json|toml|lock|tex)$/;

const files = (dir, at = dir) => readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, join(at, e.name)) : [relative(dir, join(at, e.name)).split(sep).join('/')]));

/** The label of the gate model: its project files and sources, in path order, each framed by its path and length. */
export function modelLabel(dir = GATE_DIR) {
  const paths = files(dir).filter((p) => !p.startsWith('.lexlean/') && !p.startsWith('.lake/')).sort();
  const parts = [];
  for (const p of paths) {
    const bytes = readFileSync(join(dir, p));
    parts.push(Buffer.from(`${p}\n${bytes.length}\n`), bytes);
  }
  return kappa(new Uint8Array(Buffer.concat(parts)));
}

/** The verbs this CLI ships, read from its own --help. */
export function shippedVerbs({ run = spawnSync } = {}) {
  const r = run(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  return new Set([...String(r.stdout).matchAll(/^\s+prism-code ([a-z][a-z-]*)/gm)].map((m) => m[1]));
}

/** The markdown's code: fenced blocks and inline code spans, where a command is taught. */
const codeOf = (markdown) => [...markdown.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join('\n');

/** Every distinct `prism-code <verb>` the markdown teaches in its code. */
export const namedVerbs = (markdown) => new Set([...codeOf(markdown).matchAll(/prism-code(?:@[\w.]+)? ([a-z][a-z-]*)/g)].map((m) => m[1]));

/** Every distinct `prism_<tool>` the markdown teaches in its code. */
export const namedTools = (markdown) => new Set([...codeOf(markdown).matchAll(/(?<![\w-])prism_[a-z]+(?![\w-])/g)].map((m) => m[0]));

/** The tools prism-code serves: none. It has no server, so a skill that names a `prism_<tool>` names one that is not there. */
export async function servedTools() {
  return new Set();
}

/**
 * `prism-code skill --out <dir>`: copy the skill this package ships, SKILL.md and its references, into `dir`.
 * Reads only the package and reaches no network. Returns `{ directory, files }`.
 */
export function copySkill(directory, { from = SKILL_DIR } = {}) {
  const shipped = files(from).filter((p) => p === 'SKILL.md' || p.startsWith('references/')).sort();
  for (const p of shipped) {
    mkdirSync(dirname(join(directory, p)), { recursive: true });
    writeFileSync(join(directory, p), readFileSync(join(from, p)));
  }
  return { directory, files: shipped };
}

/** The facts about the folder itself: links outside the skill's hosts, credential-shaped strings, non-text files. */
export function folderFacts(markdown, extraFiles = []) {
  // A loopback address (the dev server on this machine) never leaves it, so it is no network authority.
  const hosts = [...markdown.matchAll(/https?:\/\/([^/\s)`'"<>]+)/g)].map((m) => m[1].toLowerCase().replace(/:\d+$/, ''));
  const loopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  return {
    network: hosts.filter((h) => !SKILL_HOSTS.includes(h) && !loopback(h)).length,
    secrets: [...markdown.matchAll(SECRET)].length,
    execution: extraFiles.filter((f) => !TEXT.test(f)).length,
  };
}

/** Whether proving or checking would send a model, or need Docker, with nothing set: read from the routing itself. */
export async function routingFacts() {
  const { frontendWhere, proverWhere } = await import('./journey/frontend.mjs');
  let sends = 0;
  try {
    if (frontendWhere({ env: {}, hasWasm: () => false }) === 'hosted') sends = 1;
  } catch (error) {
    if (error.code !== 'build.frontend-unavailable') throw error;
  }
  return { sendsWithoutOptIn: sends, proofNeedsDocker: proverWhere({ env: {} }) === 'kernel' ? 0 : 1 };
}

/** The model's `canonical`, `namesOnlyShipped`, `noAuthority`, `staysLocal`, `selfProved` and `installs`, written out. */
export function installs(s) {
  const canonical = s.markdownNamed === s.markdownRendered && s.modelNamed === s.modelPinned;
  const namesOnlyShipped = s.commandsShipped === s.commandsNamed && s.toolsServed === s.toolsNamed;
  const noAuthority = s.network === 0 && s.secrets === 0 && s.execution === 0;
  const staysLocal = s.sendsWithoutOptIn === 0 && s.proofNeedsDocker === 0;
  const selfProved = s.theoremsDeclared > 0 && s.theoremsProved === s.theoremsDeclared;
  return canonical && namesOnlyShipped && noAuthority && staysLocal && selfProved;
}

/** Which of the gate's conditions a record fails, by the theorem that names it. */
export function failing(s) {
  const out = [];
  if (s.markdownNamed !== s.markdownRendered) out.push('aSkillInstallsOnlyAsTheBytesItsModelRenders');
  if (s.modelNamed !== s.modelPinned) out.push('aSkillInstallsOnlyUnderItsPinnedModel');
  if (s.commandsShipped !== s.commandsNamed) out.push('aSkillInstallsOnlyWhenEveryCommandItTeachesShips');
  if (s.toolsServed !== s.toolsNamed) out.push('aSkillInstallsOnlyWhenEveryToolItTeachesIsServed');
  if (s.network !== 0) out.push('aSkillInstallsOnlyWithoutNetworkAuthority');
  if (s.secrets !== 0) out.push('aSkillInstallsOnlyWithoutSecrets');
  if (s.execution !== 0) out.push('aSkillInstallsOnlyWithoutExecutionAuthority');
  if (s.sendsWithoutOptIn !== 0) out.push('aSkillInstallsOnlyWhenItSendsNothingUnasked');
  if (s.proofNeedsDocker !== 0) out.push('aSkillInstallsOnlyWhenItProvesWithoutDocker');
  if (s.theoremsDeclared === 0) out.push('aSkillInstallsOnlyWhenItDeclaresATheorem');
  if (s.theoremsProved !== s.theoremsDeclared) out.push('aSkillInstallsOnlyWhenEveryTheoremItDeclaresIsProved');
  return out;
}

/** Proves the gate model with Lean's kernel in this process. Resolves { declared, proved, theorems, seconds } or throws skill.unproved. */
export async function proveGate({ env = process.env, dir = GATE_DIR, prove = null, log = () => {} } = {}) {
  const run = prove ?? (await import('./journey/engine.mjs')).prove;
  const r = await run(dir, { starter: null, status: {} }, { env: { ...env, PRISM_CODE_TIER: env.PRISM_CODE_TIER === 'hosted' ? undefined : env.PRISM_CODE_TIER }, log });
  const theorems = r.theorems ?? [];
  if (!theorems.length) throw new PrismCodeError('skill.unproved', `Lean's kernel could not judge the skill gate: ${r.message ?? r.code}`);
  return { declared: theorems.length, proved: theorems.filter((t) => t.status.startsWith('proved')).length, theorems: theorems.map((t) => t.theorem), seconds: r.seconds };
}

/**
 * The gate's verdict on one skill's markdown (and any other files its folder holds). Resolves
 * { name, admitted, facts, failing, receipt } and never writes anything.
 */
export async function judgeSkill({ name, markdown, extraFiles = [], pins = readPins(), gate = null, verbs = null, tools = null, routing = null, env = process.env, log = () => {} }) {
  const shipped = verbs ?? shippedVerbs();
  const named = [...namedVerbs(markdown)];
  const served = tools ?? (await servedTools());
  const toolsTaught = [...namedTools(markdown)];
  const proof = gate ?? (await proveGate({ env, log }));
  const facts = {
    markdownNamed: kappa(new TextEncoder().encode(markdown)),
    markdownRendered: pins.skills?.[name]?.markdown ?? null,
    modelNamed: modelLabel(),
    modelPinned: pins.gate ?? null,
    commandsNamed: named.length,
    commandsShipped: named.filter((v) => shipped.has(v)).length,
    toolsNamed: toolsTaught.length,
    toolsServed: toolsTaught.filter((t) => served.has(t)).length,
    ...folderFacts(markdown, extraFiles),
    ...(routing ?? (await routingFacts())),
    theoremsDeclared: proof.declared,
    theoremsProved: proof.proved,
  };
  const admitted = installs(facts);
  const unshipped = [...named.filter((v) => !shipped.has(v)), ...toolsTaught.filter((t) => !served.has(t))];
  return {
    name,
    admitted,
    facts,
    failing: failing(facts),
    unshipped,
    receipt: { schema: RECEIPT_SCHEMA, skill: name, markdown: facts.markdownNamed, gate: facts.modelNamed, theorems: proof.theorems, admitted },
  };
}

/** A skill folder as installed: its SKILL.md, the other files in it, and its receipt if any. */
export function readInstalled(dir) {
  if (!existsSync(join(dir, 'SKILL.md'))) throw new PrismCodeError('skill.missing', `${dir} holds no SKILL.md`);
  const all = files(dir).filter((p) => statSync(join(dir, p)).isFile());
  return { markdown: readFileSync(join(dir, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'), extraFiles: all.filter((p) => p !== 'SKILL.md') };
}

/**
 * The bundled skills setup may install, each judged by the gate first: { skills: [...admitted, each with its receipt
 * and BLAKE3 label], refused: [{ name, failing, unshipped }] }. A gate Lean's kernel cannot prove admits nothing.
 */
export async function admitSkills(fetched, { env = process.env, log = () => {}, judge = judgeSkill, prove = proveGate } = {}) {
  if (fetched.error) return fetched;
  let gate;
  try {
    gate = await prove({ env, log });
  } catch (error) {
    return { skills: [], refused: fetched.skills.map((s) => ({ name: s.name, failing: [], reason: `${error.code ?? 'skill.unproved'}: ${error.message}` })) };
  }
  const skills = [];
  const refused = [];
  for (const skill of fetched.skills) {
    const verdict = await judge({ name: skill.name, markdown: skill.markdown, gate, env, log });
    if (verdict.admitted) skills.push({ ...skill, digest: verdict.facts.markdownNamed, receipt: verdict.receipt });
    else refused.push({ name: skill.name, failing: verdict.failing, unshipped: verdict.unshipped });
  }
  return { skills, refused };
}

/** Where setup installs skills, for `skill verify` with no folder named. */
export function installedSkillDirs({ env = process.env, home = homedir(), name = 'prism' } = {}) {
  return [join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills', name), join(home, '.agents', 'skills', name)].filter((d) => existsSync(join(d, 'SKILL.md')));
}

/**
 * `prism-code skill verify`: an installed skill judged again by the gate, Lean's kernel proving the gate's theorems
 * here, now. Its receipt, when setup wrote one, must name the bytes that are there. Resolves the verdict and the lines.
 */
export async function verifyInstalled(dir, { env = process.env, log = () => {} } = {}) {
  const name = basename(dir);
  const { markdown, extraFiles } = readInstalled(dir);
  const verdict = await judgeSkill({ name, markdown, extraFiles, env, log });
  let marker = null;
  try {
    marker = JSON.parse(readFileSync(join(dir, '.prism-code.json'), 'utf8'));
  } catch {
    // A skill not written by setup has no receipt.
  }
  const receiptHolds = !marker?.receipt || (marker.receipt.markdown === verdict.facts.markdownNamed && marker.receipt.gate === verdict.facts.modelNamed);
  const ok = verdict.admitted && receiptHolds;
  const f = verdict.facts;
  const lines = [
    `${ok ? 'verified' : 'refused '} ${name} at ${dir}`,
    `  SKILL.md         ${f.markdownNamed}${f.markdownNamed === f.markdownRendered ? ', the label prism-code pins' : `, not the pinned ${f.markdownRendered}`}`,
    `  skill gate       ${f.modelNamed}${f.modelNamed === f.modelPinned ? ', pinned' : `, not the pinned ${f.modelPinned}`}; Lean's kernel proved ${f.theoremsProved} of ${f.theoremsDeclared} theorems here`,
    `  commands         ${f.commandsShipped} of ${f.commandsNamed} it names ship in this prism-code${verdict.unshipped.length ? ` (not: ${verdict.unshipped.join(', ')})` : ''}`,
    `  tools            ${f.toolsServed} of ${f.toolsNamed} it names are served; prism-code serves none`,
    `  authority        network ${f.network}, secrets ${f.secrets}, execution ${f.execution}`,
    `  routing          sends unasked ${f.sendsWithoutOptIn}, proof needs Docker ${f.proofNeedsDocker}`,
    ...(marker?.receipt && !receiptHolds ? ['  receipt          names other bytes than are installed'] : []),
    ...verdict.failing.map((t) => `  fails            ${t}`),
  ];
  return { ok, verdict, lines };
}
