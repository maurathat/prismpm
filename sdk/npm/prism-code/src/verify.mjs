/**
 * `holo.verify()`: the verdict `prism check` and `@prism-code/verify` return,
 * as a call of this package (issue #276, design in
 * docs/proposals/269-assurance-levels.md).
 *
 * The checks are @prism-code/verify's own, vendored as one file
 * (src/vendor/verify.mjs), so the three tools cannot disagree. The level is
 * computed from the evidence in the holo and never raised by an option: a
 * holo with no attestation bundle is P0 whatever the policy says.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix
 * (STABILITY.md).
 */
import { ASSURANCE, VerifyError, verify as verifyBytes } from './vendor/verify.mjs';
import { VerificationError, classForCheck, errorFromVerdict } from './errors.mjs';
import { parseArchive } from './archive.mjs';
import { attestationSection, readAttestations, stripAttestations, ATTESTATION_EXTENSION } from './attestations.mjs';

/** The environment variable that sets the client's minimum assurance level, P0 to P3. */
export const MINIMUM_LEVEL_ENV = 'PRISM_MINIMUM_LEVEL';

const OPTION_KEYS = ['name', 'rego', 'minimum', 'digests', 'world', 'capabilities', 'effects', 'replay', 'require', 'throw', 'env', 'reprove', 'relex'];

function defined(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') throw new VerificationError('verify options must be an object', { check: 'policy.invalid' });
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new VerificationError(`unknown verify option ${key}; expected ${OPTION_KEYS.join(', ')}`, { check: 'policy.invalid' });
    }
  }
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

/**
 * Why a holo with an attestation section has no verdict yet, or null. The
 * section joins a format revision only when the wire model change of #267
 * merges; until then every reader refuses it, and a pass would be invented.
 * `check` and a container's gate both ask this first, so they cannot disagree.
 */
export function attestationBlocker(bytes) {
  // Statements that are all unsigned are records, and the holo is judged without them (`recordsOnly`).
  if (recordsOnly(bytes)) return null;
  let section;
  try {
    section = attestationSection(parseArchive(bytes));
  } catch {
    return null;
  }
  if (!section) return null;
  return new VerificationError(
    `the holo carries an attestation section (${ATTESTATION_EXTENSION}), which joins a format revision only when the wire model change of #267 merges; no reader can judge its statements until then`,
    { check: 'format.revision' },
  );
}

/**
 * A sealed holo v5 or v6 whose every statement is unsigned, as `{ bytes, holo }`: the holo without its statements,
 * and the κ of the file as given; or null for any other holo. An unsigned statement is a record, such as the
 * kernel-proof statement a build writes (ADR-018): no verifier accepts it as evidence, and it has no signature to
 * check. So such a holo is judged as the holo without them, which is what its seal and its statements' subjects
 * name object by object, and the level it reaches is the one its own bytes support. A holo with a signed statement
 * is not this: `check` judges it, with the signer the caller names. A holo whose seal does not match is not this
 * either: taking its statements off would write a new seal over the damage.
 */
function recordsOnly(bytes) {
  try {
    const parsed = parseArchive(bytes);
    if (!(parsed.format >= 5) || !parsed.verification.seal || !attestationSection(parsed)) return null;
    const statements = readAttestations(parsed);
    if (statements.length === 0 || statements.some((statement) => statement.signed)) return null;
    return { bytes: stripAttestations(parsed), holo: parsed.kappa };
  } catch {
    return null;
  }
}

