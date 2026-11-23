/**
 * The model verbs, each in this process: `check`, `build` and `verify` of a project's LexLean model.
 *
 *   check [<dir>]     prism.toml, the template contract's ratchet when the workspace has its registers
 *                     (contract.mjs), then LexLean as WebAssembly checks the model, then Lean's kernel, as
 *                     WebAssembly, proves every theorem. Writes nothing in the project.
 *   build [<dir>]     check, then the app is written under <project>/.prism/build, with nothing compiled.
 *   verify <target>   a holo: its digests, its world within the grant, and every acceptance vector replayed
 *                     on a fresh instance; then, from the holo alone, Lean's kernel proves again every theorem
 *                     of the snapshot it carries and LexLean reads again the sources it carries
 *                     (journey/proof-record.mjs). The summary says each apart, never as one answer: `sealed`,
 *                     `vectors`, `reproved` and `sources`. A project: check again, then the same for what
 *                     `build` wrote, which must be the build of the model as it is on disk.
 *
 * No step starts another program, and nothing about the model is sent anywhere (journey/engine.mjs).
 *
 * Every verb answers one report, `prism/report/1`:
 *
 *   { ok, command, durationMs, summary, diagnostics: [{ code, severity, file, line, column, message, remediation }] }
 *
 * Exit codes: 0 the gate passed; 1 a theorem is not proved, a vector fails or a digest does not match; 2 the
 * manifest fails its checks or the model does not check (it does not parse, link or elaborate). A contract
 * violation is exit 1.
 */
import { holospaceOf } from './holospace-link.mjs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PrismCodeError, PrismError } from './errors.mjs';
import { lexleanProjectDir } from './tiers.mjs';
import { checkContract, checkRefusals, checkTheorems, contractRoot, isContract2, lexiconEntries, writeConformance } from './contract.mjs';
import { readSession, sourceDigest, sourceFiles, writeSession } from './journey/project.mjs';
import { proofRemedy, theoremPlace } from './journey/proof-hints.mjs';

export const REPORT_SCHEMA = 'prism/report/1';
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, REFUSED: 2 });

const forward = (path) => path.split('\\').join('/');

/** A report code of this module's own, written as an error so that it is registered like every code prism-code raises. */
const coded = (error) => ({ code: error.code, message: error.message });

/**
 * One diagnostic of the report. `at` is `file:line:column`, as the engine anchors a diagnostic, or `file:line`, as a
 * hint names the line a quoted name is written on (hints.mjs): then the column is null, and the place is still given.
 */
function diagnostic({ code, message, at = null, file = null, line = null, remediation = null, severity = 'error' }) {
  const m = at ? /^(.*?):(\d+)(?::(\d+))?$/.exec(at) : null;
  return {
    code: code ?? new PrismCodeError('report.uncoded', '').code,
    severity,
    file: m ? forward(m[1]) : file,
    line: m ? Number(m[2]) : line,
    column: m?.[3] ? Number(m[3]) : null,
    message: String(message ?? ''),
    remediation,
  };
}

/** The model's sources under `dir`, as `[path, text]` pairs, for proof-hints.mjs; none without a folder. */
const modelTexts = (dir) => (dir ? sourceFiles(dir).map((file) => [file, readFileSync(join(dir, file), 'utf8')]) : []);

