/**
 * Check, prove, build and try a Prism app whose one source is its LexLean
 * model (project.mjs). Nothing here writes the model: the author does, and
 * nothing here runs a local image.
 *
 * Where each step runs is frontend.mjs: LexLean as WebAssembly on this
 * machine checks the model and takes its semantic snapshot, and Lean's kernel
 * proves any other app's theorems in this process (model-prove.mjs). Nothing
 * about an app is sent anywhere: there is no hosted route.
 *
 * A rule app (the `rule-app` starter) is checked by Lean's kernel in this
 * process from the model's semantic snapshot, and becomes the verified rule
 * judge with the model's numbers (rule-app.mjs). Any other app is proved by
 * the kernel path, and is not built into a holo here: that needs Rust and
 * WebAssembly, which no step runs without an image yet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { PrismCodeError } from '../errors.mjs';
import { fromFile } from '../node.mjs';
import { VERSION } from '../version.mjs';
import { gapLedger } from '../gaps.mjs';
import { NO_DOCKER_FREE_BUILD, frontendWhere, proverWhere } from './frontend.mjs';
import { lexleanReady, wasmCheck, wasmDeclare, wasmSnapshot } from './lexlean-wasm.mjs';
import { collectIfUpgraded, withStoreHeld } from './store-gc.mjs';
import { sourceDigest } from './project.mjs';
import { hints } from './hints.mjs';
import { axiomViolations, forbiddenAxioms, forbiddenMessage } from './sdk.mjs';

/** A front-end probe that answers what was found. */
const wasmProbe = (here) => () => here;

/** Whether this app is a rule app: started from the `rule-app` starter. */
export const isRuleApp = (session) => session.starter === 'rule-app';

const failure = (error) => ({ ok: false, code: error.code, message: error.message });

/** A Lean warning, such as an unused simp argument: reported, never a reason a step failed. */
export const isWarning = (d) => d.severity === 'warning' || /^Lean rejected `[^`]+` \(warning\):/.test(d.message);

/** A `lexlean/diagnostic/1` from the hosted verifier, in the shape `parseDiagnostics` gives. */
export function fromHosted(d) {
  const p = d.primary;
  return { severity: d.severity ?? 'error', code: d.code, message: String(d.message ?? ''), span: p?.path ? { file: p.path, line: p.line_start, column: p.column_start } : null };
}

/**
 * Diagnostics as the author reads them: code, message, and the line of the model they anchor to. With the model's
 * folder, each also carries its hint (hints.mjs): where the name it quotes is written, that line, and the closest
 * names in scope when it is not one.
 */
const shown = (diagnostics, dir = null) => {
  const kept = diagnostics.filter((d) => !isWarning(d)).slice(0, 12);
  const extra = dir ? hints(kept, dir) : kept.map(() => ({}));
  return kept.map((d, i) => ({ code: d.code, message: d.message.split('\n').slice(0, 8).join('\n'), at: d.span ? `${d.span.file}:${d.span.line}:${d.span.column ?? 1}` : null, ...extra[i] }));
};

/** What to do about the diagnostics, in one line. An axiom-policy diagnostic says which set Lean observed. */
function repair(diagnostics, dir = null) {
  const fixes = axiomViolations(diagnostics);
  if (forbiddenAxioms(fixes).length) return forbiddenMessage(forbiddenAxioms(fixes));
  if (fixes.length) return `Lean observed other axioms than ${fixes.map((f) => `${f.name} declares`).join(', ')}; set each theorem's axioms to ${fixes.map((f) => `[${f.axioms.join(', ')}] for ${f.name}`).join('; ')}.`;
  // The first problem, when its hint names the fix: the replacement, and where to write it.
  const first = dir ? shown(diagnostics, dir)[0] : null;
  if (first?.didYouMean?.length && first.at) return `\`${first.name}\` is not in scope: at ${first.at} write ${first.didYouMean.map((n) => `\`${n}\``).join(' or ')} instead, then call the same tool again.`;
  if (first?.at && first.line) return `Fix ${first.at}, \`${first.line}\`, then call the same tool again.`;
  return 'Fix the model at the lines named, then call the same tool again.';
}

