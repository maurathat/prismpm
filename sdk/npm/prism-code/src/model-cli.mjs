/**
 * The model verbs, each in this process: `check`, `build` and `verify` of a project's LexLean model.
 *
 *   check [<dir>]     prism.toml, then LexLean as WebAssembly checks the model, then Lean's kernel, as
 *                     WebAssembly, proves every theorem. Writes nothing in the project.
 *   build [<dir>]     check, then the app is written under <project>/.prism/build, with nothing compiled.
 *   verify <target>   a holo: its digests, its world within the grant, and every acceptance vector replayed
 *                     on a fresh instance. A project: check again, then the same for what `build` wrote, which
 *                     must be the build of the model as it is on disk.
 *
 * No step starts another program, and nothing about the model is sent anywhere (journey/engine.mjs).
 *
 * Every verb answers one report, `prism/report/1`:
 *
 *   { ok, command, durationMs, summary, diagnostics: [{ code, severity, file, line, column, message, remediation }] }
 *
 * Exit codes: 0 the gate passed; 1 a theorem is not proved, a vector fails or a digest does not match; 2 the
 * manifest fails its checks or the model does not check (it does not parse, link or elaborate).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { PrismCodeError, PrismError } from './errors.mjs';
import { lexleanProjectDir } from './tiers.mjs';
import { readSession, sourceDigest, sourceFiles, writeSession } from './journey/project.mjs';

export const REPORT_SCHEMA = 'prism/report/1';
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, REFUSED: 2 });

const forward = (path) => path.split('\\').join('/');

/** A report code of this module's own, written as an error so that it is registered like every code prism-code raises. */
const coded = (error) => ({ code: error.code, message: error.message });

/** One diagnostic of the report. `at` is `file:line:column`, as the engine anchors a diagnostic. */
function diagnostic({ code, message, at = null, file = null, remediation = null, severity = 'error' }) {
  const m = at ? /^(.*):(\d+):(\d+)$/.exec(at) : null;
  return {
    code: code ?? new PrismCodeError('report.uncoded', '').code,
    severity,
    file: m ? forward(m[1]) : file,
    line: m ? Number(m[2]) : null,
    column: m ? Number(m[3]) : null,
    message: String(message ?? ''),
    remediation,
  };
}

