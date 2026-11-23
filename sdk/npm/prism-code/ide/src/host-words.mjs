// What a holospace told this page, in a reader's words. No DOM and no import, so Node can test it.
//
// The holospace decides; this file only says what it decided. Nothing here judges a holo, a proof or a limit.
// The shapes are the ones agreed with Holospace:
//   replace(bytes)  -> { replaced: true, started, label, carried, judged, reason?: 'state.reset', why? }
//                      (started: the first build, when nothing ran before)
//                    | { replaced: false, reason, judged, why? }
//                      reason: holo.<verdict> | proof.refused | proof.unjudged | replace.failed
//                              (and this page's own replace.unanswered, when no answer came in a minute)
//   limits          -> { memoryMaxBytes, cpuTimePerEventMs, storageQuotaBytes } | null
//   a refused step  -> an error whose code is engine.memory | engine.trap | engine.contract | engine.time | fs.quota
//                      or, for a session that has ended, session.closed | session.diverged | session.full

const WHY = {
  'replace.unanswered': 'its holospace did not answer within a minute',
  'proof.unjudged': "its holospace cannot yet check the proof itself, and does not take this page's word for it",
  'proof.refused': 'its holospace proved the build again itself, and the proof was refused',
  'replace.failed': 'its holospace judged the build and could not put it in place of the running app',
  // An earlier name for the same thing, still answered by a holospace that has not been updated.
  'replace.unbuilt': 'its holospace judged the build and cannot replace a running app yet',
};

/** What the page keeps of the holospace's answer, and one sentence for the reader. `said` is what replace() resolved. */
export function replaceSaid(said) {
  const replaced = said?.replaced === true;
  const reason = typeof said?.reason === 'string' ? said.reason : null;
  const why = typeof said?.why === 'string' && said.why !== '' ? said.why : null;
  // A session that could not be carried into the new build: the app was replaced and starts afresh.
  const reset = replaced && (reason === 'state.reset' || said?.kept === 'restarted');
  const state = { replaced, reset, reason, why, label: said?.label ?? said?.address ?? null, carried: said?.carried ?? null, judged: said?.judged ?? null };
  if (replaced && said?.started === true) return { state: { ...state, started: true }, text: 'The app was started in its holospace.' };
  if (replaced) {
    return { state, text: reset
      ? `The running app was replaced, and started afresh: ${why ?? (said?.kept === 'restarted' && reason ? reason : 'its state could not be carried into the new build')}.`
      : 'The running app was replaced, and kept its state.' };
  }
  const verdict = reason?.startsWith('holo.') ? reason.slice('holo.'.length) : null;
  const because = verdict ? `its holospace judged the holo "${verdict}"` : WHY[reason] ?? reason ?? 'no reason given';
  return { state, text: `The running app was not replaced: ${because}${why ? ` (${why})` : ''}.` };
}

const size = (bytes) => (bytes >= 1048576 && bytes % 1048576 === 0 ? `${bytes / 1048576} MB` : bytes >= 1024 && bytes % 1024 === 0 ? `${bytes / 1024} KB` : `${bytes} bytes`);
const time = (ms) => (ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

/** The limits a holospace holds an app to, as one sentence; '' when it names none (or the page is not in one). */
export function limitsSaid(limits) {
  if (limits === null || typeof limits !== 'object') return '';
  const parts = [];
  if (Number.isSafeInteger(limits.memoryMaxBytes) && limits.memoryMaxBytes > 0) parts.push(`${size(limits.memoryMaxBytes)} of memory`);
  if (Number.isSafeInteger(limits.cpuTimePerEventMs) && limits.cpuTimePerEventMs > 0) parts.push(`${time(limits.cpuTimePerEventMs)} for each request`);
  if (Number.isSafeInteger(limits.storageQuotaBytes) && limits.storageQuotaBytes > 0) parts.push(`${size(limits.storageQuotaBytes)} of storage`);
  if (parts.length === 0) return '';
  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return `Its holospace holds it to ${list}.`;
}

const STOPPED = {
  'engine.memory': 'it asked for more memory than its holospace allows',
  'engine.time': 'it ran longer than its holospace allows for one request',
  'engine.trap': 'it stopped on a fault of its own',
  'engine.contract': 'it broke the contract a holospace runs an app by',
  'fs.quota': 'it asked for more storage than its holospace allows',
};
// A session that will take no more requests, in Holospace's own meanings.
const ENDED = {
  'session.closed': 'its session has ended, since an earlier step failed; it takes no more requests until its holospace is restarted',
  'session.diverged': 'the steps saved for its session do not give the same answers when replayed, so the saved history is not trusted',
  'session.full': 'its session has taken the 10,000 steps it keeps; restart its holospace to begin a new one',
};

/** Why an app gave no answer to a request, from the error the holospace threw. */
export function stoppedSaid(error) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const known = code ? STOPPED[code] : null;
  if (known) return `the app was stopped by its holospace: ${known} (${code})`;
  if (code && ENDED[code]) return `the app took no request: ${ENDED[code]} (${code})`;
  return `the app did not answer: ${String(error?.message ?? error)}`;
}
