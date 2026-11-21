// The audit view of one Prism app: what it decides, each guarantee with what backs it, its examples, its fingerprint.
//
// It proves nothing itself, and it does not decide what a guarantee may be called (proved, tested, refused,
// unknown): that is asked of the audit-status model (../../model/ide-audit), run through the verified rule judge.
//
// A rule app (app.rule-app.json): the app's own published page already checks its judge archive, runs its examples
// and proves every guarantee with Lean's kernel in the tab. This view loads that page in a frame and reads what it
// found. "Proved" then means the kernel, in this tab.
//
// A holo app (app.holo): the holo is judged in this tab by prism-code's verifier, loaded, and its examples replayed.
// Lean does not run here for a holo. "Proved" then means the holo carries a proof statement that the verifier
// accepted at level P2 or above, about this holo's own model.
//
// A holo app may be anywhere that lets its files be fetched (?app=https://owner.github.io/app/): they are read as
// data and no code of the app's is run, except its guest, inside the loader's sandbox. A rule app must be on this
// page's origin, because its own page does the proving and this view reads what it found.
// Files are fetched by path, not by content label.

const params = new URLSearchParams(location.search);
const appBase = new URL(params.get('app') ?? './app/', location.href).href.replace(/\/?$/, '/');
const enc = new TextEncoder();
const dec = new TextDecoder();
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const row = (parent, cells) => { const tr = el('tr'); for (const [tag, text, cls] of cells) tr.append(el(tag, text, cls)); $(parent).append(tr); return tr; };
const show = (...ids) => { for (const id of ids) $(id).hidden = false; };
const hexWord = (n) => [0, 8, 16, 24].map((k) => ((n >>> k) & 255).toString(16).padStart(2, '0')).join('');
const readWord = (hex) => parseInt(hex.match(/../g).reverse().join(''), 16);
const unhex = (hex) => dec.decode(Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)));
const sha256 = async (bytes) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
// A file that is not there, or that its host will not let this page read, is simply absent.
const bytesOrNull = async (url) => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
// This page's own copy of a file when it is served one, else the app's copy.
const mine = (path) => new URL('./' + path, import.meta.url).href;
const importFirst = async (...urls) => { let last; for (const u of urls) { try { return await import(u); } catch (e) { last = e; } } throw last; };

const state = (window.prismAudit = { app: appBase, kind: null, ready: false, error: null, guarantees: [], vectors: [], verdict: null });
const WHY = { tested: 'not proved; the examples pass', unknown: 'nothing in this tab backs it' };

// A record's words: [schema, fields, (least, greatest) per field, otherwise, rules, then per rule: conditions, answer, (field, op, value)...].
const OPS = ['<', '≤', '>', '≥', 'is', 'is not'];
function readRules(record) {
  const w = record.words;
  let at = 2 + 2 * record.fields.length;
  const otherwise = w[at++];
  const rules = [];
  for (let n = w[at++]; n > 0; n--) {
    const count = w[at++], answer = w[at++];
    const when = [];
    for (let k = 0; k < count; k++, at += 3) when.push([w[at], w[at + 1], w[at + 2]]);
    rules.push({ when, answer });
  }
  return { rules, otherwise };
}
const conditions = (record, when) => when.map(([field, op, value]) => {
  const f = record.fields[field];
  return `${f.name} ${OPS[op]} ${f.kind === 'choice' ? f.values[value] : value}`;
}).join(' and ');

// One rule app's numbers through the verified rule judge, as the app's page runs them.
function judgeOf(record, kernel) {
  const prefix = 'rule ' + record.words.map(hexWord).join('');
  return async (request) => {
    const numbers = record.fields.map((f, i) => (f.kind === 'choice' ? f.values.indexOf(request[i]) : Number(request[i])));
    if (request.length !== record.fields.length || numbers.some((n) => !(n >= 0))) return 'invalid';
    const reply = dec.decode(await kernel.dispatch(enc.encode(prefix + numbers.map(hexWord).join(''))));
    return /^ok [0-9a-f]{24}$/.test(reply) ? record.outcomes[readWord(reply.slice(11, 19))] : null;
  };
}

// The audit-status model's judge. Its record names the judge archive it needs by hash; an archive is used only if it
// is that one, verifies, and replays its own vectors. Without it nothing is claimed.
async function auditJudge(loadArchive, judgeBytes) {
  const record = await (await fetch(mine('audit-status.rule-app.json'))).json();
  if (!judgeBytes || record.kernel.holo !== await sha256(judgeBytes)) return { ask: null, kernel: null };
  const kernel = await loadArchive(judgeBytes, { capabilities: null, capabilitySet: undefined, allowUnverified: false });
  const sound = kernel.identities?.verified === true && (await kernel.acceptance()).failed.length === 0;
  return sound ? { ask: judgeOf(record, kernel), kernel } : { ask: null, kernel: null };
}