/**
 * Check the model: LexLean reads, links and elaborates it, and every
 * diagnostic is returned anchored to its line. Proves nothing.
 */
async function checkUnheld(dir, session, { log = () => {}, env = process.env, snapshot = null, gaps = gapLedger(), wasm = null } = {}) {
  wasm ??= wasmProbe(await lexleanReady({ env, log }));
  let where;
  try {
    where = frontendWhere({ env, hasWasm: wasm });
  } catch (error) {
    return failure(error);
  }
  let result;
  try {
    result = await wasmCheck(dir, { env });
  } catch (error) {
    return { ...failure(error), where };
  }
  const diagnostics = (result.diagnostics ?? []).map(fromHosted);
  session.status.checked = result.success ? { source: sourceDigest(dir), at: new Date().toISOString(), where, ms: result.ms, semanticId: result.semantic_id ? `sha256:${result.semantic_id}` : null } : null;
  return result.success ? { ok: true, where, ms: result.ms, semanticId: session.status.checked.semanticId, message: `The model checks, in ${result.ms} ms, with LexLean as WebAssembly on this machine.` } : { ok: false, where, ms: result.ms, diagnostics: shown(diagnostics, dir), message: repair(diagnostics, dir) };
}

/**
 * Prove the model. A rule app's guarantees are checked by Lean's kernel in
 * this process from its semantic snapshot; any other app's theorems by Lean's
 * kernel in this process (proveModel). Returns `{ ok, where, guarantees | message, diagnostics }`.
 */
async function proveUnheld(dir, session, { log = () => {}, env = process.env, snapshot = null, gaps = gapLedger(), kernel = null, modelKernel = null, wasm = null } = {}) {
  wasm ??= wasmProbe(await lexleanReady({ env, log }));
  let where;
  let frontend;
  try {
    where = frontend = frontendWhere({ env, hasWasm: wasm });
    // A rule app is proved by the rule judge's lemma in this process; any other app's theorems by the kernel path.
    if (!isRuleApp(session)) where = proverWhere();
  } catch (error) {
    return failure(error);
  }
  if (isRuleApp(session)) return proveRuleApp(dir, session, { log, where, snapshot, gaps, kernel, env });
  return proveModel(dir, session, { log, frontend, snapshot, gaps, kernel: modelKernel, env });
}

/**
 * Any app, in this process, with nothing sent anywhere. LexLean writes the model's kernel declarations itself
 * (`lexlean declare`, LexLean CL-29): the statements as LexLean means them and the proofs it produced, every proof
 * form planned (model-prove.mjs, `modelProveDeclared`). A LexLean without `declare` gives the semantic snapshot
 * instead, lowered here to kernel declarations with a proof found for each theorem (`modelProve`). Either way Lean's
 * kernel judges all of it.
 */
