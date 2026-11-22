/**
 * Every Prism app starts from one canonical template, UOR-Foundation/template (`uor/template-contract/2`, the
 * standalone frame): its LexLean app in `app/`, its registers in `model/`, its scenarios in `features/suites/`, the
 * universal policy and the lock that binds it. This package carries it, so starting an app reads nothing from the
 * network: templates/canonical/index.json names every file by its path and the BLAKE3 label of its bytes, and
 * templates/canonical/objects/ holds each distinct file once under that label (scripts/pin-template.mjs writes both).
 *
 * `writeTemplate` admits every file by its label before it writes any, so a package whose bytes were altered writes
 * nothing; it keeps a file already there with the same bytes, and refuses before writing anything when a file holds
 * other bytes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismCodeError } from '../errors.mjs';
import { kappa } from '../blake3.mjs';

const BUNDLE = fileURLToPath(new URL('../../templates/canonical/', import.meta.url));
export const BUNDLE_SCHEMA = 'prism/template-bundle/1';

/** The template this package carries: `{ repository, commit, label, files: { path: label } }`. */
export function canonicalTemplate({ bundle = BUNDLE } = {}) {
  const index = JSON.parse(readFileSync(join(bundle, 'index.json'), 'utf8'));
  if (index.schema !== BUNDLE_SCHEMA) throw new PrismCodeError('template.altered', `templates/canonical/index.json is not ${BUNDLE_SCHEMA}`);
  if (kappa(new TextEncoder().encode(JSON.stringify(index.files))) !== index.label) throw new PrismCodeError('template.altered', `the template's index is not the one its label ${index.label} names`);
  return Object.freeze({ repository: index.repository, commit: index.commit, label: index.label, files: Object.freeze({ ...index.files }) });
}

/** Where the template's app is: its LexLean project, model under `app/src/`. */
export const APP_FOLDER = 'app';

/**
 * Write the canonical template into `dir`. Every file is read from the package and admitted by its BLAKE3 label
 * first (`template.altered`); a file already in `dir` with other bytes refuses the whole write (`template.exists`)
 * unless `force`. Resolves to `{ written, kept, label }`, the paths written and kept, and the template's label.
 */
export function writeTemplate(dir, { force = false, bundle = BUNDLE } = {}) {
  const template = canonicalTemplate({ bundle });
  const bytes = new Map();
  for (const [path, label] of Object.entries(template.files)) {
    const b = new Uint8Array(readFileSync(join(bundle, 'objects', label.replace(/^blake3:/, ''))));
    if (kappa(b) !== label) throw new PrismCodeError('template.altered', `the template's ${path} is not the bytes its label ${label} names: nothing was written`);
    bytes.set(path, b);
  }
  const at = (path) => join(dir, ...path.split('/'));
  const same = (path) => existsSync(at(path)) && Buffer.compare(readFileSync(at(path)), Buffer.from(bytes.get(path))) === 0;
  const clash = [...bytes.keys()].filter((path) => existsSync(at(path)) && !same(path));
  if (clash.length > 0 && !force) {
    throw new PrismCodeError('template.exists', `${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ` and ${clash.length - 5} more` : ''} already exist in ${dir} with other bytes; pass --force to overwrite`);
  }
  const written = [];
  const kept = [];
  for (const [path, b] of bytes) {
    if (same(path)) {
      kept.push(path);
      continue;
    }
    mkdirSync(dirname(at(path)), { recursive: true });
    writeFileSync(at(path), b);
    written.push(path);
  }
  return { written, kept, label: template.label };
}
