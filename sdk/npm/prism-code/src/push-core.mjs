/**
 * `push`, as far as it needs no file, no key and no credential store: a holo's bytes go to an endpoint.
 *
 * `experimental_push` (push-pull.mjs) reads the holo from wherever it is, opens the endpoint, finds credentials and
 * signs; then it calls `pushHolo` here. A page calls `pushHolo` with bytes it already holds and an endpoint it made
 * with `createRegistryClient` (oci-registry.mjs). So there is one push, and its steps are these for both callers
 * (docs/proposals/292-push-pull-oci.md).
 *
 * Nothing in this module, or in what it imports, is Node's: no `node:` module, no file, no process.
 *
 * Experimental until the v0.6 freeze, as `experimental_push` is.
 */
import { blake3Hex } from './blake3.mjs';
import { verifyOutgoing } from './outgoing.mjs';
import { DigestMismatchError, ReferenceInvalidError } from './errors.mjs';
import {
  ANNOTATION,
  EMPTY_BYTES,
  EMPTY_DESCRIPTOR,
  MANIFEST_MEDIA_TYPE,
  fingerprintTag,
  hexOf,
  holoManifest,
  referrerManifest,
  registryStatements,
} from './oci-manifest.mjs';
import { formatReference } from './oci-reference.mjs';

export const PUSH_SCHEMA = 'prism/push-result/1';

const encoder = new TextEncoder();

/** Put referrers and record, in the tag schema's index, any the endpoint did not index. Their bytes do not change. */
export async function writeReferrers(endpoint, subject, referrers) {
  const unindexed = [];
  for (const referrer of referrers) {
    await endpoint.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
    await endpoint.putBlob(referrer.layer.digest, referrer.line);
    const { indexed } = await endpoint.putManifest(referrer.digest, referrer.manifestBytes);
    if (!indexed) unindexed.push(referrer.descriptor);
  }
  await endpoint.attachReferrers(subject, unindexed);
}

/**
 * Push one holo to an endpoint.
 *
 * @param {Uint8Array} holo the holo's bytes
 * @param {object | (() => object)} endpoint an endpoint (`putBlob`, `putManifest`, `attachReferrers`, `tagManifest`),
 *   or a function giving one, called only after the holo has been checked and its manifest agrees with the reference
 * @param {object} options
 * @param {object} options.reference the parsed reference pushed to (`parseReference`)
 * @param {boolean} [options.noAttestations] leave the holo's attestations where they are
 * @param {() => { sign: (bytes: Uint8Array) => Promise<object> }} [options.signer] gives what signs the statements
 *   about the registry; with none, nothing is signed here
 * @param {object[]} [options.carried] referrers a store already held for a manifest, to travel with it
 * @param {string} [options.carriedFor] the digest of the manifest `carried` belongs to
 * @param {(event: object) => void} [options.onProgress]
 * @returns {Promise<object>} a `prism/push-result/1`
 */
export async function pushHolo(holo, endpoint, { reference, noAttestations = false, signer = null, carried = [], carriedFor = null, onProgress } = {}) {
  if (reference.fingerprint) throw new ReferenceInvalidError('a push cannot name a BLAKE3 fingerprint: the fingerprint comes from the holo', { check: 'reference.digest' });
  const progress = onProgress ?? (() => {});

  // Step 1: nothing corrupt leaves this machine, as verify judges it.
  const { parsed, attestations } = verifyOutgoing(holo);

  const built = await holoManifest(parsed);
  const { digest, bytes: manifestBytes, descriptor, layer, fingerprint } = built;
  if (reference.digest && reference.digest !== digest) {
    throw new DigestMismatchError(`the reference names ${reference.digest}, and this holo's manifest is ${digest}`, { check: 'digest.push' });
  }

  const to = typeof endpoint === 'function' ? endpoint() : endpoint;
  // Step 2 and 3: the blobs, then the manifest by digest.
  await to.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  // A holo v6 is named by its κ, `blake3:` (ADR-018 §3): kappa-registry stores the layer under that address too.
  const uploaded = await to.putBlob(layer.digest, holo, parsed.format === 6 ? { also: parsed.kappa } : {});
  progress({ action: uploaded ? 'Pushed' : 'Layer already exists', digest: layer.digest });
  await to.putManifest(digest, manifestBytes);

  // Step 4: the referrers.
  const referrers = [];
  const pending = [];
  if (!noAttestations) {
    for (const attestation of attestations) {
      const { manifest, bytes, digest: referrerDigest, layer: bundleLayer, descriptor: bundleDescriptor } = await referrerManifest(attestation.bytes, descriptor, attestation.predicateType);
      pending.push({ manifest, manifestBytes: bytes, digest: referrerDigest, layer: bundleLayer, line: attestation.bytes, descriptor: bundleDescriptor });
      referrers.push({ digest: referrerDigest, predicateType: attestation.predicateType, source: 'holo', signed: attestation.signed });
    }
    if (signer) {
      const signs = signer();
      for (const statement of registryStatements(attestations, digest)) {
        const signed = await signs.sign(encoder.encode(JSON.stringify(statement)));
        const line = encoder.encode(JSON.stringify(signed));
        const { manifest, bytes, digest: referrerDigest, layer: bundleLayer, descriptor: bundleDescriptor } = await referrerManifest(line, descriptor, statement.predicateType);
        pending.push({ manifest, manifestBytes: bytes, digest: referrerDigest, layer: bundleLayer, line, descriptor: bundleDescriptor });
        referrers.push({ digest: referrerDigest, predicateType: statement.predicateType, source: 'push', signed: true });
      }
    }
    // What a store already held for this manifest travels with it, bytes unchanged.
    const known = new Set(pending.map((p) => p.digest));
    if (carriedFor === digest) {
      for (const referrer of carried) {
        if (known.has(referrer.digest)) continue;
        known.add(referrer.digest);
        pending.push(referrer);
        referrers.push({ digest: referrer.digest, predicateType: referrer.manifest.annotations?.[ANNOTATION.BUNDLE_PREDICATE] ?? null, source: 'store', signed: true });
      }
    }
    await writeReferrers(to, digest, pending);
    for (const { digest: referrerDigest, predicateType, source: from } of referrers) progress({ action: from === 'push' ? 'Signed' : 'Attached', digest: referrerDigest, predicateType });
  }

  // Step 5: the tags, last, so a tag never names a holo whose attestations are on the way.
  const tags = [];
  if (reference.tag && !reference.digest) tags.push(reference.tag);
  // A legacy v4 or a v6 holo gets a tag for its BLAKE3 fingerprint; a holo v5 is already addressed by its κ, the layer digest.
  if (reference.kind === 'registry' && fingerprint.startsWith('blake3:')) tags.push(fingerprintTag(fingerprint));
  for (const tag of tags) await to.tagManifest(tag, manifestBytes);

  return {
    schema: PUSH_SCHEMA,
    reference: formatReference(reference, digest),
    repository: reference.kind === 'registry' ? `${reference.registry}/${reference.repository}` : reference.repository ?? `dir://${reference.path}`,
    tag: reference.digest ? null : reference.tag,
    digest,
    mediaType: MANIFEST_MEDIA_TYPE,
    size: manifestBytes.length,
    layer: { digest: layer.digest, size: layer.size, uploaded },
    fingerprint,
    sha256: hexOf(layer.digest),
    blake3: blake3Hex(holo),
    tags,
    referrers,
  };
}
