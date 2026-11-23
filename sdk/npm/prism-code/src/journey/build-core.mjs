/**
 * The build of a text application, with no disk, no process and no network of its own: files in, and out come
 * LexLean's diagnostics, the theorems a prover judged, and the holo with its κ-label. engine.mjs calls it for
 * `prism_build` in Node, and a browser worker calls the same functions (`serveBuild`), so the two cannot differ
 * in what they build.
 *
 * What it is given, it is given through its arguments: the project's files as a Map of `/`-rooted paths to
 * bytes, LexLean's compiled module (toolchain.mjs admits it by its κ-label), the evaluator guest's bytes
 * (model-holo.mjs admits them by theirs), and a prover. Proving is a port because Lean's kernel is loaded
 * differently in Node and in a page; a build given no prover says so in its result and in its message, and
 * never reports a theorem as proved.
 */
import { PrismCodeError } from '../errors.mjs';
import { loadArchive } from '../index.mjs';
import { NO_SERVER_BUILD } from './frontend.mjs';
import { lexleanCheck, lexleanSnapshot } from './lexlean-core.mjs';
import { buildHolo } from './model-holo.mjs';
import { withProofHints } from './proof-hints.mjs';

/** A Lean warning, such as an unused simp argument: reported, never a reason a step failed. */
export const isWarning = (d) => d.severity === 'warning' || /^Lean rejected `[^`]+` \(warning\):/.test(d.message);

/** A `lexlean/diagnostic/1`, in the shape every caller reads: severity, code, message, and where it anchors. */
export function fromHosted(d) {
  const p = d.primary;
  return { severity: d.severity ?? 'error', code: d.code, message: String(d.message ?? ''), span: p?.path ? { file: p.path, line: p.line_start, column: p.column_start } : null };
}

const refused = (error, reason) => ({ ok: false, code: error.code, message: error.message, stage: 'build', where: 'kernel', reason });

/**
 * The holo of a model whose theorems are already settled, from its semantic snapshot. Resolves
 * `{ ok: true, built }` (what `buildHolo` returns), or the refusal as the tools report it: `build.guest-uncovered`
 * for a model the evaluator guest does not run yet, `build.vectors` for examples the model's own rules do not
 * answer, `build.guest-differs` for a guest that answers otherwise than the model. `proved` says whether a
 * prover accepted the theorems first, and only then does a refusal say so. `sources` and `proof` are what the
 * holo carries of its model and of its proof, as `buildHolo` takes them.
 */
export async function holoFromSnapshot(snapshot, { evaluator, snapshotBytes = null, proved = true, sources = null, proof = null } = {}) {
  try {
    return { ok: true, built: await buildHolo(snapshot, { evaluator, snapshotBytes, sources, proof }) };
  } catch (error) {
    if (error.code === 'guest.uncovered' || error.code === 'eval.uncovered' || error.code === 'holo.profile' || error.code === 'holo.capabilities' || error.code === 'holo.facets') {
      return refused(new PrismCodeError('build.guest-uncovered', `${proved ? "Lean's kernel proved every theorem, and the holo is not built" : 'The holo is not built'}: ${error.message}. Nothing is compiled on this path, and it does not run this yet. This is a limit of the builder, not a verdict on the app. ${NO_SERVER_BUILD}`), error.code);
    }
    if (error.code === 'holo.vectors' || error.code === 'holo.no-vectors') return refused(new PrismCodeError('build.vectors', `The holo is not built: ${error.message}. Change the examples or the rules in the model, then build again.`), error.code);
    if (error.code === 'holo.guest-differs') return refused(new PrismCodeError('build.guest-differs', `The holo is not built: ${error.message}. This is a fault of the builder, and says nothing about the app.`), error.code);
    return { ok: false, stage: 'build', where: 'kernel', code: error.code ?? null, message: `The holo is not built: ${error.message}. This says nothing about the app.` };
  }
}

/** The holo read back as any holo is: whether it verifies, and how many of its acceptance vectors it answers. */
export async function readBack(bytes) {
  const app = await loadArchive(bytes, {});
  const acceptance = await app.acceptance();
  return { verified: app.identities.verified === true, passed: acceptance.passed, total: acceptance.total, failed: acceptance.failed.length };
}

const enc = new TextEncoder();

/**
 * The files as LexLean's instance reads them: a Map of `/`-rooted paths to bytes. Given a Map, `[path, content]`
 * pairs or an object of them; a path may lack its leading `/`, and content may be text.
 */
export function filesOf(files) {
  const pairs = files instanceof Map ? [...files] : Array.isArray(files) ? files : Object.entries(files ?? {});
  return new Map(pairs.map(([path, content]) => [path.startsWith('/') ? path : `/${path}`, typeof content === 'string' ? enc.encode(content) : content]));
}

/**
 * A diagnostic as an editor places it: the file it is in, its 1-based line and column, and where it ends when
 * LexLean says. `file`, `line` and `column` are null for a diagnostic that anchors nowhere.
 */
export function placed(d) {
  const p = d.primary ?? null;
  return { ...fromHosted(d), file: p?.path ?? null, line: p?.line_start ?? null, column: p?.column_start ?? null, endLine: p?.line_end ?? null, endColumn: p?.column_end ?? null };
}

/**
 * Build from files (`filesOf` says what they may be). `lexlean` is the compiled module, `evaluator` the evaluator
 * guest's bytes. `prove`, when given, is asked `{ files, snapshot, lexlean }` and resolves
 * `{ ok, theorems, message }`, each theorem `{ theorem, status, ms }` with `status` one of `proved`, `not proved`
 * and `not settled`; a build stops at a prover that does not answer `ok`. A prover that also resolves `record`,
 * the kernel's verdict on the snapshot's theorems (`kernelRecord`, as `kernelProver` gives it), has it written into
 * the holo as its kernel-proof statement. The holo carries the files that decide the model unless `sources` is
 * false. `onStage` is told `check`, `prove` and `build` as each begins.
 *
 * Resolves `{ ok, stage, diagnostics, semanticId, proved, theorems, holo, vectors, compared, ms, message }`.
 * `stage` is the last step reached. `diagnostics` are LexLean's, warnings among them, each as `placed` gives it.
 * `semanticId` is the model's, once LexLean has checked it. `proved` is true only when a prover was given and
 * accepted every theorem. `holo` is `{ bytes, label, name, semanticId, carries }`, `carries` saying whether it holds
 * its snapshot, its sources and its proof record.
 */
export async function buildFromFiles({ files, lexlean, evaluator, prove = null, sources = true, log = () => {}, onStage = () => {} }) {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const given = filesOf(files);
  const nothing = { semanticId: null, proved: false, theorems: null, holo: null };
  let check;
  let taken;
  onStage('check');
  try {
    check = await lexleanCheck(lexlean, given);
    if (!check.success) return { ok: false, stage: 'check', diagnostics: (check.diagnostics ?? []).map(placed), ...nothing, ms: ms(), message: 'LexLean refused the model. Fix it at the lines named, then build again.' };
    taken = await lexleanSnapshot(lexlean, given);
    if (!taken.ok) return { ok: false, stage: 'check', diagnostics: (taken.check.diagnostics ?? []).map(placed), ...nothing, ms: ms(), message: 'LexLean refused the model, so it has no semantic snapshot.' };
  } catch (error) {
    return { ok: false, stage: 'check', code: error.code ?? null, diagnostics: [], ...nothing, ms: ms(), message: error.message };
  }
  const diagnostics = (check.diagnostics ?? []).map(placed);
  const semanticId = `sha256:${taken.snapshot.semantic_id}`;
  log(`LexLean checked the model in ${check.ms} ms and took its semantic snapshot in ${taken.ms} ms.`);
  // A run that trapped and answered on a later try is worth seeing in a report (lexlean-core.mjs, lexleanRun).
  const retried = (check.retried ?? 0) + (taken.retried ?? 0);
  if (retried) log(`LexLean trapped ${retried} time${retried === 1 ? '' : 's'} before it answered; each trapped run was run again from the start.`);

  let theorems = null;
  let record = null;
  if (prove) {
    onStage('prove');
    let judged;
    try {
      judged = await prove({ files: given, snapshot: taken.snapshot, lexlean });
    } catch (error) {
      return { ok: false, stage: 'prove', code: error.code ?? 'kernel.unavailable', diagnostics, ...nothing, semanticId, ms: ms(), message: `Lean's kernel could not run (${error.message}). This says nothing about the app.` };
    }
    // A theorem that is not proved says where the model states it and what to try (proof-hints.mjs).
    theorems = withProofHints(judged.theorems ?? null, given);
    // A record is written only when it names the kernel that judged: a prover that cannot say which gives none.
    if (judged.ok && judged.record?.kernel && judged.record?.library) record = judged.record;
    if (!judged.ok) return { ok: false, stage: 'prove', code: judged.code ?? null, diagnostics, semanticId, proved: false, theorems, holo: null, ms: ms(), message: judged.message };
  }

  onStage('build');
  const carried = sources ? [...given].map(([path, bytes]) => ({ path: path.slice(1), bytes })) : null;
  const made = await holoFromSnapshot(taken.snapshot, { evaluator, snapshotBytes: taken.bytes, proved: prove !== null, sources: carried, proof: record });
  if (!made.ok) return { ...made, diagnostics, semanticId, proved: prove !== null, theorems, holo: null, ms: ms() };
  const { built } = made;
  let back;
  try {
    back = await readBack(built.bytes);
  } catch (error) {
    return { ok: false, stage: 'build', where: 'kernel', code: error.code ?? null, diagnostics, semanticId, proved: prove !== null, theorems, holo: null, ms: ms(), message: `The holo that was built does not load (${error.message}).` };
  }
  const ok = back.verified && back.failed === 0;
  const proof = prove
    ? `Proved: Lean's kernel accepted every one of the model's ${theorems?.length ?? 0} theorems.`
    : 'Not proved here: this build was given no prover, so the model\'s theorems were not judged.';
  return {
    ok,
    stage: 'build',
    diagnostics,
    semanticId,
    proved: prove !== null,
    theorems,
    holo: ok ? { bytes: built.bytes, label: built.label, name: built.name, semanticId, carries: built.carries } : null,
    vectors: { passed: back.passed, total: back.total },
    compared: built.compared,
    ms: ms(),
    message: ok
      ? `Built in ${ms()} ms with nothing compiled: a holo of ${built.bytes.length} bytes, named ${built.label}, for the model ${semanticId}. ${proof} Tested, not proved: the holo's guest is the evaluator guest running the model's program, and it answers ${back.passed} of ${back.total} acceptance vectors and ${built.compared.agreed} of ${built.compared.total} requests made from them as the model's own definitions do.`
      : `Built, but the holo does not verify or ${back.failed} of ${back.total} acceptance vectors fail through it. Nothing is given as built.`,
  };
}

