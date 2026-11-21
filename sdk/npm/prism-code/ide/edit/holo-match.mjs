// Is the model that was opened the one its holo app was built from?
//
// A holo app built by prism-code publishes, beside its model/, a record (app.holo.json, schema prism/holo-app/1):
// the BLAKE3 label of its holo and the identity LexLean gave the model it was built from. Two things are compared
// here, and neither is taken on anyone's word:
//
//   the holo       the bytes fetched from the app must derive to the label the record names;
//   the model      the identity LexLean gives the fetched model, in this tab, must be the one the record names.
//
// What the model's own listing says of itself is not used: the same host wrote it and the model.
//
// This says the published model is the one the record names. That the holo really was built from that model is the
// holo's own provenance to show, and the audit page's to judge. A rule app is compared otherwise, by app-match.mjs.

import { kappa } from './prism-code/blake3.mjs';

export const HOLO_APP_SCHEMA = 'prism/holo-app/1';
const isLabel = (text) => typeof text === 'string' && /^blake3:[0-9a-f]{64}$/.test(text);
/** An identity as bare hex, however it is written, or null when it is not one. */
export const bareId = (id) => (typeof id === 'string' && /^(sha256:)?[0-9a-f]{64}$/.test(id) ? id.replace(/^sha256:/, '') : null);

/**
 * The record beside a model published at `project` (an address ending in model/), with whether the app's holo is
 * the bytes the record names: `{ address, app, record, holo: 'same' | 'other' | 'absent', got }`. Null when there is
 * no such record, or it does not name a holo and an identity.
 */
export async function holoAppRecord(project, { fetch: get = fetch } = {}) {
  if (!project) return null;
  const app = new URL('../', project).href;
  const address = app + 'app.holo.json';
  let record;
  try {
    const response = await get(address, { cache: 'no-store' });
    if (!response.ok) return null;
    record = await response.json();
  } catch { return null; }
  if (record?.schema !== HOLO_APP_SCHEMA || !isLabel(record.holo) || bareId(record.semanticId) === null) return null;
  let holo = 'absent';
  let got = null;
  try {
    const response = await get(app + 'app.holo', { cache: 'no-store' });
    if (response.ok) { got = kappa(new Uint8Array(await response.arrayBuffer())); holo = got === record.holo ? 'same' : 'other'; }
  } catch { /* the holo could not be fetched: said as absent */ }
  return { address, app, record, holo, got };
}

/**
 * One sentence for the reader. `identity` is what LexLean gives the model as it stands in the editor; `edited` is
 * whether its text differs from what was fetched.
 */
export function holoVerdict(found, identity, edited) {
  const named = bareId(found.record.semanticId);
  const mine = bareId(identity);
  // An app that does not serve the holo its own record names has no standing to say what it was built from.
  if (found.holo === 'other') return { state: 'other', text: `The app at ${found.app} does not serve the holo its record names: the bytes are ${found.got}, the record names ${found.record.holo}. This model is compared with nothing.` };
  const holo = found.holo === 'same' ? `The app's holo is the bytes its record names, ${found.record.holo}.` : `The app's holo could not be fetched, so it was not checked against its record.`;
  if (mine === null) return { state: 'unread', text: `LexLean gave this model no identity, so it is not compared with the app at ${found.app}.` };
  if (mine === named) return { state: 'same', text: (edited ? `Your text still has the identity the app at ${found.app} was built from, sha256:${named}.` : `This is the model the app at ${found.app} was built from: LexLean gives it the identity the app's record names, sha256:${named}.`) + ' ' + holo };
  return edited
    ? { state: 'changed', text: `Your changes give this model another identity than the app at ${found.app} was built from. The app itself is unchanged.` }
    : { state: 'other', text: `This is NOT the model the app at ${found.app} was built from: as published LexLean gives it sha256:${mine}, and the app's record names sha256:${named}.` };
}
