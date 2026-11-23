/**
 * `push` and `pull`: move a holo and its attestations to and from an OCI registry
 * or a local directory store (issue #292, docs/proposals/292-push-pull-oci.md).
 *
 * Both ends implement one endpoint (`oci-registry.mjs`, `oci-store.mjs`), so
 * everything here works on either. `pull` holds everything in memory until every
 * check has passed, and only then writes.
 *
 * This file fetches and writes; it decides nothing about trust (#449). Every
 * check of what was fetched, and of what is about to leave, is `verify`'s, in
 * `verify-closure.mjs`, and every signature is an `auth` identity's.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asBytes } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { BUNDLE_MEDIA_TYPE } from './attestations.mjs';
import { auth } from './auth.mjs';
import { verifyHoloClaims, verifyPullClosure } from './verify-closure.mjs';
import { PUSH_SCHEMA, pushHolo, writeReferrers } from './push-core.mjs';
import { PrismCodeError, PullVerificationError, ReferenceInvalidError } from './errors.mjs';
import {
  ANNOTATION,
  EMPTY_BYTES,
  EMPTY_DESCRIPTOR,
  HOLO_MEDIA_TYPE,
  hexOf,
  holoLayerOf,
} from './oci-manifest.mjs';
import { formatReference, parseReference } from './oci-reference.mjs';
import { createRegistryClient, MAX_MANIFEST_BYTES } from './oci-registry.mjs';
import { dockerCredentials } from './oci-auth.mjs';
import { openStore } from './oci-store.mjs';

/** The most a pull accepts for one holo. */
export const MAX_HOLO_BYTES = 1024 * 1024 * 1024;
/** The most a pull accepts for one bundle. Keyless bundles are a few kilobytes plus their statement. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
/** A registry chooses what it lists; a pull reads this many referrers at most. */
const MAX_REFERRERS = 256;
export { PUSH_SCHEMA };
export const PULL_SCHEMA = 'prism/pull-result/1';

const decoder = new TextDecoder('utf-8', { fatal: true });
const short = (digest) => hexOf(digest).slice(0, 12);

/** The endpoint a reference names. */
export function openEndpoint(reference, options = {}) {
  if (reference.kind === 'store') return openStore(reference.path, { repository: reference.repository });
  return createRegistryClient(reference, {
    plainHttp: options.plainHttp,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    referrersFallback: options.referrersFallback,
    resolveCredentials: options.credentials !== undefined ? () => options.credentials : (registry) => dockerCredentials(registry, { env: options.env }),
  });
}

const referenceOf = (reference, options = {}) => (typeof reference === 'string' ? parseReference(reference, { store: options.store }) : reference);

const parseJson = (bytes, what) => {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw new PullVerificationError(`${what} is not UTF-8 JSON: ${cause.message}`, { check: 'pull.manifest', cause });
  }
};

/**
 * A manifest and its holo, fetched and checked against every digest that names
 * them, plus every referrer. Nothing here looks at policy.
 */
async function fetchClosure(endpoint, reference, options = {}) {
  const maxHoloBytes = options.maxHoloBytes ?? MAX_HOLO_BYTES;
  let address = reference.digest ?? reference.tag;
  if (reference.fingerprint) address = await endpoint.resolveFingerprint(reference.fingerprint);
  const { bytes: manifestBytes, digest } = await endpoint.getManifest(address);
  const manifest = parseJson(manifestBytes, `manifest ${digest}`);
  const layer = holoLayerOf(manifest);
  if (!layer) throw new PullVerificationError(`manifest ${digest} is not a holo: it must have exactly one layer of type ${HOLO_MEDIA_TYPE}`, { check: 'pull.manifest' });
  if (typeof layer.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0) {
    throw new PullVerificationError(`manifest ${digest} has an unusable holo layer descriptor`, { check: 'pull.manifest' });
  }
  if (layer.size > maxHoloBytes) throw new PullVerificationError(`the holo is ${layer.size} bytes, over the ${maxHoloBytes} byte bound`, { check: 'pull.size' });
  const holo = await endpoint.getBlob(layer.digest, layer.size);
  return { manifest, manifestBytes, digest, layer, holo, referrers: await fetchReferrers(endpoint, digest) };
}

/** Every referrer that is a Sigstore bundle, read and hashed. A descriptor that lies about its subject is dropped. */
async function fetchReferrers(endpoint, subject) {
  const listed = (await endpoint.listReferrers(subject)).filter((d) => typeof d?.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(d.digest));
  const out = [];
  for (const descriptor of listed.slice(0, MAX_REFERRERS)) {
    const { bytes, digest } = await endpoint.getManifest(descriptor.digest);
    if (bytes.length > MAX_MANIFEST_BYTES) continue;
    let manifest;
    try {
      manifest = JSON.parse(decoder.decode(bytes));
    } catch {
      continue;
    }
    if (manifest?.subject?.digest !== subject) continue;
    const layer = manifest.layers?.[0];
    if (manifest.layers?.length !== 1 || layer?.mediaType !== BUNDLE_MEDIA_TYPE || !Number.isSafeInteger(layer.size) || layer.size > MAX_BUNDLE_BYTES) continue;
    out.push({ manifest, manifestBytes: bytes, digest, layer, line: await endpoint.getBlob(layer.digest, layer.size), descriptor });
  }
  return out;
}

/** What `verify` judges of a fetched closure: the bytes, and what the manifest and the caller claim about them. */
const factsOf = (closure, reference) => ({
  holo: closure.holo,
  manifestDigest: closure.digest,
  claims: { fingerprint: closure.manifest.annotations?.[ANNOTATION.FINGERPRINT], blake3: closure.layer.annotations?.[ANNOTATION.BLAKE3] },
  asked: { fingerprint: reference.fingerprint },
  referrers: closure.referrers.map(({ digest, line }) => ({ digest, line })),
});

