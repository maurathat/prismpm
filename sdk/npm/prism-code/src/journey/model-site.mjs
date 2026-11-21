/**
 * The folder a built holo app is published from: static files any host serves.
 *
 *   app.holo            the holo, as built
 *   app.holo.json       what it is: `{ schema, name, holo, bytes, semanticId }`, `holo` the UOR κ-label of the file
 *                       (BLAKE3) and `semanticId` the identity LexLean gives the model it was built from
 *   model/              the model's source, as a rule app's page carries it (model-files.mjs), with
 *   model/project.json  listing it, so the model can be opened, checked and proved in a browser from the app's
 *                       own address, and compared with what the app runs
 *
 * No file here starts with a dot: a static host such as GitHub Pages does not serve one.
 *
 * It carries no page of its own yet. The holo's own View is inside the holo; a page that opens the holo and mounts
 * that View is the Holospace shell's part, and an "open in the editor" link is the IDE's.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { kappa } from '../blake3.mjs';
import { modelListing } from './model-files.mjs';

export const HOLO_APP_SCHEMA = 'prism/holo-app/1';

/** The bytes of `app.holo.json`. */
export function holoAppRecord(holo, { name, semanticId }) {
  return Buffer.from(`${JSON.stringify({ schema: HOLO_APP_SCHEMA, name, holo: kappa(holo), bytes: holo.length, semanticId })}\n`);
}

/**
 * Write the folder, replacing what was there. `model` is `modelFiles` of the app's folder; without it only the
 * holo and its record are written. Returns `{ directory, files }`, the paths written.
 */
export function writeHoloSite(directory, holo, { name, semanticId, model = null } = {}) {
  const files = new Map([['app.holo', Buffer.from(holo)], ['app.holo.json', holoAppRecord(holo, { name, semanticId })]]);
  if (model) {
    for (const [path, bytes] of model.files) files.set(`model/${path}`, Buffer.from(bytes));
    files.set('model/project.json', modelListing(model, { semanticId }));
  }
  rmSync(directory, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  return { directory, files: [...files.keys()] };
}