function environment(env) {
  if (env) return env;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * Options by precedence: the environment, then the client's options, then the
 * call's. A member given later replaces the same member given earlier whole;
 * `digests` is not merged per target, and `world` replaces whole.
 */
export function resolveOptions(client, call) {
  const merged = { ...defined(client), ...defined(call) };
  const fromEnvironment = environment(merged.env)[MINIMUM_LEVEL_ENV];
  // A Rego policy states its own minimum, and an environment variable must not lower it.
  if (merged.rego === undefined && merged.minimum === undefined && fromEnvironment !== undefined && fromEnvironment !== '') {
    if (!ASSURANCE.LEVELS.includes(fromEnvironment)) {
      throw new VerificationError(`${MINIMUM_LEVEL_ENV} is ${JSON.stringify(fromEnvironment)}; expected one of ${ASSURANCE.LEVELS.join(', ')}`, {
        check: 'policy.invalid',
      });
    }
    merged.minimum = fromEnvironment;
  }
  const { throw: throwOnFail = false, env, ...policy } = merged;
  return { policy, throwOnFail };
}

async function bytesOf(source) {
  if (source && typeof source === 'object' && source.kind === 'closure') {
    throw new VerificationError('verify reads a .holo archive; a closure has no footer or section table', { check: 'verify.kind' });
  }
  if (source && typeof source === 'object' && source.kind === 'holo' && source.archive?.bytes) return source.archive.bytes;
  if (typeof Blob !== 'undefined' && source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  return source;
}

/**
 * Check a holo and return its verdict, a `prism/verdict/1` object.
 *
 * With `throw: true`, a verdict that did not pass is thrown as the typed
 * error that explains it, carrying the whole verdict. A call that cannot
 * reach a verdict at all (not a holo, an unknown format revision, an invalid
 * policy) always throws a `VerificationError`.
 *
 * @param {Uint8Array | ArrayBuffer | Blob | object} source the holo as bytes, a Blob, or a holo opened with `load`
 * @param {{ name?: string, rego?: string, minimum?: string, digests?: object, world?: object | null, require?: string[], throw?: boolean, env?: object, reprove?: Function, relex?: Function }} [options] `rego` is the source of a Rego policy (#285), which decides alone; `reprove(holoBytes)` and `relex(holoBytes)` run Lean's kernel and LexLean again for the `reproved` and `sources` claims
 */
export function experimental_verify(source, options = undefined, clientOptions = undefined) {
  return judged(source, options, clientOptions);
}

/**
 * A verdict that counts `statements`, whose signatures the caller has already
 * checked: `{ provenance, proof }`, each `{ statement, envelope: { verified } }`.
 * `envelope.verified` is taken as given, so this is `check`'s alone and is not
 * exported from the package. An option can never carry evidence: a caller could
 * write its own envelope and raise the level with no signature anywhere.
 */
export function verifyWithStatements(source, options, statements) {
  return judged(source, options, undefined, statements);
}

async function judged(source, options, clientOptions, statements = undefined) {
  const { policy: resolved, throwOnFail } = resolveOptions(clientOptions, options);
  // The claims' checks run in the caller's functions, never as part of the policy (ASSURANCE.CLAIMS).
  const { reprove, relex, ...policy } = resolved;
  let verdict;
  try {
    // A holo whose statements are all unsigned is judged without them, by the verifier itself (`recordsOnly`).
    verdict = await verifyBytes(await bytesOf(source), statements === undefined ? policy : { ...policy, statements }, { reprove, relex });
  } catch (error) {
    if (error instanceof VerifyError) throw new (classForCheck(error.code))(error.message, { check: error.code, cause: error });
    throw error;
  }
  if (throwOnFail) {
    const error = errorFromVerdict(verdict, ASSURANCE.RANK);
    if (error) throw error;
  }
  return verdict;
}

/**
 * A client with options of its own. The minimum level defaults to the
 * `PRISM_MINIMUM_LEVEL` environment variable; the client's options replace
 * that, and the options of one call replace the client's.
 *
 * @param {{ name?: string, minimum?: string, digests?: object, world?: object | null, throw?: boolean, env?: object }} [options]
 */
export function experimental_createClient(options = undefined) {
  const client = Object.freeze({ ...defined(options) });
  return Object.freeze({
    options: client,
    verify: (source, callOptions = undefined) => experimental_verify(source, callOptions, client),
  });
}
