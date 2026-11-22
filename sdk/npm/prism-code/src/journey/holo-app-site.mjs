/**
 * A holo app's model, published beside its page, so anyone the page reaches can open, check and prove the model the
 * holo was built from, in a browser, from the app's own address. A rule app's page gets this from its build
 * (`rule-app-site.mjs`), and a holo prism-code builds gets a folder of its own (`model-site.mjs`, which replaces the
 * folder it writes). This is for a holo built elsewhere, whose page its own repository assembles: it adds the model
 * and the record to a site that is already there and touches nothing else in it. The record is `model-site.mjs`'s.
 *
 * Written into the site:
 *   model/<path>        every file LexLean reads to check the model (`model-files.mjs`)
 *   model/project.json  the listing, `prism/model-listing/1`
 *   app.holo.json       the record, `prism/holo-app/1`: `{ schema, name, holo, bytes, semanticId }`
 *
 * `holo` is the BLAKE3 label of the whole holo as served, and `semanticId` the identity LexLean gave the model, read
 * from the holo's own provenance and never from the model's folder. Nothing here can tell that the folder is the
 * model the holo was built from. The record is a claim: the page that opens it derives the holo's label and the
 * model's identity again and calls the model the app's only when both are what the record names
 * (`ide/edit/holo-match.mjs`).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArchive, resolveArchive } from '../archive.mjs';
import { kappa } from '../blake3.mjs';
import { PrismCodeError } from '../errors.mjs';
import { modelFiles, modelListing } from './model-files.mjs';
import { holoAppRecord } from './model-site.mjs';

export { HOLO_APP_SCHEMA } from './model-site.mjs';

/**
 * Write the model in `model` and its record into `out`. `holo` is the holo's bytes as the site serves them.
 * Returns `{ files, entry, holo, semanticId, name }`. Throws a PrismCodeError, having written nothing, when the holo
 * names no model identity (`publish-model.identity`) or the folder is no LexLean project (`publish-model.model`).
 */
export function writeHoloAppModel({ holo, model, out, name = null }) {
  const { provenance } = resolveArchive(parseArchive(holo));
  const semanticId = provenance.semantic_id;
  if (typeof semanticId !== 'string' || !/^[0-9a-f]{64}$/.test(semanticId)) throw new PrismCodeError('publish-model.identity', 'the holo names no model identity, so there is nothing to hold a published model to');
  let project;
  try {
    project = modelFiles(model);
  } catch (error) {
    throw new PrismCodeError('publish-model.model', `${model} is not a LexLean project that can be published (${error.message})`);
  }
  const label = kappa(holo);
  const called = name ?? provenance.cargo_name ?? null;
  rmSync(join(out, 'model'), { recursive: true, force: true });
  for (const [path, bytes] of project.files) {
    mkdirSync(dirname(join(out, 'model', path)), { recursive: true });
    writeFileSync(join(out, 'model', path), bytes);
  }
  writeFileSync(join(out, 'model', 'project.json'), modelListing(project, { semanticId }));
  writeFileSync(join(out, 'app.holo.json'), holoAppRecord(holo, { name: called, semanticId }));
  return { files: project.files.size, entry: project.entry, holo: label, semanticId, name: called };
}
