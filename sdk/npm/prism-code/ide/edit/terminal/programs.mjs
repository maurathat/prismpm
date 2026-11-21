// The terminal's four programs, and the whole command line put together. No DOM and no xterm.js: the plain edit
// page (terminal.mjs) and the workbench page (../../src/model-terminal.js) both build their terminal from this, so
// the two answer the same lines the same way.
//
// A program here is a question to one of the page's workers: LexLean's front end, or Lean's kernel. This file
// turns the answer into text. It starts nothing itself.

import { materialize } from './kappa-space.mjs';
import { createLineEditor } from './line-editor.mjs';
import { createKept, createWriter, makeJudge } from './session.mjs';
import { createSession, WORDS } from './shell.mjs';

const enc = new TextEncoder();

/** A request as a table's examples write it ("word word 12"), as one number per field. */
const requestOf = (table, text) => text.trim().split(/\s+/).map((word, i) => (table.fields[i].kind === 'choice' ? table.fields[i].values.indexOf(word) : Number(word)));

/**
 * check, snapshot, prove and audit.
 *   check(files), snapshotOf(files)   the LexLean worker's two questions
 *   prove(words, guarantees)          the kernel worker's
 *   judge                             makeJudge's, for the audit table
 *   rules                             { ruleTable, tableWords, judgeTable, OPS } of src/journey/rule-table.mjs
 */
export function createPrograms({ check, snapshotOf, prove, judge, rules }) {
  const { ruleTable, tableWords, judgeTable, OPS } = rules;
  // A model's guarantees as the kernel judged them, for `prove` and `audit`.
  async function judged(files) {
    const taken = await snapshotOf(files);
    if (!taken.snapshot) return { why: 'The model does not check, so there is nothing to prove. Run check.' };
    let table;
    try { table = ruleTable(JSON.parse(taken.snapshot)); } catch (error) { return { why: 'This model is not a rule table, so its guarantees are not proved in this tab: ' + (error?.message ?? error) }; }
    const shaped = tableWords(table);
    const reply = await prove(shaped.words, shaped.guarantees);
    if (reply.error) return { why: "Lean's kernel could not run in this tab: " + reply.error };
    const said = (g) => 'When ' + g.when.map(([f, op, v]) => table.fields[f].name + ' ' + OPS[op] + ' ' + (table.fields[f].values ? table.fields[f].values[v] : v)).join(' and ') + ', the answer is ' + (g.always ? 'always ' : 'never ') + table.answers[g.outcome] + '.';
    return { table, results: reply.results, said };
  }
  return {
    async check(files) {
      const reply = await check(files);
      if (reply.error) return { text: 'LexLean did not answer: ' + reply.error, keep: false };
      const r = reply.result;
      const lines = r.diagnostics.map((d) => (d.primary ? `${d.primary.path.replace(/^\//, '')}:${d.primary.line_start}:${d.primary.column_start} ` : '') + `${d.code}: ${d.message}`);
      lines.push(r.success ? `The model checks. Its identity is sha256:${String(r.semantic_id ?? '').replace(/^sha256:/, '')}.` : `${r.diagnostics.length} problem${r.diagnostics.length === 1 ? '' : 's'}.`);
      return { text: lines.join('\n') };
    },
    async snapshot(files) {
      const taken = await snapshotOf(files);
      return taken.snapshot ? { text: taken.snapshot } : { text: 'The model does not check, so it has no snapshot. Run check.', keep: false };
    },
    async prove(files) {
      const j = await judged(files);
      if (j.why) return { text: j.why, keep: false };
      const count = j.results.filter((r) => r.proved).length;
      return { text: j.table.guarantees.map((g, i) => (j.results[i].proved ? 'proved   ' : 'refused  ') + j.said(g)).join('\n') + `\n${count} of ${j.results.length} proved by Lean's kernel in this tab.` };
    },
    async audit(files) {
      const j = await judged(files);
      if (j.why) return { text: j.why, keep: false };
      // The model's own examples, replayed through the table as the rule judge reads it.
      const examples = j.table.examples;
      const passed = examples.every((e) => j.table.answers[judgeTable(j.table, requestOf(j.table, e.request)).answer] === e.answer);
      const vectors = examples.length === 0 ? 'none' : passed ? 'passed' : 'failed';
      const lines = j.table.guarantees.map((g, i) => judge('audit', { kernel: j.results[i].proved ? 'accepted' : 'refused', kernelmodel: 'this', attestation: 'none', attestedmodel: 'other', vectors }).padEnd(9) + j.said(g));
      return { text: lines.join('\n') + `\nExamples: ${examples.length}, ${vectors}. No attestation is read here. Statuses by the rule of model/ide-audit.` };
    },
  };
}