async function proveModel(dir, session, { log, frontend, snapshot, gaps, kernel, env }) {
  const started = Date.now();
  const mp = await import('./model-prove.mjs');
  if (!snapshot) {
    let declared = null;
    try {
      let k = kernel;
      if (!k) {
        await mp.ensureModelKernel({ env, log });
        k = await mp.openModelKernel({ env });
      }
      const d = await wasmDeclare(dir, k.baseText, { env });
      if (d.ok) declared = { k, document: d.document, ms: d.ms };
      else if (!d.unsupported) {
        const diagnostics = (d.check?.diagnostics ?? []).map(fromHosted);
        return { ...failure(new PrismCodeError('rule-table.refused', 'LexLean refused the model, so it has no declarations')), where: 'kernel', ...(diagnostics.length ? { diagnostics: shown(diagnostics, dir), message: repair(diagnostics, dir) } : {}) };
      }
    } catch (error) {
      if (error instanceof mp.ModelKernelMissing || error.code === 'kernel.unavailable') return { ok: false, where: 'kernel', code: 'kernel.unavailable', message: `Lean's kernel could not run in this process (${error.message}). This says nothing about the app.` };
      return { ...failure(error), where: 'kernel' };
    }
    if (declared) {
      log(`LexLean declared the model as WebAssembly in ${declared.ms} ms; asking Lean's kernel, in this process, to check every theorem.`);
      let result;
      try {
        result = await mp.modelProveDeclared(declared.document, { log, kernel: declared.k, env });
      } catch (error) {
        return { ok: false, where: 'kernel', code: error.code ?? 'kernel.unavailable', message: `Lean's kernel could not run in this process (${error.message}). This says nothing about the app.` };
      }
      return modelReport(dir, session, result, { started, semanticId: null, via: 'LexLean\'s own declarations' });
    }
    log('This LexLean has no declare command; the model is lowered here from its semantic snapshot.');
  }
  let model;
  try {
    model = await snapshotOf(dir, { log, env, snapshot });
  } catch (error) {
    return { ...failure(error), where: 'kernel', ...(error.diagnostics ? { diagnostics: shown(error.diagnostics, dir), message: repair(error.diagnostics, dir) } : {}) };
  }
  log("Asking Lean's kernel, in this process, to check every theorem of the model.");
  let result;
  try {
    result = await mp.modelProve(model, { log, kernel, env });
  } catch (error) {
    return { ok: false, where: 'kernel', code: error.code ?? 'kernel.unavailable', message: `Lean's kernel could not run in this process (${error.message}). This says nothing about the app.` };
  }
  return modelReport(dir, session, result, { started, semanticId: model.semantic_id ? `sha256:${model.semantic_id}` : null, via: null });
}

/** What a model proof says to the user, the same for either way it was planned. */
function modelReport(dir, session, result, { started, semanticId, via }) {
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const short = (name) => name.slice(name.lastIndexOf('.') + 1);
  const theorems = result.theorems.map((t) => ({ theorem: short(t.name), proof: t.proof, status: t.status, axioms: t.axioms, ...(t.setAside ? { setAside: t.setAside } : {}) }));
  if (result.refusal) return { ok: false, where: 'kernel', seconds, theorems, message: `The model could not be put to Lean's kernel: ${result.refusal}. This is a limit of this prover, not a verdict on the app.` };
  const missed = result.theorems.filter((t) => !t.status.startsWith('proved'));
  if (missed.length) return { ok: false, where: 'kernel', seconds, theorems, message: `${missed.length} of ${result.theorems.length} theorems are not proved: ${missed.slice(0, 3).map((t) => `${short(t.name)} (${t.status.replace(/^not proved: /, '')})`).join('; ')}.` };
  const fewer = result.theorems.filter((t) => t.status !== 'proved').length;
  session.status.proved = { source: sourceDigest(dir), at: new Date().toISOString(), where: 'kernel', seconds, semanticId };
  const from = via ? ` from ${via}${result.produced ? ` (${result.produced} proved as LexLean wrote them${result.setAside ? `, ${result.setAside} of LexLean's set aside and found here` : ''})` : ''}` : '';
  return { ok: true, where: 'kernel', seconds, theorems, message: `Lean's kernel, in this process, accepted a proof of every one of the model's ${result.theorems.length} theorems over ${result.declarations} declarations${from}, in ${seconds} s, each within its declared axioms${fewer ? ` (${fewer} on fewer than declared)` : ''}. ${result.remembered ? `${result.remembered} were remembered from earlier proofs on this machine, by their content, and ${result.judged} judged now. ` : ''}Nothing was sent anywhere.` };
}

/**
 * The model's semantic snapshot, `lexlean/semantic-snapshot/2`: the JSON LexLean as WebAssembly exports for it on
 * this machine. `snapshot`, a function of the folder, stands in for LexLean in tests.
 */