/** The diagnostics of one engine step: each of its own, or the step's message when it names none. */
function stepDiagnostics(result, fallback) {
  const own = (result.diagnostics ?? []).map((d) => diagnostic({ code: d.code, message: d.message, at: d.at, remediation: d.didYouMean?.length ? `Write ${d.didYouMean.map((n) => `\`${n}\``).join(' or ')} instead.` : null }));
  if (own.length > 0) {
    if (own[0].remediation === null) own[0].remediation = result.message ?? null;
    return own;
  }
  const missed = (result.theorems ?? []).filter((t) => !t.status.startsWith('proved'));
  if (missed.length > 0) return missed.map((t) => diagnostic({ ...coded(new PrismCodeError('proof.rejected', `${t.theorem}: ${t.status}`)), remediation: 'Repair the definition or the theorem in the model; never weaken the theorem to make it pass.' }));
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

/** Check then prove, on `session`. Resolves `{ code, summary, diagnostics }`; `code` is null when both passed. */
async function gate(project, session, { env, log, engine }) {
  const { check, prove } = engine ?? (await import('./journey/engine.mjs'));
  const summary = { modulesChecked: sourceFiles(project.dir).length, theoremsDeclared: 0, theoremsVerified: 0 };
  const diagnostics = [...project.diagnostics];
  const checked = await check(project.dir, session, { env, log });
  if (!checked.ok) return { code: EXIT.REFUSED, summary, diagnostics: [...diagnostics, ...stepDiagnostics(checked, new PrismCodeError('model.unchecked', ''))] };
  const proved = await prove(project.dir, session, { env, log });
  const judged = proved.theorems ?? proved.guarantees ?? [];
  summary.theoremsDeclared = judged.length;
  summary.theoremsVerified = proved.ok ? judged.length : judged.filter((t) => String(t.status).startsWith('proved')).length;
  if (!proved.ok) return { code: EXIT.FAILED, summary, diagnostics: [...diagnostics, ...stepDiagnostics(proved, new PrismCodeError('proof.rejected', ''))] };
  return { code: null, summary, diagnostics };
}

/** `check`: the model checks and every theorem is proved. Writes nothing in the project. */
export async function modelCheck(path, { project: explicit = null, env = process.env, log = () => {}, engine = null } = {}) {
  const started = Date.now();
  const project = await openProject(path, explicit);
  if (project.refused) return answer('check', started, EXIT.REFUSED, {}, project.diagnostics);
  const gated = await gate(project, readSession(project.dir), { env, log, engine });
  return answer('check', started, gated.code ?? EXIT.OK, gated.summary, gated.diagnostics);
}

/** What a build wrote, from the session: `{ kind, path, source }`, or null. */
function builtOf(session) {
  const holo = session.status.built;
  if (holo?.path) return { kind: 'holo', path: holo.path, source: holo.source, address: holo.address };
  const rule = session.status.ruleApp;
  if (rule?.path) return { kind: 'rule-app', path: rule.path, source: session.status.lastBuild?.source ?? session.status.kernelChecked?.source ?? null, address: rule.address };
  return null;
}

/** `build`: check, then write the app. `out` also copies what was written into that folder. */
export async function modelBuild(path, { project: explicit = null, out = null, env = process.env, log = () => {}, engine = null } = {}) {
  const started = Date.now();
  const project = await openProject(path, explicit);
  if (project.refused) return answer('build', started, EXIT.REFUSED, {}, project.diagnostics);
  const session = readSession(project.dir);
  const gated = await gate(project, session, { env, log, engine });
  if (gated.code !== null) return answer('build', started, gated.code, gated.summary, gated.diagnostics);
  const { build } = engine ?? (await import('./journey/engine.mjs'));
  const built = await build(project.dir, session, { env, log });
  if (built.ok) session.status.lastBuild = { source: sourceDigest(project.dir), result: { ok: true, address: built.address } };
  writeSession(project.dir, session);
  const summary = { ...gated.summary, vectorsPassed: built.vectors?.passed ?? 0, vectorsTotal: built.vectors?.total ?? 0 };
  if (!built.ok) return answer('build', started, EXIT.FAILED, summary, [...gated.diagnostics, ...stepDiagnostics(built, new PrismCodeError('build.failed', ''))]);
  const written = built.holo ?? built.app;
  let artifact = written;
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    artifact = join(resolve(out), basename(written));
    copyFileSync(written, artifact);
  }
  return answer('build', started, EXIT.OK, { ...summary, artifact: forward(relative(process.cwd(), artifact) || artifact), address: built.address, bytes: built.bytes ?? statSync(written).size, site: built.site ? forward(relative(process.cwd(), built.site) || built.site) : null }, gated.diagnostics);
}

/** Load what was built and replay every acceptance vector on a fresh instance. Resolves `{ summary, diagnostics, code }`. */
async function replay(kind, path, { policy = null } = {}) {
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
  if (!summary.identitiesVerified) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('holo.identities', 'The identities the holo states are not the identities of its bytes.')), file: summary.artifact, remediation: 'Build it again from the model.' }));
  if (acceptance.total === 0) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('vectors.none', 'The artifact carries no acceptance vector, so nothing was replayed.')), file: summary.artifact, remediation: 'State examples in the model: one for every accepted path and every typed error.' }));
  for (const f of acceptance.failed.slice(0, 12)) diagnostics.push(diagnostic({ ...coded(new PrismCodeError('vectors.failed', `Acceptance vector ${f.index} answers otherwise than the model states.`)), file: summary.artifact, remediation: 'Repair the rule or the example in the model, then build again.' }));
  // The assurance level is reported, and judged only when the caller names a policy: a holo built in this
  // process carries no signed statement, so its level is what its own bytes support.
  if (kind === 'holo') {
    const { check } = await import('./check.mjs');
    try {
      const verdict = await check(path, policy ? { policy } : {});
      summary.level = verdict.level;
      if (policy) {
        summary.policy = verdict.policy?.name ?? null;
        if (!verdict.passed) for (const r of verdict.reasons.filter((x) => x.check?.startsWith('policy'))) diagnostics.push(diagnostic({ code: r.check, message: r.message, file: summary.artifact }));
      }
    } catch (error) {
      if (!(error instanceof PrismError)) throw error;
      if (policy) diagnostics.push(diagnostic({ code: error.check ?? error.code, message: error.message, file: summary.artifact }));
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
    const replayed = await replay(kind, path, { policy });
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
  const replayed = await replay(built.kind, built.path, { policy });
  return answer('verify', started, replayed.code ?? EXIT.OK, { ...gated.summary, ...replayed.summary, address: built.address ?? null }, [...gated.diagnostics, ...replayed.diagnostics]);
}

/** The report as a person reads it. */
export function formatReport(r) {
  const lines = [`${r.ok ? 'ok      ' : 'failed  '} ${r.command}, in ${r.durationMs} ms`];
  const s = r.summary;
  if (s.modulesChecked !== undefined) lines.push(`  model      ${s.modulesChecked} module${s.modulesChecked === 1 ? '' : 's'}; ${s.theoremsVerified} of ${s.theoremsDeclared} theorems proved by Lean's kernel in this process`);
  if (s.artifact) lines.push(`  artifact   ${s.artifact}${s.address ? ` (${s.address})` : ''}`);
  if (s.vectorsTotal !== undefined) lines.push(`  vectors    ${s.vectorsPassed} of ${s.vectorsTotal} acceptance vectors pass`);
  if (s.identitiesVerified !== undefined) lines.push(`  identities ${s.identitiesVerified ? 'verified' : 'NOT verified'}${s.level ? `; assurance level ${s.level}` : ''}`);
  for (const d of r.diagnostics) {
    lines.push(`  ${d.severity === 'warning' ? 'warning' : 'error  '} ${d.file ? `${d.file}${d.line ? `:${d.line}:${d.column}` : ''}: ` : ''}${d.code}: ${d.message.replace(/\n/g, '\n    ')}`);
    if (d.remediation) lines.push(`          ${d.remediation}`);
  }
  return `${lines.join('\n')}\n`;
}