/** The diagnostics of one engine step: each of its own, or the step's message when it names none. `dir` is the model's folder. */
function stepDiagnostics(result, fallback, dir = null) {
  // A title is a phrase of a lexicon the module uses, never free text: say so, since the diagnostic names only the word.
  // A stale lock names a command prism-code does not ship; this one does the same, and LexLean checks what it writes.
  const relock = (d) => (d.code === 'LLC0102' ? 'Run prism-code lock: it writes lexlean.lock again for the project as it is, and LexLean checks it. Never edit the lock by hand.' : null);
  const titled = (d) => (/^\\title\{/.test(d.line ?? '') ? 'A \\title is a phrase a lexicon of the module defines (language/*/entries), not free text. Keep the title the module had, or add the phrase as a lexicon entry.' : null);
  const own = (result.diagnostics ?? []).map((d) => diagnostic({ code: d.code, message: d.message, at: d.at, remediation: relock(d) ?? titled(d) ?? (d.didYouMean?.length ? `Write ${d.didYouMean.map((n) => `\`${n}\``).join(' or ')} instead.` : null) }));
  if (own.length > 0) {
    if (own[0].remediation === null) own[0].remediation = result.message ?? null;
    return own;
  }
  const missed = (result.theorems ?? []).filter((t) => !t.status.startsWith('proved'));
  const texts = missed.length > 0 ? modelTexts(dir) : [];
  if (missed.length > 0) return missed.map((t) => diagnostic({ ...coded(new PrismCodeError('proof.rejected', `${t.theorem}: ${t.status}`)), ...theoremPlace(texts, t.theorem), remediation: proofRemedy(String(t.status)) }));
  return [diagnostic({ code: result.code ?? fallback.code, message: result.message, remediation: result.next ?? null })];
}

/** The project: its root, the folder of its LexLean model, and the manifest when it has one. */
async function openProject(path, explicit) {
  const { readManifest } = await import('./node.mjs');
  const root = resolve(path ?? '.');
  const diagnostics = [];
  let manifest = null;
  let refused = false;
  if (existsSync(join(root, 'prism.toml'))) {
    try {
      const read = await readManifest(root);
      manifest = read.manifest;
      for (const w of read.warnings) diagnostics.push(diagnostic({ code: w.rule, message: w.message, file: 'prism.toml', severity: 'warning' }));
    } catch (error) {
      if (!(error instanceof PrismError)) throw error;
      diagnostics.push(diagnostic({ code: error.code, message: error.message, file: 'prism.toml', remediation: 'Fix prism.toml; it is deny by default and holds no secret.' }));
      refused = true;
    }
  }
  let dir = null;
  if (!refused) {
    try {
      dir = resolve(root, lexleanProjectDir(root, manifest?.model?.source ?? null, explicit ?? null));
    } catch (error) {
      if (!(error instanceof PrismError)) throw error;
      diagnostics.push(diagnostic({ code: error.code, message: error.message, remediation: 'Run prism-code init <dir> to scaffold a project, or name the model with --project <dir>.' }));
      refused = true;
    }
  }
  return { root, dir, manifest, diagnostics, refused };
}

const report = (command, started, ok, summary, diagnostics) => ({ schema: REPORT_SCHEMA, ok, command, durationMs: Date.now() - started, summary, diagnostics });
const answer = (command, started, code, summary, diagnostics) => ({ code, report: report(command, started, code === EXIT.OK, summary, diagnostics) });

/** The acceptance vectors the model states, `[{ request, response }]` as bytes, from its semantic snapshot; none when it states no text application. */
async function statedVectors(dir, env) {
  const { wasmSnapshot } = await import('./journey/lexlean-wasm.mjs');
  const { modelProgram } = await import('./journey/model-eval.mjs');
  const taken = await wasmSnapshot(dir, { env });
  if (!taken.ok) return [];
  try {
    return modelProgram(taken.snapshot).application.acceptanceVectors;
  } catch {
    return [];
  }
}

/** Check then prove, on `session`. Resolves `{ code, summary, diagnostics }`; `code` is null when both passed. */
async function gate(project, session, { env, log, engine, write = false }) {
  const { check, prove } = engine ?? (await import('./journey/engine.mjs'));
  const summary = { modulesChecked: sourceFiles(project.dir).length, lexiconEntriesBound: lexiconEntries(project.dir), theoremsDeclared: 0, theoremsVerified: 0, contractViolations: 0 };
  const diagnostics = [...project.diagnostics];
  // The template contract's ratchet (contract.mjs), when this is a template workspace: the project's own folder, its
  // root, or the folder above the model. Its violations are reported with the model's, and fail the gate with exit 1.
  const root = contractRoot(project.root, project.dir, dirname(project.dir));
  // `build` (template/2): CONFORMANCE.md is the register's generation, so build writes it before R1 judges it, as it
  // writes the app; `check` writes nothing and only compares.
  if (write && root && isContract2(root)) {
    try {
      writeConformance(root);
    } catch (error) {
      if (!(error instanceof PrismCodeError)) throw error;
    }
  }
  const contract = checkContract(root);
  const contractDiagnostic = (d) => ({ ...diagnostic({ code: d.code, message: d.message, file: d.file, remediation: d.remediation }), line: d.line, id: d.id ?? null });
  if (contract.applies) {
    Object.assign(summary, contract.summary);
    for (const d of contract.diagnostics) diagnostics.push(contractDiagnostic(d));
  }
  const checked = await check(project.dir, session, { env, log });
  if (!checked.ok) return { code: EXIT.REFUSED, summary, diagnostics: [...diagnostics, ...stepDiagnostics(checked, new PrismCodeError('model.unchecked', ''), project.dir)] };
  const proved = await prove(project.dir, session, { env, log });
  const judged = proved.theorems ?? proved.guarantees ?? [];
  summary.theoremsDeclared = judged.length;
  summary.theoremsVerified = proved.ok ? judged.length : judged.filter((t) => String(t.status).startsWith('proved')).length;
  // R3 (template/2): every theorem a build ID names is stated by the model and proved, in this same check.
  if (contract.applies) {
    const named = checkTheorems(root, new Map(judged.filter((t) => t.qualified).map((t) => [t.qualified, t])));
    for (const d of named.diagnostics) diagnostics.push(contractDiagnostic(d));
    summary.contractViolations += named.diagnostics.length;
    // R5 (template/2): every registered failure is the response of an acceptance vector the model states. build
    // replays every one of them, and refuses a build whose app answers one otherwise.
    // Only contract 2 registers failures; a template/1 workspace takes no second snapshot.
    const refused = isContract2(root) ? checkRefusals(root, await statedVectors(project.dir, env)) : { diagnostics: [] };
    for (const d of refused.diagnostics) diagnostics.push(contractDiagnostic(d));
    summary.contractViolations += refused.diagnostics.length;
  }
  if (!proved.ok) return { code: EXIT.FAILED, summary, root, diagnostics: [...diagnostics, ...stepDiagnostics(proved, new PrismCodeError('proof.rejected', ''), project.dir)] };
  if (summary.contractViolations > 0) return { code: EXIT.FAILED, summary, root, diagnostics };
  return { code: null, summary, root, diagnostics };
}

/** `check`: the model checks and every theorem is proved. Writes nothing in the project. */
export async function modelCheck(path, { project: explicit = null, env = process.env, log = () => {}, engine = null } = {}) {
  const started = Date.now();
  const project = await openProject(path, explicit);
  if (project.refused) return answer('check', started, EXIT.REFUSED, {}, project.diagnostics);
  const gated = await gate(project, readSession(project.dir), { env, log, engine });
  return answer('check', started, gated.code ?? EXIT.OK, gated.summary, gated.diagnostics);
}

/**
 * `lock`: write the project's lexlean.lock again after the project changed, or with `check` only say whether it is
 * current. The lock is proposed here (journey/relock.mjs) and judged by LexLean, which checks it byte for byte as
 * `lexlean lock --check`: nothing is written unless LexLean accepts it as the lock it would have written itself.
 */
export async function modelLock(path, { project: explicit = null, check = false, env = process.env } = {}) {
  const started = Date.now();
  const project = await openProject(path, explicit);
  if (project.refused) return answer('lock', started, EXIT.REFUSED, {}, project.diagnostics);
  const { lockCandidate } = await import('./journey/relock.mjs');
  const { projectFiles, runLexleanWasm } = await import('./journey/lexlean-wasm.mjs');
  let candidate;
  try {
    candidate = lockCandidate(projectFiles(project.dir));
  } catch (error) {
    if (!(error instanceof PrismCodeError)) throw error;
    return answer('lock', started, EXIT.REFUSED, {}, [...project.diagnostics, diagnostic({ code: error.code, message: error.message, file: 'lexlean.toml', remediation: 'Change what the message names, then run prism-code lock again; never edit the lock by hand.' })]);
  }
  const file = join(project.dir, candidate.lockfile);
  const held = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const summary = { lockfile: forward(relative(process.cwd(), file) || file), current: held === candidate.text, written: false, packages: (candidate.text.match(/^\[\[package\]\]$/gm) ?? []).length };
  if (!summary.current && check) {
    return answer('lock', started, EXIT.FAILED, summary, [...project.diagnostics, diagnostic({ ...coded(new PrismCodeError('lock.stale', `${candidate.lockfile} is not the lock of the project as it is: lexlean.toml, a workspace file or a lexicon changed since it was written.`)), file: summary.lockfile, remediation: 'Run prism-code lock, which writes it again and has LexLean check it.' })]);
  }
  // LexLean is the judge of a lock, the one on disk as much as one proposed here.
  const judged = await runLexleanWasm(project.dir, ['--diagnostic-format', 'json', 'lock', '--check'], { env, files: [[`/${candidate.lockfile}`, new TextEncoder().encode(candidate.text)]] });
  if (judged.exit !== 0) {
    let said = [];
    try {
      said = JSON.parse(judged.stdout.toString()).diagnostics ?? [];
    } catch {
      // LexLean gave no command result; its exit code is the answer.
    }
    const why = said.map((d) => `${d.code}: ${d.message}`).join('; ') || `LexLean exited ${judged.exit}`;
    return answer('lock', started, EXIT.REFUSED, summary, [...project.diagnostics, diagnostic({ ...coded(new PrismCodeError('lock.refused', `LexLean does not accept the lock this command would write (${why}), so nothing was written.`)), file: summary.lockfile, remediation: 'The project needs something this command does not lock; the message says what LexLean found.' })]);
  }
  if (!summary.current) {
    writeFileSync(file, candidate.text);
    summary.written = true;
  }
  return answer('lock', started, EXIT.OK, summary, project.diagnostics);
}

/** What a build wrote, from the session: `{ kind, path, source }`, or null. */
function builtOf(session) {
  const holo = session.status.built;
  if (holo?.path) return { kind: 'holo', path: holo.path, source: holo.source, address: holo.address };
  const rule = session.status.ruleApp;
  if (rule?.path) return { kind: 'rule-app', path: rule.path, source: session.status.lastBuild?.source ?? session.status.kernelChecked?.source ?? null, address: rule.address };
  return null;
}

/** `{ holospace }` for a built holo: the link to its own holospace and the file that page asks for; else nothing. */
function holospaceMember(built, file) {
  const holospace = built.holo ? holospaceOf(built.address, file) : null;
  return holospace ? { holospace } : {};
}

/**
 * `build`: check, then write the app. `out` also copies what was written into that folder. A holo carries the
 * files that decide its model unless `sources` is false (`--no-sources`).
 */
export async function modelBuild(path, { project: explicit = null, out = null, sources = true, env = process.env, log = () => {}, engine = null } = {}) {
  const started = Date.now();
  const project = await openProject(path, explicit);
  if (project.refused) return answer('build', started, EXIT.REFUSED, {}, project.diagnostics);
  const session = readSession(project.dir);
  const gated = await gate(project, session, { env, log, engine, write: true });
  if (gated.code !== null) return answer('build', started, gated.code, gated.summary, gated.diagnostics);
  const { build } = engine ?? (await import('./journey/engine.mjs'));
  const built = await build(project.dir, session, { env, log, sources, root: project.root });
  if (built.ok) session.status.lastBuild = { source: sourceDigest(project.dir), result: { ok: true, address: built.address } };
  writeSession(project.dir, session);
  const summary = { ...gated.summary, vectorsPassed: built.vectors?.passed ?? 0, vectorsTotal: built.vectors?.total ?? 0, ...(built.carries ? { carries: built.carries } : {}) };
  if (!built.ok) return answer('build', started, EXIT.FAILED, summary, [...gated.diagnostics, ...stepDiagnostics(built, new PrismCodeError('build.failed', ''))]);
  const written = built.holo ?? built.app;
  let artifact = written;
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    artifact = join(resolve(out), basename(written));
    copyFileSync(written, artifact);
  }
  return answer('build', started, EXIT.OK, { ...summary, ...holospaceMember(built, forward(relative(process.cwd(), artifact) || artifact)), artifact: forward(relative(process.cwd(), artifact) || artifact), address: built.address, bytes: built.bytes ?? statSync(written).size, site: built.site ? forward(relative(process.cwd(), built.site) || built.site) : null }, gated.diagnostics);
}

/**
 * What `build` last wrote for the project, when it is still the build of the model as it is on disk: `{ kind, path,
 * address }`, or null when nothing is built, the sources changed since, or that build did not pass. `run` of a
 * project uses it to skip a build that would write the same bytes.
 */
export async function modelBuilt(path, { project: explicit = null } = {}) {
  const project = await openProject(path, explicit);
  if (project.refused) return null;
  const session = readSession(project.dir);
  const built = builtOf(session);
  if (!built || !built.address || !existsSync(built.path)) return null;
  const last = session.status.lastBuild;
  if (last?.result?.ok !== true || last.result.address !== built.address) return null;
  const source = sourceDigest(project.dir);
  if (built.source !== source || last.source !== source) return null;
  return { kind: built.kind, path: built.path, address: built.address };
}

/**
 * Load what was built and replay every acceptance vector on a fresh instance; for a holo, then prove it again
 * and read its sources again, from the holo alone. Resolves `{ summary, diagnostics, code }`.
 *
 * The summary's members are separate answers: `sealed` (the holo's bytes are the ones it names), `vectors` (it
 * answers its own examples), `reproved` (Lean's kernel just accepted a proof of every theorem its snapshot
 * states) and `sources` (LexLean, on the sources it carries, writes that snapshot). A holo that carries no proof
 * record or no sources reports that, and it fails only a policy that requires the claim; a record or sources
 * that are carried and do not hold fail the verification.
 */
async function replay(kind, path, { policy = null, env = process.env, log = () => {} } = {}) {
  const summary = { artifact: forward(relative(process.cwd(), path) || path), identitiesVerified: false, vectorsPassed: 0, vectorsTotal: 0 };
  const diagnostics = [];
  let app;
  let acceptance;
  try {
    if (kind === 'rule-app') {
      const { loadRuleApp } = await import('./journey/rule-app.mjs');
      app = await loadRuleApp(readFileSync(path));
      summary.identitiesVerified = true;
    } else {
      const { fromFile } = await import('./node.mjs');
      app = await fromFile(path);
      summary.identitiesVerified = app.identities.verified === true;
    }
    acceptance = await app.acceptance();
  } catch (error) {
    if (!(error instanceof PrismError) && !error.code) throw error;
    return { code: EXIT.FAILED, summary, diagnostics: [diagnostic({ code: error.check ?? error.code, message: error.message, file: summary.artifact, remediation: 'The artifact is refused as it is. Build it again from the model; never edit its bytes.' })] };
  }
  summary.vectorsPassed = acceptance.passed;
  summary.vectorsTotal = acceptance.total;
  summary.sealed = { passed: summary.identitiesVerified };
  summary.vectors = { passed: acceptance.total > 0 && acceptance.failed.length === 0, replayed: acceptance.passed, total: acceptance.total };
  if (!summary.identitiesVerified) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('holo.identities', 'The identities the holo states are not the identities of its bytes.')), file: summary.artifact, remediation: 'Build it again from the model.' }));
  if (acceptance.total === 0) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('vectors.none', 'The artifact carries no acceptance vector, so nothing was replayed.')), file: summary.artifact, remediation: 'State examples in the model: one for every accepted path and every typed error.' }));
  for (const f of acceptance.failed.slice(0, 12)) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('vectors.failed', `Acceptance vector ${f.index} answers otherwise than the model states.`)), file: summary.artifact, remediation: 'Repair the rule or the example in the model, then build again.' }));
  // The assurance level is reported, and judged only when the caller names a policy: a holo built in this
  // process carries no signed statement, so its level is what its own bytes support.
  if (kind === 'holo') {
    const { check } = await import('./check.mjs');
    const { relexHere, reproveHere } = await import('./journey/reprove-here.mjs');
    const { proofRecordOf } = await import('./journey/proof-record.mjs');
    const carried = proofRecordOf(new Uint8Array(readFileSync(path)));
    try {
      const verdict = await check(path, { ...(policy ? { policy } : {}), reprove: reproveHere({ env, log }), relex: relexHere({ env, log }) });
      summary.level = verdict.level;
      summary.reproved = verdict.reproved;
      summary.sources = verdict.sources ?? { present: false, matchesSnapshot: null, semantic_id: null, lexlean: null, reason: 'The holo carries no sources object.' };
      // A record the holo carries and the kernel does not bear out is a failure; a holo with none only says so.
      if ((carried.statement || carried.snapshot) && verdict.reproved?.passed !== true) {
        diagnostics.push(diagnostic({ ...coded(new PrismCodeError('verify.reproved', verdict.reproved?.reason ?? 'The holo was not proved again.')), file: summary.artifact, remediation: 'Build the holo again from its model; never edit its bytes.' }));
      }
      if (verdict.sources?.present && verdict.sources.matchesSnapshot === false) {
        diagnostics.push(diagnostic({ ...coded(new PrismCodeError('verify.sources', verdict.sources.reason ?? "The sources the holo carries do not give its snapshot.")), file: summary.artifact, remediation: 'Build the holo again from its model; never edit its bytes.' }));
      }
      if (policy) {
        summary.policy = verdict.policy?.name ?? null;
        if (!verdict.passed) for (const r of verdict.reasons.filter((x) => x.check?.startsWith('policy'))) diagnostics.push(diagnostic({ code: r.check, message: r.message, file: summary.artifact }));
      }
    } catch (error) {
      if (!(error instanceof PrismError)) throw error;
      // No verdict was reached. That fails a policy, and it fails a holo that carries a record nothing then checked.
      if (policy || carried.statement || carried.snapshot) diagnostics.push(diagnostic({ code: error.check ?? error.code, message: error.message, file: summary.artifact }));
    }
  }
  return { code: diagnostics.some((d) => d.severity === 'error') ? EXIT.FAILED : null, summary, diagnostics };
}

/** `verify`: a holo, or a project and what `build` wrote for it. */
export async function modelVerify(target, { project: explicit = null, policy = null, env = process.env, log = () => {}, engine = null } = {}) {
  const started = Date.now();
  const path = resolve(target ?? '.');
  const info = existsSync(path) ? statSync(path) : null;
  if (!info) return answer('verify', started, EXIT.REFUSED, {}, [diagnostic({ ...coded(new PrismCodeError('load.path', `${path} does not exist`)), remediation: 'Name a holo, or a project directory.' })]);
  if (info.isFile()) {
    const kind = /\.rule-app\.json$/.test(path) ? 'rule-app' : 'holo';
    const replayed = await replay(kind, path, { policy, env, log });
    return answer('verify', started, replayed.code ?? EXIT.OK, replayed.summary, replayed.diagnostics);
  }
  const project = await openProject(path, explicit);
  if (project.refused) return answer('verify', started, EXIT.REFUSED, {}, project.diagnostics);
  const session = readSession(project.dir);
  const gated = await gate(project, session, { env, log, engine });
  if (gated.code !== null) return answer('verify', started, gated.code, gated.summary, gated.diagnostics);
  const built = builtOf(session);
  if (!built || !existsSync(built.path)) {
    return answer('verify', started, EXIT.FAILED, gated.summary, [...gated.diagnostics, diagnostic({ ...coded(new PrismCodeError('verify.unbuilt', 'The model checks and is proved, and nothing is built from it yet.')), remediation: 'Run prism-code build, then verify again.' })]);
  }
  if (built.source !== sourceDigest(project.dir)) {
    return answer('verify', started, EXIT.FAILED, gated.summary, [...gated.diagnostics, diagnostic({ ...coded(new PrismCodeError('verify.stale', 'What is built is the build of an earlier model: the sources changed since.')), remediation: 'Run prism-code build, then verify again.' })]);
  }
  const replayed = await replay(built.kind, built.path, { policy, env, log });
  return answer('verify', started, replayed.code ?? EXIT.OK, { ...gated.summary, ...replayed.summary, address: built.address ?? null }, [...gated.diagnostics, ...replayed.diagnostics]);
}

/** The report as a person reads it. */
export function formatReport(r) {
  const lines = [`${r.ok ? 'ok      ' : 'failed  '} ${r.command}, in ${r.durationMs} ms`];
  const s = r.summary;
  if (s.lockfile) lines.push(`  lock       ${s.lockfile}: ${s.written ? 'written again, and checked by LexLean' : s.current ? 'current, as LexLean checks it' : 'not current'}; ${s.packages} package${s.packages === 1 ? '' : 's'}`);
  if (s.modulesChecked !== undefined) lines.push(`  model      ${s.modulesChecked} module${s.modulesChecked === 1 ? '' : 's'}; ${s.theoremsVerified} of ${s.theoremsDeclared} theorems proved by Lean's kernel in this process`);
  if (s.idsRegistered !== undefined) lines.push(`  contract   ${s.idsRegistered} IDs, ${s.scenarios} scenarios, ${s.authorities} authorities, ${s.claims} claims; ${s.contractViolations} violation${s.contractViolations === 1 ? '' : 's'}`);
  if (s.artifact) lines.push(`  artifact   ${s.artifact}${s.address ? ` (${s.address})` : ''}`);
  if (s.vectorsTotal !== undefined) lines.push(`  vectors    ${s.vectorsPassed} of ${s.vectorsTotal} acceptance vectors pass`);
  if (s.holospace) lines.push(`  holospace  open ${s.holospace.link}`, `             and choose ${s.holospace.choose}: the app runs there, in its own holospace, in your browser`);
  if (s.identitiesVerified !== undefined) lines.push(`  identities ${s.identitiesVerified ? 'verified' : 'NOT verified'}${s.level ? `; assurance level ${s.level}` : ''}`);
  if (s.reproved) lines.push(`  reproved   ${s.reproved.passed ? `Lean's kernel accepted a proof of all ${s.reproved.theorems.length} theorems again, from the holo alone` : `NOT proved again: ${s.reproved.reason}`}`);
  if (s.sources) lines.push(`  sources    ${!s.sources.present ? 'not carried' : s.sources.matchesSnapshot === true ? "LexLean, on the sources the holo carries, writes its snapshot" : s.sources.matchesSnapshot === null ? 'carried, not read again' : `do NOT give the snapshot: ${s.sources.reason}`}`);
  if (s.carries) lines.push(`  carries    ${['snapshot', 'sources', 'proof'].map((member) => `${member === 'proof' ? 'proof record' : member} ${s.carries[member] ? 'yes' : 'no'}`).join(', ')}`);
  for (const d of r.diagnostics) {
    lines.push(`  ${d.severity === 'warning' ? 'warning' : 'error  '} ${d.file ? `${d.file}${d.line ? `:${d.line}${d.column ? `:${d.column}` : ''}` : ''}: ` : ''}${d.code}: ${d.message.replace(/\n/g, '\n    ')}`);
    if (d.remediation) lines.push(`          ${d.remediation}`);
  }
  return `${lines.join('\n')}\n`;
}
