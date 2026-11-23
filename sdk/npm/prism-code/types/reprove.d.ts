/**
 * prism-code/reprove: a holo's proof record, checked again from the holo alone (ADR-018). Experimental until the
 * v0.6 freeze, with the claims it serves. It loads nothing of Node, so a page loads it.
 *
 * A holo v6 that `prism-code build` writes carries its model's semantic snapshot, the sources LexLean read and one
 * unsigned kernel-proof statement. The statement is a record, never evidence: `reprove` runs Lean's kernel on the
 * carried snapshot, and `relex` runs LexLean on the carried sources. Both are the functions `experimental_verify`
 * takes as `reprove` and `relex`, once the caller has bound the kernel and LexLean.
 */

/** The predicate type of the statement a build writes: `https://uor.foundation/prism/kernel-proof/v1`. */
export const KERNEL_PROOF_PREDICATE_TYPE: 'https://uor.foundation/prism/kernel-proof/v1';

/** Lean's kernel's verdict on one theorem, as a kernel-proof statement and a re-proof name it. */
export interface KernelProofTheorem {
  /** The theorem's fully qualified name in the snapshot. */
  name: string;
  /** `proved`: accepted within its declared axioms. `refused`: not accepted. `unsupported`: no proof of that kind is found here, so nothing was judged. */
  status: 'proved' | 'refused' | 'unsupported';
  /** The axioms the accepted proof uses, sorted. Empty unless proved. */
  axioms: string[];
}

/** What a re-proof answers: the `reproved` member of a verdict. */
export interface ReprovedResult {
  /** True only when the kernel just accepted a proof of every theorem the holo's snapshot states, and the holo's statement and snapshot are its own. */
  passed: boolean;
  /** What the kernel answered now, never what the holo's statement says. */
  theorems: KernelProofTheorem[];
  semantic_id: string | null;
  /** The `blake3:` label of the kernel that ran. */
  kernel: string | null;
  /** The `blake3:` label of the library it loaded. */
  library: string | null;
  /** Null when it passed; otherwise the first thing that failed. */
  reason: string | null;
}

/** What reading the sources again answers: it fills the `sources` member of a verdict. */
export interface RelexResult {
  /** True only when LexLean, reading the carried sources and nothing else, writes the carried snapshot's exact bytes. */
  matchesSnapshot: boolean;
  /** The semantic_id LexLean gave now. */
  semantic_id: string | null;
  /** The `blake3:` label of the LexLean that ran. */
  lexlean: string | null;
  reason: string | null;
}

/** Lean's kernel, opened, as `openKernel` resolves it; `labels` names its module and its library. */
export interface OpenKernel {
  check(text: string): { exit: number; axioms: Record<string, string[]>; output: string };
  labels?: { kernel: string; library: string };
  [member: string]: unknown;
}

/** LexLean's front end: its compiled module, and the `blake3:` label it was admitted by. */
export interface LexLeanModule {
  module: WebAssembly.Module;
  kappa: string;
}

/**
 * Run Lean's kernel again on the snapshot a holo carries. `kernel` is the kernel, opened, or a function that
 * resolves it, called only for a holo that carries something to judge. Never throws for a holo it cannot judge.
 */
export function reprove(holo: Uint8Array | ArrayBuffer, options: { kernel: OpenKernel | (() => Promise<OpenKernel>) }): Promise<ReprovedResult>;

/**
 * Run LexLean again on the sources a holo carries. `lexlean` is its module and label, or a function that resolves
 * them, called only for a holo that carries sources and a snapshot. Never throws for a holo it cannot judge.
 */
export function relex(holo: Uint8Array | ArrayBuffer, options: { lexlean: LexLeanModule | (() => Promise<LexLeanModule>) }): Promise<RelexResult>;

/** What of a proof record a holo carries. A holo that does not read carries none. */
export function proofRecordOf(holo: Uint8Array | ArrayBuffer): { statement: boolean; snapshot: boolean; sources: boolean };

/** The kernel's verdict on a snapshot's theorems, as a build records it. */
export interface KernelProofRecord {
  semantic_id: string;
  kernel: string;
  library: string;
  lowering: string;
  theorems: KernelProofTheorem[];
}

/** The in-toto Statement v1 a build writes for `record`: its subjects are the holo's model document, snapshot and sources. */
export function proofStatement(holo: Uint8Array | ArrayBuffer, record: KernelProofRecord): { _type: string; subject: object[]; predicateType: string; predicate: KernelProofRecord };

/** The holo with its kernel-proof statement, unsigned, in its attestations object. The input is not modified. */
export function withProofRecord(holo: Uint8Array | ArrayBuffer, record: KernelProofRecord): Uint8Array;
