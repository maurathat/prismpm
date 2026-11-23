/**
 * A project's identity to a holospace: `prism.project`, beside `prism.toml`, holding one ID that `init` makes once.
 *
 * A holospace opened from a built holo is named by the holo's address. A project being written has no address of
 * its own yet, and every project starts from the same template, so without this each new app would open the same
 * holospace and share its files and storage. The ID names the project's holospace from its first keystroke.
 *
 * The ID is not part of the app. No build reads this file, so the same model builds the same bytes for anyone, and
 * the ID does not travel in a holo: a holospace named by a project is entered only from that project's own sources,
 * never from an ID read out of a holo, which anyone could have written there.
 *
 * No import of Node: text in, text out. `init` supplies the random bytes.
 */

/** The file, beside `prism.toml`. */
export const PROJECT_FILE = 'prism.project';

const ID = /^[0-9a-f]{64}$/;

/** The file's text for `id`, 64 lowercase hex. Throws a RangeError for anything else. */
export function projectFileText(id) {
  if (!ID.test(id)) throw new RangeError('a project ID is 64 lowercase hexadecimal characters');
  return [
    '# The identity of this project to a holospace. `prism-code init` made it once, from 32 random bytes, and never',
    '# rewrites it. A holospace opened from this project is named by it, so it keeps its files and storage as the',
    '# model changes. A copy of this folder is the same project to a holospace: change the ID to make it another.',
    '# No build reads this file, so it is not part of the app and does not change the app\'s address.',
    `id = "${id}"`,
    '',
  ].join('\n');
}

/** The ID the file's text states, or null when it states none that is well formed. */
export function projectIdOf(text) {
  const stated = /^id = "([^"\n]*)"$/m.exec(String(text ?? '').replace(/\r\n/g, '\n'))?.[1];
  return stated && ID.test(stated) ? stated : null;
}
