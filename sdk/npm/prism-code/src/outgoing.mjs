/**
 * What is checked of a holo before it leaves, with nothing of Node in it, so a page can make the same check.
 *
 * These two functions were `verify-closure.mjs`'s and `attest.mjs`'s. They are here because those modules also read
 * files and keys, which a page cannot load. Both still export them, so nothing that imported them changes.
 *
 * Nothing here reads the network or a file, and nothing here writes.
 */
import { parseArchive } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { sha256HexSync } from './sha256.mjs';
import { readAttestations } from './attestations.mjs';
import { SubjectMismatchError, VerificationError } from './errors.mjs';

/** The objects a bundle's subjects name must be in this holo, named by their κ; otherwise a typed error. */
export function checkSubjects(parsed, attestation) {
  for (const subject of attestation.subjects) {
    const blob = subject.blob === null ? null : parsed.blobs.find((b) => b.label === subject.blob);
    if (!blob) throw new SubjectMismatchError(`subject ${subject.name} is not a content blob of this holo`, { check: 'attestation.subject' });
    if (sha256HexSync(blob.content) !== subject.digest.sha256 || (subject.digest.blake3 !== undefined && blake3Hex(blob.content) !== subject.digest.blake3)) {
      throw new SubjectMismatchError(`subject ${subject.name} names ${subject.blob} but its digests are not the blob's`, { check: 'attestation.subject' });
    }
  }
}

/**
 * Push, step 1: nothing corrupt leaves this machine. The holo's footer and
 * labels verify, and every attestation's subjects are blobs of this holo.
 *
 * @param {Uint8Array} holo
 * @returns {{ parsed: object, attestations: object[] }}
 */
export function verifyOutgoing(holo) {
  const parsed = parseArchive(holo);
  if (!parsed.verification.footer || !parsed.verification.labels) {
    throw new VerificationError('the holo does not verify: its footer or a content label differs from the bytes', { check: 'holo.integrity' });
  }
  const attestations = readAttestations(parsed);
  for (const attestation of attestations) checkSubjects(parsed, attestation);
  return { parsed, attestations };
}
