/**
 * Where a built holo is opened: its own holospace, on the published Holospace page, in the browser, with no server.
 *
 *   https://hologram-technologies.github.io/holospace-shell/space.html#app=blake3:<label>
 *
 * The link names the app by its κ-label only. A holo built on this machine is at no address that page can fetch,
 * so the page asks for the file and takes it only if its bytes are that label; the link chooses which app is
 * opened, never whether it is trusted. Nothing is sent anywhere by printing it.
 */
export const HOLOSPACE_PAGE = 'https://hologram-technologies.github.io/holospace-shell/space.html';

const LABEL = /^blake3:[0-9a-f]{64}$/;

/** The holospace link for a holo named `address`, or null when `address` is not a BLAKE3 κ-label. */
export function holospaceLink(address) {
  return typeof address === 'string' && LABEL.test(address) ? `${HOLOSPACE_PAGE}#app=${address}` : null;
}

/** The report member for a built holo: the link, and the file the page asks for. Null when there is no link. */
export function holospaceOf(address, file) {
  const link = holospaceLink(address);
  return link && typeof file === 'string' && file.endsWith('.holo') ? { link, choose: file } : null;
}