/**
 * Serve builds to whoever holds the other end of `scope`, a worker's global or anything with `postMessage` and
 * `onmessage`. `toolchain` resolves `{ lexlean, evaluator, prove }` and is asked once, at the first build.
 *
 * Message in: `{ id, files, sources }`, `files` as `filesOf` takes them; `sources: false` leaves the sources out of the holo. Messages out: `{ id, stage }` as each of `check`,
 * `prove` and `build` begins; then `{ id, result }`, the result of `buildFromFiles`, the holo's bytes transferred
 * and not copied; or `{ id, error: { code, message } }` when the toolchain could not be had.
 */
export function serveBuild(scope, { toolchain }) {
  let ready = null;
  scope.onmessage = async ({ data }) => {
    const { id, files, sources = true } = data ?? {};
    try {
      ready ??= toolchain();
      const tools = await ready;
      const result = await buildFromFiles({ files, ...tools, sources: sources !== false, onStage: (stage) => scope.postMessage({ id, stage }) });
      scope.postMessage({ id, result }, result.holo ? [result.holo.bytes.buffer] : []);
    } catch (error) {
      ready = null;
      scope.postMessage({ id, error: { code: error instanceof PrismCodeError ? error.code : null, message: String(error?.message ?? error) } });
    }
  };
}
