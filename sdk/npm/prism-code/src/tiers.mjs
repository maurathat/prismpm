/**
 * Where a project's LexLean model is. Every gate runs in this process:
 *
 *   `check`    LexLean as WebAssembly checks the model, then Lean's kernel, as WebAssembly,
 *              proves every theorem.
 *   `build`    check, then the app is written with nothing compiled.
 *   `verify`   the built holo is judged and every acceptance vector replayed.
 *
 * The LexLean project is found, in this order: `--project <dir>`; the project root; between
 * `[model] source` of `prism.toml` and the root; the one direct subdirectory
 * that holds a `lexlean.toml`, as a UOR template instance's `app/` does.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fail } from './errors.mjs';

export const LEXLEAN_PROJECT_FILE = 'lexlean.toml';

const inside = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[A-Za-z]:/.test(rel));
};
const forward = (path) => (path === '' ? '.' : path.split(sep).join('/'));

/** Direct subdirectories of `root` that hold a `lexlean.toml`, skipping hidden ones and dependencies. */
function childProjects(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => !name.startsWith('.') && name !== 'node_modules' && name !== 'target')
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory() && existsSync(join(root, name, LEXLEAN_PROJECT_FILE));
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The directory holding the project's `lexlean.toml`, relative to `root`
 * with forward slashes (`'.'` for the root). `modelSource` is `[model] source`
 * of `prism.toml`; `explicit` is `--project`.
 */
export function lexleanProjectDir(root, modelSource = null, explicit = null) {
  if (explicit) {
    const dir = resolve(root, explicit);
    if (!inside(root, dir)) fail('tier.project', `--project ${explicit} is outside ${root}`);
    if (!existsSync(join(dir, LEXLEAN_PROJECT_FILE))) fail('tier.project', `no ${LEXLEAN_PROJECT_FILE} in --project ${explicit}`);
    return forward(relative(root, dir));
  }
  const candidates = ['.'];
  if (modelSource) {
    let dir = resolve(root, modelSource);
    while (inside(root, dir) && dir !== resolve(root)) {
      candidates.push(forward(relative(root, dir)));
      dir = dirname(dir);
    }
  }
  for (const candidate of candidates) {
    if (existsSync(join(root, candidate, LEXLEAN_PROJECT_FILE))) return candidate;
  }
  if (!modelSource) {
    const children = childProjects(root);
    if (children.length === 1) return children[0];
    if (children.length > 1) fail('tier.project', `${children.length} LexLean projects here (${children.join(', ')}); name one with --project <dir>`);
  }
  fail('tier.project', `no ${LEXLEAN_PROJECT_FILE} in ${root}${modelSource ? ` or under [model] source = ${JSON.stringify(modelSource)}` : ' or a directory directly under it'}; name the LexLean project with --project <dir>`);
}
