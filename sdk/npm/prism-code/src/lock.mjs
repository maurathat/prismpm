/**
 * What `prismpm.lock` records about the builder a project was locked against. Pure text reading: nothing here
 * starts a program, and prism-code itself runs no builder image.
 */
import { fail } from './errors.mjs';

/** The admission test for an immutable builder image reference, NAME@sha256:DIGEST. */
export const SDK_IMAGE_PATTERN = /^[a-z0-9.-]+(:[0-9]{1,5})?\/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/;

/** Read `sdk_image` from a `prismpm.lock` text and admit only an immutable reference. */
export function sdkImageFromLock(lockText) {
  let image;
  try {
    image = JSON.parse(lockText).sdk_image;
  } catch {
    const match = /"sdk_image"\s*:\s*"([^"]*)"/.exec(lockText);
    image = match ? match[1] : undefined;
  }
  if (typeof image !== 'string' || !SDK_IMAGE_PATTERN.test(image)) {
    fail('lock.image', 'prismpm.lock does not select an immutable SDK image', { image });
  }
  return image;
}