/**
 * What each program is pinned to, and what its executable turned out to be in this tab.
 * `check` and `snapshot` are LexLean's front end, named by its BLAKE3 label. `prove` and `audit` need that and the
 * kernel with its loader and library, which the kernel's manifest still names by SHA-256; their label is the BLAKE3
 * label of that list. `held()` resolves { lexlean, kernel }, each 'pinned' | 'mismatch' | 'absent'.
 */
export function createPins({ pin, manifest, kappa, held }) {
  const parts = manifest ? ['sha256:' + manifest.wasm.sha256, 'sha256:' + manifest.glue.sha256, 'sha256:' + manifest.library.sha256] : null;
  const prover = parts ? kappa(enc.encode(JSON.stringify(['prism/terminal-prover/1', pin.kappa, ...parts]))) : null;
  const worst = (...all) => (all.includes('mismatch') ? 'mismatch' : all.includes('absent') ? 'absent' : 'pinned');
  const front = (command) => command === 'check' || command === 'snapshot';
  return {
    labelOf: (command) => (front(command) ? pin.kappa : command === 'prove' || command === 'audit' ? prover : null),
    bytesOf: async (command) => { const now = await held(); return front(command) ? now.lexlean : worst(now.lexlean, now.kernel); },
  };
}

/**
 * The command line, whole.
 *   tables        tables.json's `tables`
 *   luts          tables.json's `luts`: the label each materialized table must have
 *   rules         src/journey/rule-table.mjs
 *   kappa         src/blake3.mjs's
 *   reuseAdmits   src/journey/kappa-rules.mjs's
 *   project()     the model as it is in the editor: { '/path': text }
 *   check, snapshotOf, prove, held, pin, manifest   as createPrograms and createPins take them
 *   sink(bytes, done)   the terminal's write, with its callback; echo(text) the same for keys, written at once
 *   clear()       clear the screen
 *   kept          where outputs are kept; this tab's memory when none is given
 *   change        { write(path, text), remove(path) }: how the page changes a file of the model; without it the
 *                 commands that change a file say the page holds the model read-only
 */
export function createCommandLine({ tables, luts = {}, rules, kappa, reuseAdmits, project, check, snapshotOf, prove, held, pin, manifest, sink, echo, clear, kept = createKept(), change = null }) {
  // The words the command line answers are exactly the words the proved table lists, or it does not start.
  const listed = tables.commands.fields[0].values.filter((word) => word !== 'other');
  if ([...listed].sort().join(' ') !== [...WORDS].sort().join(' ')) throw new Error('the command line and the proved command table list different commands');
  // Each table whose requests are finite is computed once, here, into a lookup table, and answered from it. The
  // table computed in this tab must have the label the site was built with, or the terminal does not start.
  const made = {};
  for (const [name, table] of Object.entries(tables)) {
    const lut = materialize(table, rules.judgeTable, kappa);
    if (!lut) continue;
    if (luts[name] && luts[name] !== lut.kappa) throw new Error(`the ${name} table computes to ${lut.kappa}, not the ${luts[name]} it was published with`);
    made[name] = lut;
  }
  const judge = makeJudge(tables, rules.judgeTable, made);
  const programs = createPrograms({ check, snapshotOf, prove, judge, rules });
  const { labelOf, bytesOf } = createPins({ pin, manifest, kappa, held });
  const writer = createWriter({ judge, sink });
  const session = createSession({ judge, writer, files: () => new Map(Object.entries(project())), bytesOf, labelOf, programs, kappa, reuseAdmits, kept, clear, change });
  const editor = createLineEditor({ echo, submit: (line) => session.run(line), interrupt: () => session.interrupt(), clear, complete: session.complete, prompt: session.prompt });
  return { judge, writer, session, editor, luts: Object.fromEntries(Object.entries(made).map(([name, lut]) => [name, lut.kappa])), greeting: 'Prism terminal. A command line for this model, in this tab: no machine is behind it. Type help.' };
}
