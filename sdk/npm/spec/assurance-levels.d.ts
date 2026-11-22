/**
 * Assurance levels P0 to P3 and the verdict of a check.
 * Design: docs/proposals/269-assurance-levels.md.
 * Schema: schemas/verdict/verdict-v1.schema.json.
 */

/** P0 unverified, P1 provenance, P2 proof checked, P3 proof, replay and world. */
export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

/** A level a failed check can withhold. P0 is never withheld. */
export type WithheldLevel = Exclude<AssuranceLevel, 'P0'>;

/** Evidence a level adds to the level below it. */
export type AssuranceEvidence = 'integrity' | 'provenance' | 'proof' | 'replay' | 'world';

/** One check that did not pass. */
export interface VerdictReason {
  /** Stable dotted check id, for example `proof.subject` or `policy.level`. */
  check: string;
  /** The registered diagnostic, for example `PP5503`, when one exists. */
  code?: string;
  /** The lowest level this failure withholds, or null when it withholds none. */
  withholds: WithheldLevel | null;
  /** One plain sentence for a person. Not part of the contract. */
  message: string;
}

/** The result of `prism check`, `holo.verify()` and `@prism-code/verify`. */
/** A claim reported beside the level, never a rung on it. */
export type AssuranceClaim = 'reproved' | 'sources';

/** Lean's kernel, run again by the verifier, on every theorem the holo's snapshot states. */
export interface ReprovedClaim {
  /** True only when the kernel accepted a proof of every theorem within its declared axioms just now. */
  passed: boolean;
  theorems: { name: string; status: 'proved' | 'refused' | 'unsupported'; axioms: string[] }[];
  /** The model the theorems were judged for. */
  semantic_id: string | null;
  /** The `blake3:` labels of the kernel and the base library that judged them. */
  kernel: string | null;
  library: string | null;
  /** Why it did not pass, or null. */
  reason: string | null;
}

/** Whether the holo's sources, run through LexLean by the verifier, give its snapshot. */
export interface SourcesClaim {
  present: boolean;
  /** null when the verifier did not run LexLean. */
  matchesSnapshot: boolean | null;
  semantic_id: string | null;
  /** The `blake3:` label of the LexLean that ran. */
  lexlean: string | null;
  reason: string | null;
}

export interface Verdict {
  schema: 'prism/verdict/1';
  /** The holo's archive fingerprint, `blake3:` and 64 lowercase hex characters. */
  holo: string;
  /** The level computed from the evidence. The policy never changes it. */
  level: AssuranceLevel;
  /** The policy the holo was judged against, the lowest level it accepts, and the claims it requires beside it. */
  policy: { name: string; minimum: AssuranceLevel; require?: AssuranceClaim[] };
  /** True when the policy accepts the holo. */
  passed: boolean;
  /** Present only when the verifier ran Lean's kernel again on the holo's carried snapshot. */
  reproved?: ReprovedClaim;
  /** Present when the holo carries a sources object, or the verifier ran LexLean on it. */
  sources?: SourcesClaim;
  /** Every check that did not pass, in evaluation order. Empty when every check passed. */
  reasons: VerdictReason[];
}

export declare const ASSURANCE: Readonly<{
  LEVELS: readonly ['P0', 'P1', 'P2', 'P3'];
  RANK: Readonly<{ P0: 0; P1: 1; P2: 2; P3: 3 }>;
  NAMES: Readonly<Record<AssuranceLevel, string>>;
  ADDS: Readonly<{
    P0: readonly [];
    P1: readonly ['integrity', 'provenance'];
    P2: readonly ['proof'];
    P3: readonly ['replay', 'world'];
  }>;
  CLAIMS: readonly ['reproved', 'sources'];
  CLAIM_NAMES: Readonly<{ reproved: 're-proved by the kernel'; sources: 'sources give the snapshot' }>;
  CLAIM_PREDICATES: Readonly<{ reproved: 'https://uor.foundation/prism/kernel-proof/v1' }>;
  PREDICATES: Readonly<{
    provenance: 'https://slsa.dev/provenance/v1';
    proof: 'https://uor.foundation/prism/proof/v1';
    replay: 'https://uor.foundation/prism/replay/v1';
  }>;
  DEFAULT_MINIMUM: 'P2';
  DEFAULT_POLICY: 'default';
  EXIT: Readonly<{ PASSED: 0; FAILED: 1; NO_VERDICT: 2 }>;
  VERDICT: 'prism/verdict/1';
  VERDICT_SCHEMA: 'schemas/verdict/verdict-v1.schema.json';
}>;
