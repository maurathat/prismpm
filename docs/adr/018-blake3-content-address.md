# ADR-018: BLAKE3 Is the Content Address of Every Prism App

## Status
Proposed, 2026-11-21. Supersedes ADR-017 §3 and §4. It amends ADR-017 §1 by adding profile 2, BLAKE3-sealed. ADR-017's roles and its §5 to §7 stand. Holo v5 stays readable.

## Context
- ADR-017 made κ `sha256:` because UOR, LexLean and Foundry were moving to it. Prism has since gone the other way. These all name bytes by plain BLAKE3: prism-code's push bundle (`prism/app-bundle/1`), the pinned LexLean and Lean-kernel WebAssembly, the address `prism_build` reports, kappa-registry's blob paths (`blobs/blake3/…`) and Hologram (`hologram-archive` `address_bytes`, holo v4). The Holospace shell's store does too.
- Only holo v5 and a few pins still use SHA-256. So the same object has one name inside a holo and another everywhere else.
- Outside tools still need SHA-256:
  - OCI image-spec v1.1.1 registers sha256 and sha512. `blake3` is on `main` only (PR #1240).
  - go-containerregistry, which cosign uses, hashes sha256 and sha512 only.
  - Sigstore `HashAlgorithm` and Rekor `hashedrekord` have no BLAKE3.
  - in-toto DigestSet has no `blake3` key, and its consumers "MUST ignore unrecognized" algorithms.
- Measured in Node 22, on `Calculator.v5.holo` (23,885 bytes): UORC-SHA256-CHAIN-v1 costs 2.3 ms in JavaScript, and BLAKE3 0.6 ms.

## Decision
1. **κ.** Every content address Prism writes, stores, pins, pushes or compares is `blake3:` followed by the 64 lowercase hex digits of unkeyed BLAKE3, with a 256-bit output, over the exact bytes named.
2. **Holo v6.** Holo v6 is the raw self-contained UORC archive of ADR-017 §1 with profile byte 2:

   ```text
   "UORC" 02 02 | scope 00 | representation 00 | uleb(count) | uleb(length)* | uleb(bodyLength) | body | seal[32]
   ```

   - The seal is plain BLAKE3 of every byte before it. It authenticates nothing, because anyone who changes the bytes can recompute it. A name held elsewhere authenticates a holo. So the seal needs no domain separation, and it is computed as Hologram computes a v4 footer.
   - The roles are ADR-017 §2's. The manifest's schema is `prism/holo/6` and the provenance's is `prismpm/model-provenance/3`. Both are v5's documents with every κ a `blake3:` label.
   - The holo's identity is the κ of its file.
3. **SHA-256 only at the boundary.**
   - An OCI descriptor's digest is `sha256`, computed when the holo is pushed. The κ travels in the annotation `foundation.uor.prism.digest.blake3`.
   - A push to kappa-registry also stores the blob under its κ (`?also=`).
   - Sigstore message digests are SHA-256.
4. **Digest sets.**
   - An in-toto subject for an object of a v6 holo is `{ "blake3": <hex>, "sha256": <hex> }` over the same bytes. A verifier requires both, checks both, and fails on a mismatch in either.
   - A subject that names an OCI manifest is `sha256` alone.
5. **Pins.** The following are pinned by κ: the Holospace kernel holo, the evaluator guest, the LexLean and Lean-kernel modules, the IDE's gate files, and the keys of the proof store.
6. **Version policy.**
   - Writers emit v6.
   - Readers accept v4, v5 and v6, and refuse any other profile.
   - `upgrade_application` re-emits a v4 or v5 holo as v6. Every content object keeps its bytes; only the manifest, the provenance and the seal change.
   - Statements about an older holo keep the rules of its format: ADR-015 for v4, ADR-017 for v5.
7. **Not here.** LexLean's `semantic_id`, `source_id` and snapshot id are LexLean's to change. Until it does, provenance records them as they are, beside the κ of the same bytes.

## Implementation order
Each step ends in a gate.

1. The container: `src/uorc.mjs` and `holo/v5.rs` write and read profile 2. Gate: shared vectors (`tests/data/holo-v6-container.json`) give the same bytes in both, and a changed byte is refused in both.
2. The readers: `archive.mjs`, `@prism-code/verify` (`holo5.mjs`), `archive.rs` and `inspect/verdict_v5.rs` read v6, and the spec and schemas gain the v6 documents. Gate: v6 twins of the v5 fixtures verify, and the v5 fixtures' recorded inspections are unchanged.
3. The writers and `upgrade_application`. Gate: JavaScript and Rust emit byte-identical v6 for Calculator and PaymentApproval.
4. Signing and OCI. Gate: the ADR-015 tool run (oras, cosign, Kyverno) on a signed v6 holo, and a pull from kappa-registry by κ.
5. The pins and the Holospace shell, then the republished apps.

## Consequences
- **UOR-Foundation/compression:** profile 2 must be registered upstream, with vectors. Until it is, `uorc verify` refuses a v6 holo by its magic and never misreads it. A holo v6 opens only in Prism readers.
- **Identity break, once:** every app rebuilt as v6 has new bytes and a new identity. Content objects keep their bytes.
- **Security:** BLAKE3 is not FIPS-approved. A party that requires FIPS verifies by the `sha256` key that every subject still carries.

## Open questions
1. Will compression register profile 2, or prefer a seal identifier elsewhere in its header?
2. For how many releases do readers keep accepting v5?