function fingerprint(rows) {
  for (const [name, l] of rows) row('fingerprint', [['th', name], ['td', l.blake3, 'mono'], ['td', l.sha256, 'mono']]);
}
function guaranteeRow(text) {
  return row('guarantees', [['td', text], ['td', 'checking…', 'status'], ['td', '', 'why']]);
}
function settle(tr, index, request, status, cause) {
  tr.children[1].textContent = status ?? 'unknown';
  tr.children[1].dataset.status = status ?? 'unknown';
  tr.children[2].textContent = cause;
  state.guarantees.push({ index, request: request.join(' '), status: status ?? 'unknown', cause });
}
function summarise(extra = '') {
  const counts = {};
  for (const g of state.guarantees) counts[g.status] = (counts[g.status] ?? 0) + 1;
  state.summary = counts;
  $('summary').textContent = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ') + ` of ${state.guarantees.length}.` + extra;
}

// What a rule app's own page found, read once it has finished proving.
function appFindings() {
  return new Promise((resolve) => {
    const frame = Object.assign(document.createElement('iframe'), { src: appBase, hidden: true, title: 'the app' });
    document.body.append(frame);
    const started = Date.now();
    const timer = setInterval(() => {
      let found = null;
      try { found = frame.contentWindow.prismRuleApp; } catch (e) { clearInterval(timer); resolve({ error: 'the app is on another origin: ' + e.message }); return; }
      const settled = found?.ready && (!found.admitted || (found.vectors && (found.vectors.passed !== found.vectors.total || found.proved)));
      if (settled || Date.now() - started > 90000) {
        clearInterval(timer);
        resolve(found ? { ...found, timedOut: !settled } : { error: 'the app page did not start' });
      }
    }, 200);
  });
}

async function auditRuleApp(recordBytes, lib) {
  state.kind = 'rule app';
  const record = JSON.parse(dec.decode(recordBytes));
  const appJudgeBytes = await bytesOrNull(appBase + 'kernel.holo');
  const judgeBytes = (await bytesOrNull(mine('judge/kernel.holo'))) ?? appJudgeBytes;
  $('title').textContent = record.title || record.name;
  const recordLabel = { sha256: await sha256(recordBytes), blake3: lib.kappa(recordBytes) };
  fingerprint([['App record', recordLabel], ...(appJudgeBytes ? [['Rule judge', { sha256: await sha256(appJudgeBytes), blake3: lib.kappa(appJudgeBytes) }]] : [])]);

  show('rulesSection', 'requestSection');
  for (const f of record.fields) row('fields', [['th', f.name], ['td', f.kind === 'choice' ? f.values.join(', ') : `${f.min} to ${f.max}`]]);
  const { rules, otherwise } = readRules(record);
  for (const r of rules) $('rules').append(el('li', `${conditions(record, r.when)} → ${record.outcomes[r.answer]}`));
  $('rules').append(el('li', `otherwise → ${record.outcomes[otherwise]}`));

  const audit = await auditJudge(lib.loadArchive, judgeBytes);
  const appJudge = audit.kernel ? judgeOf(record, audit.kernel) : null;
  const replay = async () => {
    $('vectors').replaceChildren();
    state.vectors = [];
    for (const v of record.vectors) {
      const request = unhex(v.request), want = unhex(v.response);
      const got = appJudge ? await appJudge(request === '' ? [] : request.split(' ')) : null;
      state.vectors.push({ request, want, got, pass: got === want });
      row('vectors', [['td', request || '(empty)', 'mono'], ['td', want], ['td', got ?? 'no answer'], ['td', got === want ? 'same' : 'DIFFERENT', got === want ? 'ok' : 'bad']]);
    }
    const passed = state.vectors.filter((v) => v.pass).length;
    $('vectorsSummary').textContent = `${passed} of ${state.vectors.length} examples give the recorded answer, replayed in this tab.`;
    return state.vectors.length === 0 ? 'none' : passed === state.vectors.length ? 'passed' : 'failed';
  };
  show('replay');
  $('replay').addEventListener('click', replay);
  const replayed = await replay();

  const rows = record.guarantees.map((g) => guaranteeRow(`When ${conditions(record, g.when)}, the answer is ${g.always ? 'always' : 'never'} ${record.outcomes[g.outcome]}.`));
  const found = await appFindings();
  // "This model" is the record on show: the frame must have loaded the same bytes this view read.
  const sameModel = !found.error && found.address === recordLabel.sha256;
  const accepted = Array.isArray(found.proved?.accepted) ? found.proved.accepted : null;
  for (const [i, tr] of rows.entries()) {
    const request = [accepted === null ? 'none' : accepted[i] ? 'accepted' : 'refused', sameModel ? 'this' : 'other', 'none', 'other', found.admitted === false ? 'failed' : replayed];
    const status = audit.ask ? await audit.ask(request) : 'unknown';
    settle(tr, i, request, status, !audit.ask ? 'the rule judge archive is not the verified one, so nothing is claimed'
      : found.error ? found.error
      : found.admitted === false ? 'the app refuses itself: its record, judge or proof is not the one it names'
      : request[0] === 'refused' ? "Lean's kernel did not accept it"
      : replayed === 'failed' ? 'an example gives a different answer than recorded'
      : found.proved?.error ? 'the kernel could not run here: ' + found.proved.error
      : found.timedOut ? 'the proof did not finish in 90 seconds'
      : status === 'proved' ? "Lean's kernel accepted it in this tab, for this record" : WHY[status]);
  }
  summarise(found.proved?.ms ? ` Proved in ${found.proved.ms} ms.` : '');
}