/** Write a closure to an endpoint: blobs first, then referrers, then the tag, so a tag never names something half there. */
async function writeClosure(endpoint, closure, tag) {
  await endpoint.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  await endpoint.putBlob(closure.layer.digest, closure.holo);
  await endpoint.putManifest(closure.digest, closure.manifestBytes);
  await writeReferrers(endpoint, closure.digest, closure.referrers);
  if (tag) await endpoint.tagManifest(tag, closure.manifestBytes);
}

async function atomicWrite(target, bytes) {
  const scratch = `${target}.pull-${process.pid}.tmp`;
  try {
    await writeFile(scratch, bytes);
    await rename(scratch, target);
  } finally {
    await rm(scratch, { force: true });
  }
}

/**
 * Pull a holo and verify it before anything is written.
 *
 * `output` is a file path, or a `dir://` reference to store it with all its
 * referrers; without one, nothing is written and the bytes are returned. `policy`
 * is a policy file path or a policy object, as `check` takes; the default accepts
 * P0, unless `PRISM_MINIMUM_LEVEL` says otherwise. The signer options are those of
 * `experimental_verifyAttestations`: with any of them, at least one bundle in the
 * holo or in the registry must pass, and the signed statements in the holo count
 * toward the level as they do in `check`. Without a signer a signed holo is P0.
 *
 * @param {string | object} source the reference
 * @param {object} [options] `{ store, output, policy, key, certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer, type, trustedRoot, entries, timestamps, plainHttp, credentials, fetch, env, maxHoloBytes, referrersFallback }`
 * @returns {Promise<object>} `prism/pull-result/1`, with `holo` the bytes
 */
export async function experimental_pull(source, options = {}) {
  const reference = referenceOf(source, options);
  const endpoint = openEndpoint(reference, options);
  const closure = await fetchClosure(endpoint, reference, options);
  // Steps 4 to 8 are verify's; nothing is written unless every one passed.
  const { fingerprint, attestations, verdict, signers } = await verifyPullClosure(factsOf(closure, reference), options);

  let output = null;
  if (typeof options.output === 'string' && options.output.startsWith('dir://')) {
    const destination = parseReference(options.output);
    if (destination.digest || destination.fingerprint) throw new ReferenceInvalidError('a store to pull into is named by a tag, not a digest', { check: 'reference.store' });
    await writeClosure(openEndpoint(destination), closure, destination.tag);
    output = options.output;
  } else if (typeof options.output === 'string') {
    output = resolve(options.output);
    await atomicWrite(output, closure.holo);
  }
  return {
    schema: PULL_SCHEMA,
    reference: formatReference(reference, closure.digest),
    digest: closure.digest,
    size: closure.layer.size,
    fingerprint,
    sha256: hexOf(closure.layer.digest),
    blake3: blake3Hex(closure.holo),
    verdict,
    attestations: { holo: attestations.length, referrers: closure.referrers.length, signatures: signers === null ? 'not checked' : 'verified', verified: signers ?? [] },
    output,
    holo: closure.holo,
  };
}

/** The holo's own attestations and any referrers already in a store being pushed from. */
async function readSource(source, options) {
  if (typeof source === 'string' && source.startsWith('dir://')) {
    const reference = parseReference(source);
    const closure = await fetchClosure(openEndpoint(reference), reference, options);
    verifyHoloClaims(factsOf(closure, reference));
    return { holo: closure.holo, carried: closure.referrers, carriedFor: closure.digest };
  }
  if (typeof source === 'string') {
    try {
      return { holo: new Uint8Array(await readFile(resolve(source))), carried: [], carriedFor: null };
    } catch (cause) {
      throw new PrismCodeError('load.path', `${source} cannot be read: ${cause.code ?? cause.message}`);
    }
  }
  return { holo: asBytes(source), carried: [], carriedFor: null };
}

/**
 * Push a holo: its layer and manifest, one referrer per attestation line, with a
 * signer one registry-facing statement per predicate, and finally its tags.
 *
 * `key` signs with a private key; `keyless: true` signs with an OIDC token, as
 * `attest` does. `noAttestations` pushes only the holo's manifest.
 *
 * @param {Uint8Array | ArrayBuffer | string} source the holo's bytes, a path, or a `dir://` reference
 * @param {string | object} target the reference
 * @param {object} [options] `{ store, key, keyless, noAttestations, signingConfig, identityToken, tufMirrorUrl, tufRoot, tufCache, plainHttp, credentials, fetch, env, referrersFallback, onProgress }`
 * @returns {Promise<object>} `prism/push-result/1`
 */
export async function experimental_push(source, target, options = {}) {
  const reference = referenceOf(target, options);
  if (reference.fingerprint) throw new ReferenceInvalidError('a push cannot name a BLAKE3 fingerprint: the fingerprint comes from the holo', { check: 'reference.digest' });
  const { holo, carried, carriedFor } = await readSource(source, options);
  // The steps are `pushHolo`'s (push-core.mjs), which a page calls too. What is Node's stays here: the source was
  // read above, the endpoint is opened and the signer made only when the steps reach them, as before.
  return pushHolo(holo, () => openEndpoint(reference, options), {
    reference,
    carried,
    carriedFor,
    noAttestations: options.noAttestations,
    onProgress: options.onProgress,
    signer: options.key !== undefined || options.keyless
      ? () => auth.identities.from({ key: options.key, identityToken: options.identityToken ?? (options.env?.SIGSTORE_ID_TOKEN || undefined), signingConfig: options.signingConfig, tufMirrorUrl: options.tufMirrorUrl, tufRoot: options.tufRoot, tufCache: options.tufCache })
      : null,
  });
}

export { short as shortDigest };