async function snapshotOf(dir, { log, env, snapshot = null }) {
  if (snapshot) return snapshot(dir);
  const taken = await wasmSnapshot(dir, { env });
  if (!taken.ok) throw Object.assign(new PrismCodeError('rule-table.refused', 'LexLean refused the model, so it has no semantic snapshot'), { diagnostics: (taken.check.diagnostics ?? []).map(fromHosted) });
  log(`Took the model's semantic snapshot with LexLean as WebAssembly, in ${taken.ms} ms.`);
  return taken.snapshot;
}

/**
 * A rule app: its table read from the snapshot, every guarantee tried for a
 * counterexample, then judged by Lean's kernel in this process, and the
 * verdict on the whole check given by the verified guest (kernel-verdict.mjs).
 */
async function proveRuleApp(dir, session, { log, where, snapshot, gaps, kernel, env }) {
  const started = Date.now();
  const { ruleTable, tableWords, counterexample } = await import('./rule-table.mjs');
  let table;
  try {
    table = ruleTable(await snapshotOf(dir, { log, env, snapshot }));
  } catch (error) {
    return { ...failure(error), where, ...(error.diagnostics ? { diagnostics: shown(error.diagnostics, dir), message: repair(error.diagnostics, dir) } : {}) };
  }
  const describe = (g, i) => `guarantee ${i + 1} (${g.always ? 'always' : 'never'} ${table.answers[g.outcome]})`;
  const broken = table.guarantees.map((g) => counterexample(table, g)).map((c, i) => ({ ...c, i })).filter((c) => c.request !== null);
  if (broken.length) {
    return { ok: false, where: 'kernel', semanticId: table.semanticId, message: broken.map((c) => `${describe(table.guarantees[c.i], c.i)} is false: the request \`${c.request}\` meets its conditions and the rules answer ${c.answer} (${c.rule === null ? 'otherwise' : `rule ${c.rule + 1}`}).`).join('\n'), next: 'Change a rule or the guarantee in the model, then prove again.' };
  }
  const { KERNEL_AXIOMS, kernelProve } = await import('./kernel-prove.mjs');
  const stated = tableWords(table);
  log("Asking Lean's kernel, in this process, to check every guarantee.");
  let result;
  try {
    result = await kernelProve(stated, { log, kernel, env });
  } catch (error) {
    return { ok: false, where: 'kernel', code: 'kernel.unavailable', message: `Lean's kernel could not run in this process (${error.message}). This says nothing about the app.` };
  }
  const refused = result.judged.filter((j) => !j.accepted).length;
  const { guestVerdict } = await import('./kernel-verdict.mjs');
  const { pinnedHolo, statementOf } = await import('./rule-app.mjs');
  let verdict;
  try {
    verdict = await guestVerdict(pinnedHolo(), { pinned: result.pinned, derived: { kernel: result.evidence.kernel, library: result.evidence.library }, bundle: result.evidence.bundle, statement: statementOf(stated.words, stated.guarantees), checked: result.evidence.statement, declared: KERNEL_AXIOMS, observed: result.evidence.axioms, accepted: refused === 0 });
  } catch (error) {
    verdict = { ok: false, code: error.code ?? 'verdictRuntimeFailed' };
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const guarantees = table.guarantees.map((g, i) => ({ guarantee: describe(g, i), status: result.judged[i].status }));
  if (!verdict.ok) return { ok: false, where: 'kernel', code: 'kernel.unavailable', guarantees, message: `The verdict guest gave no verdict (${verdict.code}). This says nothing about the app.` };
  if (refused || verdict.verdict !== 'proved') return { ok: false, where: 'kernel', guarantees, message: refused ? `Lean's kernel did not accept ${refused} guarantee${refused === 1 ? '' : 's'}, and no request the conditions tell apart breaks ${refused === 1 ? 'it' : 'them'}. This route cannot yet settle every true guarantee; that is not a verdict on the app.` : `Lean's kernel accepted every guarantee, and the verdict guest answered ${verdict.verdict}: a pinned address, the statement or the axioms are not the declared ones. Nothing is recorded.` };
  result.evidence.verdict = verdict.verdict;
  session.status.kernelChecked = { source: sourceDigest(dir), semanticId: table.semanticId, at: new Date().toISOString(), seconds, ...result.evidence };
  return { ok: true, where: 'kernel', seconds, semanticId: table.semanticId, guarantees, evidence: result.evidence, table, message: `Lean's kernel accepted all ${table.guarantees.length} guarantees for every request in the fields' bounds, in ${seconds} s, for the model ${table.semanticId}. This checks the rules as the verified rule judge reads them.` };
}

/**
 * Build the app. A rule app is written as the verified rule judge and the
 * model's numbers, named together, with its page. Any other app is refused:
 * its holo needs Lean's export, Rust and WebAssembly, which no step runs
 * without an image yet.
 */
async function buildUnheld(dir, session, { log = () => {}, env = process.env, snapshot = null, gaps = gapLedger(), kernel = null, modelKernel = null, remote = null, wasm = null } = {}) {
  wasm ??= wasmProbe(await lexleanReady({ env, log }));
  if (remote === 'github') return { ...failure(new PrismCodeError('build.publish-unavailable', `Publishing to GitHub writes the template's ID rows, scenarios and tests, and this prism-code does not yet write them from the model's semantic snapshot. ${NO_DOCKER_FREE_BUILD}`)), stage: 'build' };
  if (isRuleApp(session)) return buildRuleApp(dir, session, { log, env, snapshot, gaps, kernel, wasm });
  return buildModelApp(dir, session, { log, env, snapshot, gaps, kernel: modelKernel, wasm });
}

/**
 * Any other app, when it is a text application: every theorem proved by Lean's kernel in this process, then its
 * holo written with nothing compiled (model-holo.mjs): the evaluator guest with the model's program, the page, the
 * model document and the seal. What is written is then read back as any holo is, and must verify and answer its
 * own acceptance vectors. A model the evaluator guest does not run yet is refused, by name, and nothing is written.
 */
async function buildModelApp(dir, session, { log, env, snapshot, gaps, kernel, wasm }) {
  const started = Date.now();
  let frontend;
  try {
    frontend = frontendWhere({ env, hasWasm: wasm });
  } catch (error) {
    return { ...failure(error), stage: 'prove' };
  }
  const provedNow = await proveModel(dir, session, { log, frontend, snapshot, gaps, kernel, env });
  if (!provedNow.ok) return { ...provedNow, stage: 'prove' };
  let taken;
  try {
    // LexLean's exact bytes name the snapshot in the holo's records; a stand-in for LexLean has none.
    taken = snapshot ? { snapshot: await snapshot(dir), bytes: null } : await wasmSnapshot(dir, { env });
  } catch (error) {
    return { ...failure(error), stage: 'build' };
  }
  const { buildHolo } = await import('./model-holo.mjs');
  const { EVALUATOR_GUEST } = await import('./model-guest.mjs');
  log("Writing the app's holo: the evaluator guest with the model's program. Nothing is compiled.");
  let built;
  try {
    built = await buildHolo(taken.snapshot, { evaluator: readFileSync(new URL(EVALUATOR_GUEST.file, import.meta.url)), snapshotBytes: taken.bytes });
  } catch (error) {
    if (error.code === 'guest.uncovered' || error.code === 'eval.uncovered' || error.code === 'holo.profile' || error.code === 'holo.capabilities' || error.code === 'holo.facets') {
      return { ...failure(new PrismCodeError('build.guest-uncovered', `Lean's kernel proved every theorem, and the holo is not built: ${error.message}. Nothing is compiled on this path, and it does not run this yet. This is a limit of the builder, not a verdict on the app. ${NO_DOCKER_FREE_BUILD}`)), stage: 'build', where: 'kernel', reason: error.code };
    }
    if (error.code === 'holo.vectors' || error.code === 'holo.no-vectors') return { ...failure(new PrismCodeError('build.vectors', `The holo is not built: ${error.message}. Change the examples or the rules in the model, then build again.`)), stage: 'build', where: 'kernel', reason: error.code };
    if (error.code === 'holo.guest-differs') return { ...failure(new PrismCodeError('build.guest-differs', `The holo is not built: ${error.message}. This is a fault of the builder, and says nothing about the app.`)), stage: 'build', where: 'kernel', reason: error.code };
    return { ok: false, stage: 'build', where: 'kernel', code: error.code ?? null, message: `The holo is not built: ${error.message}. This says nothing about the app.` };
  }
  const path = join(dir, '.prism', 'build', `${built.name.toLowerCase().match(/[a-z0-9]+/g)?.join('-') ?? 'app'}.holo`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, built.bytes);
  let app;
  let acceptance;
  try {
    app = await fromFile(path);
    acceptance = await app.acceptance();
  } catch (error) {
    return { ok: false, stage: 'build', where: 'kernel', code: error.code, message: `The holo that was written does not load (${error.message}).` };
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const ok = app.identities.verified === true && acceptance.failed.length === 0;
  // The folder the app is published from: the holo, what it is, and the model's source beside it, as a rule app's page carries it.
  let site = null;
  if (ok) {
    const { writeHoloSite } = await import('./model-site.mjs');
    const { modelFiles } = await import('./model-files.mjs');
    site = writeHoloSite(join(dir, '.prism', 'site'), built.bytes, { name: built.name, semanticId: `sha256:${built.semanticId}`, model: modelFiles(dir) }).directory;
  }
  session.status.holo = ok ? path : null;
  session.status.built = ok ? { source: sourceDigest(dir), path, site, address: built.label, semanticId: `sha256:${built.semanticId}`, at: new Date().toISOString(), seconds, passed: acceptance.passed, total: acceptance.total, builder: 'evaluator-guest' } : null;
  return {
    ok,
    stage: 'build',
    where: 'kernel',
    seconds,
    holo: path,
    site,
    address: built.label,
    semanticId: `sha256:${built.semanticId}`,
    bytes: built.bytes.length,
    theorems: provedNow.theorems,
    vectors: { passed: acceptance.passed, total: acceptance.total },
    compared: built.compared,
    message: ok
      ? `Built in ${seconds} s with nothing compiled: the holo ${relative(process.cwd(), path) || path}, ${built.bytes.length} bytes, named ${built.label}, for the model sha256:${built.semanticId}. Proved: Lean's kernel accepted every one of the model's ${provedNow.theorems.length} theorems. Tested, not proved: the holo's guest is the evaluator guest running the model's program, and it answers ${acceptance.passed} of ${acceptance.total} acceptance vectors and ${built.compared.agreed} of ${built.compared.total} requests made from them as the model's own definitions do.`
      : `Written, but the holo does not verify or ${acceptance.failed.length} of ${acceptance.total} acceptance vectors fail through it. Nothing is recorded as built.`,
  };
}

/** A rule app: kernel-checked from its snapshot, then written as the rule judge and its numbers, with its page. */
async function buildRuleApp(dir, session, { log, env, snapshot, gaps, kernel, wasm }) {
  const started = Date.now();
  let where;
  try {
    where = frontendWhere({ env, hasWasm: wasm });
  } catch (error) {
    return { ...failure(error), stage: 'prove' };
  }
  const checked = await proveRuleApp(dir, session, { log, where, snapshot, gaps, kernel, env });
  if (!checked.ok) return { ...checked, stage: 'prove' };
  const { loadRuleApp, ruleAppRecord } = await import('./rule-app.mjs');
  log("Writing the app as the verified rule judge and the model's numbers. Nothing is compiled.");
  let made;
  try {
    made = ruleAppRecord(checked.table, { proof: checked.evidence });
  } catch (error) {
    return { ...failure(error), stage: 'build' };
  }
  const path = join(dir, '.prism', 'build', `${made.record.name}.rule-app.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, made.bytes);
  let app;
  let acceptance;
  try {
    app = await loadRuleApp(readFileSync(path));
    acceptance = await app.acceptance();
  } catch (error) {
    return { ok: false, stage: 'build', where: 'kernel', code: error.code, message: `The rule judge could not run this app (${error.message}).` };
  }
  let site = null;
  if (acceptance.failed.length === 0) {
    const { writeRuleAppSite } = await import('./rule-app-site.mjs');
    const { modelFiles } = await import('./model-files.mjs');
    // The model goes with the page, so anyone the page reaches can open, check and prove the model it was built from.
    site = writeRuleAppSite(join(dir, '.prism', 'site'), made.bytes, { model: modelFiles(dir), semanticId: checked.semanticId }).directory;
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  session.status.ruleApp = { path, address: made.address, semanticId: checked.semanticId, site, at: new Date().toISOString(), seconds, passed: acceptance.passed, total: acceptance.total, holo: app.record.kernel.holo };
  const ok = acceptance.failed.length === 0;
  return {
    ok,
    stage: 'build',
    where: 'kernel',
    seconds,
    app: path,
    address: made.address,
    semanticId: checked.semanticId,
    site,
    vectors: { passed: acceptance.passed, total: acceptance.total },
    message: ok
      ? `Built in ${seconds} s with nothing compiled: the app is the verified rule judge and the numbers of the model ${checked.semanticId}, named together as ${made.address}. Lean's kernel accepted all ${checked.table.guarantees.length} guarantees. Tested: ${acceptance.passed} of ${acceptance.total} acceptance vectors pass through it. Its page is the folder ${relative(process.cwd(), site) || site}: static files any host serves, which check the app in the browser before it answers. The folder also holds the model's source, in model/, so publishing the page publishes the model.`
      : `Written, but ${acceptance.failed.length} of ${acceptance.total} acceptance vectors fail through the rule judge: an example in the model answers otherwise than its rules do.`,
  };
}

/** Answer one request from the built app: the holo, or the rule app's record. Nothing answers before a build. */
export async function tryRequest(dir, session, request) {
  const bytes = new TextEncoder().encode(request);
  if (session.status.holo && existsSync(session.status.holo)) {
    const app = await fromFile(session.status.holo);
    return { ok: true, request, answer: new TextDecoder().decode(await app.dispatch(bytes)), from: 'the built holo' };
  }
  const record = session.status.ruleApp;
  if (record?.path && existsSync(record.path)) {
    const { loadRuleApp } = await import('./rule-app.mjs');
    try {
      const app = await loadRuleApp(readFileSync(record.path));
      return { ok: true, request, answer: new TextDecoder().decode(await app.dispatch(bytes)), from: 'the built rule app (the verified rule judge)', current: session.status.ruleApp.semanticId !== undefined && session.status.kernelChecked?.source === sourceDigest(dir) };
    } catch (error) {
      return { ok: false, request, code: error.code, message: `The built rule app is refused: ${error.message}` };
    }
  }
  return { ...failure(new PrismCodeError('try.unbuilt', 'Nothing is built yet, so nothing answers: call prism_run, which builds first. Prism answers only from a built app, never from a second reading of the model.')), request };
}

/**
 * A step that holds the machine store while it runs, so no collection removes what it reads, after
 * collecting what an upgrade left behind (store-gc.mjs).
 */
const held = (step) => (dir, session, options = {}) => {
  const env = options.env ?? process.env;
  collectIfUpgraded({ env });
  return withStoreHeld(env, () => step(dir, session, options));
};

/** Check the model (checkUnheld), holding the store. */
export const check = held(checkUnheld);
/** Prove the model (proveUnheld), holding the store. */
export const prove = held(proveUnheld);
/** Build the app (buildUnheld), holding the store. */
export const build = held(buildUnheld);