const PROOF_PREDICATE = 'https://uor.foundation/prism/proof/v1';
const LEVELS = ['P0', 'P1', 'P2', 'P3'];

async function auditHolo(holoBytes, lib) {
  state.kind = 'holo';
  const verifier = await import(mine('prism-code/vendor/verify.mjs'));
  const label = { sha256: await sha256(holoBytes), blake3: lib.kappa(holoBytes) };
  fingerprint([['Holo', label]]);
  const audit = await auditJudge(lib.loadArchive, await bytesOrNull(mine('judge/kernel.holo')));

  // Judge, read and load the holo. Any of the three refusing it is the finding.
  // Loading refuses an altered holo. The verifier gives the level; the copy that runs in a browser does not read a
  // holo that carries statements, and says so. That is a limit of this tab, not a fault of the holo.
  const said = (e) => `${e?.code ? e.code + ': ' : ''}${e?.message ?? e}`;
  let verdict = null, info = null, app = null, refusal = null, unjudged = null;
  try { info = verifier.inspect(holoBytes); } catch (e) { refusal = said(e); }
  try { app = await lib.loadArchive(holoBytes, { capabilities: null, capabilitySet: undefined, allowUnverified: false }); } catch (e) { refusal = said(e); }
  try { verdict = await verifier.verify(holoBytes); } catch (e) { unjudged = said(e); }

  // A holo that carries statements: the browser verifier does not read it as it is. Its statements' signatures are
  // checked here against the key this page was given (signature.mjs), and the verifier then judges the holo
  // without the section, told only which statements verified. That is what `check --key` does in Node.
  let signer = null, judged = null;
  if (app && unjudged) {
    try {
      const [{ parseArchive }, { readAttestations, stripAttestations }, sig] = await Promise.all(
        [import(mine('prism-code/archive.mjs')), import(mine('prism-code/attestations.mjs')), import(mine('signature.mjs'))]);
      const pem = await bytesOrNull(params.get('key') ? new URL(params.get('key'), location.href).href : mine('signer.pub.pem'));
      const spki = pem ? sig.spkiOfPem(dec.decode(pem)) : undefined;
      signer = spki ? await sig.keyName(spki) : null;
      const parsed = parseArchive(holoBytes);
      const P = verifier.ASSURANCE.PREDICATES;
      judged = await sig.statementsFor(readAttestations(parsed), { provenance: P.provenance, proof: P.proof }, spki);
      verdict = await verifier.verify(stripAttestations(parsed), { statements: judged });
      unjudged = null;
    } catch (e) { unjudged = said(e); }
  }
  state.signer = signer;
  state.verdict = verdict;
  $('title').textContent = info?.name ?? 'A holo this tab refuses';

  show('verdictSection');
  if (refusal) row('verdict', [['th', 'Refused'], ['td', refusal, 'bad']]);
  if (unjudged) row('verdict', [['th', 'No level'], ['td', 'This tab could not give the holo a level: ' + unjudged]]);
  if (judged) row('verdict', [['th', 'Signer'], ['td', signer ? `the key ${signer}, given to this page by whoever opened it, not by the app` : 'none named: no signature is counted', signer ? 'mono' : undefined]]);
  if (verdict) {
    row('verdict', [['th', 'Level'], ['td', `${verdict.level} (the default policy asks for ${verdict.policy.minimum})`]]);
    for (const r of verdict.reasons) row('verdict', [['th', r.withholds ? `Withholds ${r.withholds}` : 'Policy'], ['td', r.message]]);
  }
  if (info?.model) {
    show('requestSection');
    $('requestNote').textContent = 'What the holo says of its model.';
    for (const [k, v] of [['Function', info.model.function], ['Description', info.model.description], ['Crate', `${info.model.cargo_name} ${info.model.cargo_version}`],
      ['Limits', `request ${info.model.limits.request} B, response ${info.model.limits.response} B`], ['Model document', 'blake3:' + info.model.digest.blake3]]) row('fields', [['th', k], ['td', String(v), k === 'Model document' ? 'mono' : undefined]]);
  }

  // The examples the holo carries, replayed through the guest it carries.
  let replayed = 'none';
  if (app) {
    const result = await app.acceptance();
    replayed = result.total === 0 ? 'none' : result.failed.length === 0 ? 'passed' : 'failed';
    state.vectors = [{ total: result.total, passed: result.passed, failed: result.failed.length }];
    $('vectorsSummary').textContent = `${result.passed} of ${result.total} examples give the recorded answer, replayed in this tab through the holo's own guest.`;
  } else {
    $('vectorsSummary').textContent = 'Not replayed: the holo did not load.';
  }

  // What Lean proved, by the holo's own signed account. Lean does not run here for a holo.
  // The statements are read through the loaded holo. Their signatures are not checked here: a browser has no
  // checker for them yet, so a statement counts as verified only when the verifier itself granted P2.
  let carried = [];
  try { carried = app ? await app.attestations() : []; } catch { carried = []; }
  const statements = carried.filter((a) => (a.statement?.predicateType ?? a.predicateType) === PROOF_PREDICATE);
  // When the signature was checked, the statement judged is the signed payload itself.
  const proof = (judged?.proof?.statement ?? statements[0]?.statement)?.predicate ?? null;
  const signed = statements[0]?.signed === true;
  state.statements = carried.map((a) => ({ type: a.statement?.predicateType ?? a.predicateType, signed: a.signed === true }));
  const outcome = (type) => { const j = Object.values(judged ?? {}).find((x) => x.statement?.predicateType === type); return j ? (j.envelope.verified ? 'its signature verifies against the signer' : j.envelope.message) : 'its signature is not checked in this tab'; };
  for (const a of state.statements) row('verdict', [['th', 'Carries'], ['td', `${a.signed ? 'a signed' : 'an unsigned'} statement of type ${a.type}: ${outcome(a.type)}`]]);
  const reachedP2 = verdict ? LEVELS.indexOf(verdict.level) >= 2 : false;
  const aboutThis = proof?.model?.document?.sha256 === info?.model?.digest?.sha256;
  const theorems = proof?.theorems ?? [];
  // With no proof statement, what the app's own page claims Lean proved (the template's app.json). A claim is the
  // app's word: it is shown, and marked by what this tab could check, which is the examples.
  let claims = [];
  if (theorems.length === 0) {
    try { claims = JSON.parse(dec.decode(await bytesOrNull(appBase + 'app.json') ?? enc.encode('{}'))).theorems ?? []; } catch { claims = []; }
  }
  state.claims = claims.length;
  for (const [i, c] of claims.entries()) {
    const tr = guaranteeRow(`${c.name}: ${c.statement}`);
    const request = ['none', 'other', 'none', 'other', refusal ? 'failed' : replayed];
    const status = audit.ask ? await audit.ask(request) : 'unknown';
    settle(tr, i, request, status, !audit.ask ? 'the rule judge archive is not the verified one, so nothing is claimed'
      : refusal ? 'the holo is refused: ' + refusal
      : `claimed by the app, not checked here: the holo carries no proof statement. The app says: "${c.how ?? 'no account given'}"`
        + (status === 'tested' ? ' Its examples pass.' : ''));
  }
  if (theorems.length === 0 && claims.length === 0) {
    const tr = guaranteeRow('The app answers its own examples as recorded.');
    const request = ['none', 'other', 'none', 'other', refusal ? 'failed' : replayed];
    const status = audit.ask ? await audit.ask(request) : 'unknown';
    settle(tr, 0, request, status, !audit.ask ? 'the rule judge archive is not the verified one, so nothing is claimed'
      : refusal ? 'the holo is refused: ' + refusal
      : status === 'tested' ? 'the holo carries no proof statement, so nothing Lean proved can be checked here; its examples pass' : WHY[status] ?? 'an example gives a different answer than recorded');
  }
  for (const [i, t] of theorems.entries()) {
    const tr = guaranteeRow(`${t.name} (${t.module}), axioms: ${(t.axioms?.observed ?? []).join(', ') || 'none'}`);
    const request = ['none', 'other', reachedP2 && t.verdict === 'PASSED' ? 'verified' : 'invalid', aboutThis ? 'this' : 'other', refusal ? 'failed' : replayed];
    const status = audit.ask ? await audit.ask(request) : 'unknown';
    settle(tr, i, request, status, !audit.ask ? 'the rule judge archive is not the verified one, so nothing is claimed'
      : refusal ? 'the holo is refused: ' + refusal
      : status === 'proved' ? 'the build proved it with Lean; this tab checked the statement and its signature against the signer, not the proof itself'
      : t.verdict !== 'PASSED' ? 'the proof statement records it as failed'
      : !aboutThis ? 'the proof statement is about another model'
      : !reachedP2 && !verdict ? `the holo's ${signed ? 'signed' : 'unsigned'} proof statement records it as passed, but a browser cannot check that signature yet, so it is not counted as proof here; prism-code check, given the signer, can`
      : !reachedP2 ? `the proof statement is not accepted, so the holo is at ${verdict?.level}: ${verdict?.reasons.find((r) => r.withholds === 'P2' || r.withholds === 'P1')?.message ?? 'no reason given'}`
      : WHY[status] ?? 'an example gives a different answer than recorded');
  }
  summarise(verdict ? ` Level ${verdict.level}.` : unjudged ? ' No level in this tab.' : '');
}

