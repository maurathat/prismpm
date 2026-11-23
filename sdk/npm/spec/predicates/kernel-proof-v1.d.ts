/**
 * The kernel-proof predicate `https://uor.foundation/prism/kernel-proof/v1` (ADR-018).
 *
 * Schema: `predicates/kernel-proof-v1.schema.json`, `$id`
 * `https://uor.foundation/prism/kernel-proof/v1/schema.json`. This type states
 * the schema exactly; a test compares their members.
 *
 * The statement is an in-toto Statement v1 in a holo v6's attestations
 * object, written unsigned. Its subjects are the model document and the
 * semantic snapshot, and the sources object when present, each named by
 * blake3 and sha256. It records what a build judged; a verifier grants the
 * `reproved` claim only when the kernel, run again, accepts every proof.
 */
export declare const KERNEL_PROOF_PREDICATE_TYPE: 'https://uor.foundation/prism/kernel-proof/v1';

/** The kernel's verdict on one theorem. */
export interface KernelProofTheorem {
  /** The theorem's fully qualified name in the snapshot. */
  name: string;
  /** `proved`: accepted within its declared axioms. `refused`: rejected. `unsupported`: a proof kind this build does not prove. */
  status: 'proved' | 'refused' | 'unsupported';
  /** The axioms the accepted proof uses, sorted. Empty unless proved. */
  axioms: string[];
}

export interface KernelProofPredicateV1 {
  /** LexLean's semantic_id of the snapshot judged, 64 lowercase hex. */
  semantic_id: string;
  /** The `blake3:` label of the Lean kernel module that judged the proofs. */
  kernel: string;
  /** The `blake3:` label of the base library the kernel loaded. */
  library: string;
  /** The `blake3:` label of the code that lowered the snapshot and found the proofs. */
  lowering: string;
  /** Every theorem the snapshot states, each once, sorted by name. */
  theorems: KernelProofTheorem[];
}
