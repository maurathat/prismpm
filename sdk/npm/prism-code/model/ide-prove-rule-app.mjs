// Prove one of the IDE's rule-table models with this checkout's prism-code and say what Lean's kernel accepted.
//
// A rule-table model states its guarantees as data. The route that proves them is prism-code's rule-app build: the
// model's numbers go to the verified rule judge, and Lean's kernel, in this process, checks every guarantee for every
// request. It is `prism-code build`, run on a copy of the model. Nothing is fetched and nothing is sent anywhere.
//
// Usage: node ide-prove-rule-app.mjs <model dir> <guarantees expected> [<file to copy the built record to>] [<folder to copy the built site to>]
// Exit 0 only when the kernel accepted exactly that many guarantees and every acceptance vector passed.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [modelDir, expected, keepRecord, keepSite] = process.argv.slice(2);
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prism-code.mjs');

// The build writes beside the model, so it gets a copy.
const work = mkdtempSync(join(tmpdir(), 'ide-rule-app-'));
const app = join(work, 'app');
cpSync(resolve(modelDir), app, { recursive: true, filter: (p) => !/[\\/](tools|README\.md)$/.test(p) });
// A folder is built as a rule app only when its session says it was started from that starter.
writeFileSync(join(app, 'session.json'), JSON.stringify({ schema: 'prism/session/2', starter: 'rule-app', status: {} }, null, 2) + '\n');

const run = spawnSync(process.execPath, [bin, 'build', '--json'], {
  cwd: app, encoding: 'utf8', timeout: 300000, env: { ...process.env, PRISM_CODE_TIER: 'offline', PRISM_TELEMETRY: '0' },
});
let report = null;
try {
  report = JSON.parse(run.stdout);
} catch {
  // No report: the reason is in what the command printed.
}
// Where the app was written, and for which model, the build keeps in the session it saves beside the model.
let made = {};
try {
  made = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).status?.ruleApp ?? {};
} catch {
  // No session, nothing built.
}
const summary = report?.summary ?? {};
const accepted = summary.theoremsVerified ?? 0;
const vectors = { passed: summary.vectorsPassed ?? 0, total: summary.vectorsTotal ?? 0 };
const good = run.status === 0 && report?.ok === true && summary.theoremsDeclared === accepted && String(accepted) === String(expected) && vectors.total > 0 && vectors.passed === vectors.total && typeof made.path === 'string';
if (good && keepRecord && keepRecord !== '-') copyFileSync(made.path, resolve(keepRecord));
if (good && keepSite) cpSync(made.site, resolve(keepSite), { recursive: true });
console.log([
  `${good ? 'ok' : 'FAILED'}: ${modelDir}`,
  `model ${made.semanticId ?? 'not built'}`,
  `guarantees accepted by Lean's kernel: ${accepted} (expected ${expected})`,
  `acceptance vectors: ${vectors.passed} of ${vectors.total}`,
  good ? `app ${made.address}` : (report ? JSON.stringify(report.diagnostics).slice(0, 1200) : `${run.stdout}${run.stderr}`.slice(0, 1200)),
].join('\n'));
try {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  // Left in the temp folder.
}
process.exit(good ? 0 : 1);