// An app may publish its model beside its page (model/project.json, as prism-code's rule-app build writes it). When
// it does, the editor can open it from the app's own address. This page checks nothing about the model: the editor
// has LexLean check it and Lean's kernel judge its guarantees, in its own tab.
async function offerEditor() {
  let listing = null;
  try { listing = JSON.parse(dec.decode(await bytesOrNull(appBase + 'model/project.json') ?? enc.encode('null'))); } catch { listing = null; }
  if (!listing || !Array.isArray(listing.files) || typeof listing.entry !== 'string') { state.model = null; return; }
  state.model = { files: listing.files.length, entry: listing.entry, semanticId: listing.semanticId ?? null };
  const link = $('editLink');
  link.href = new URL('../edit/ide/', location.href).href + '?project=' + encodeURIComponent(appBase + 'model/');
  $('edit').hidden = false;
}

async function main() {
  $('app').textContent = appBase;
  if (params.get('app')) offerEditor();
  // prism-code comes from this page's origin. Only an app on the same origin may stand in with its own copy.
  const sameOrigin = new URL(appBase).origin === location.origin;
  const prismCode = await importFirst(mine('prism-code/index.mjs'), ...(sameOrigin ? [appBase + 'prism-code/src/index.mjs'] : []));
  const blake3 = await importFirst(mine('prism-code/blake3.mjs'), ...(sameOrigin ? [appBase + 'prism-code/src/blake3.mjs'] : []));
  const lib = { loadArchive: prismCode.loadArchive, kappa: blake3.kappa };
  const recordBytes = await bytesOrNull(appBase + 'app.rule-app.json');
  if (recordBytes) return auditRuleApp(recordBytes, lib);
  const holoBytes = await bytesOrNull(appBase + 'app.holo');
  if (holoBytes) return auditHolo(holoBytes, lib);
  // Opened with no app named and none beside the page: ask for one. The form is a plain GET, so the address
  // ends up in this page's own URL as ?app=.
  if (!params.get('app')) {
    $('summary').textContent = 'No app is open.';
    $('open').hidden = false;
    for (const h of document.querySelectorAll('main > h2, main > .scroll, main > p.dim, main > section')) h.hidden = true;
    state.kind = 'none';
    return;
  }
  throw new Error('no app.rule-app.json and no app.holo at ' + appBase);
}

// Offline, by content: the site's service worker, where the site was assembled with one (tools/build-offline-site.mjs).
// It serves each published file only as the bytes its BLAKE3 label names, from this browser once it has them. This
// page loaded before the worker could take over, so it tells the worker what it loaded.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', location.href)).then(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data && 'warmed' in data) state.offline = data; });
    setTimeout(() => worker?.postMessage({ warm: [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)] }), 4000);
  }).catch(() => { /* no worker here: the page works as before, from the network */ });
}

main().catch((e) => { state.error = String(e?.stack ?? e); $('summary').textContent = 'This audit could not be made: ' + (e?.message ?? e); })
  .finally(() => { state.ready = true; });
