# One canonical, serverless, Docker-free way to build a verified Prism app

Status: draft. Running record: [canonical-serverless-build/VERIFICATION.md](canonical-serverless-build/VERIFICATION.md).

## Why

Today a Prism app has two sources, `prism/spec.json` and a LexLean model, and two ways to be proved: the SDK image (Docker, about 21 GB) or, for rule apps only, Lean's kernel as WebAssembly (#694). Two paths mean two sets of guarantees to keep equal, and the Docker path cannot run in a visitor's browser. One path removes that.

## The one path

An app is a `UOR-Foundation/template` project. Its source of truth is its LexLean model. Every stage below is pure, keyed by content address, and skipped when its output already exists.

Author, check, key, reuse, produce, kernel, guest, seal, publish, self-verify, compound.

`spec.json` becomes a starter generator: it writes the first LexLean module for common shapes and then stops being read.

## A correction to the brief, and why

The brief asks for a rule that "lets a stored proof stand in for the kernel". PR #713 reverted exactly that (`3689e6d6`): carrying a verdict across runs breaks the rule that "proved" means the kernel accepted the term now. This proposal keeps the compounding and drops the stand-in. A stored proof stands in for producing the term, never for judging it. The kernel re-judges every reused term; at 58 to 163 ms per project in a tab, that fits every budget. The model states this as `provedNeedsKernelNow`.

## What is proved, compiled, tested and measured

Proved: a rule Lean 4.32.1 accepted, in `model/canonical-build`. Compiled: JavaScript that is the model's definitions one for one, held to them by a test that evaluates the model's own text on generated inputs. Tested: behavior covered by a test or planted defect only. Measured: a number with its command and machine.

## Phases

Each phase lands only when every gate passes and its planted defects are refused.

### Phase 1. The rules, stated and proved

Work: `model/canonical-build` in LexLean states four rules. A holo is admitted only if its `semantic_id` recomputes from its sources. A proof is reused only under equal derivation key, kernel, library, statement and exact axiom policy. A theorem is proved only when the kernel accepted the bound term in this run. The uncovered-form fallback yields terms, never verdicts. `src/journey/canonical-rules.mjs` follows the model one for one; `kernelProve` stops treating reuse as acceptance.

Gates: `lexlean verify --all` passes; the model test evaluates the model text against the JavaScript on generated inputs; planted defects refused: altered source with the old seal, forged proof for another statement, stored proof under a changed library, weaker axiom policy, reused term not re-judged.

### Phase 2. The serverless boundary

Work: every network read in a build goes through one guard with an allow list (the pinned kernel host, the public proof store, the user's own GitHub). Anything else fails with `build.host-not-allowed`. The public proof store is read by plain GET, and every byte is re-derived before use. Publishing to it is not built until the user approves a store.

Gates: planted defects refused: a build that reaches a non-allowed host; a store answer whose bytes do not match their label; a tampered kernel or library bundle. Bytes and hosts per build are reported.

Budgets: bytes and hosts per build.

### Phase 3. Check in WebAssembly

Work: LexLean's Rust front end compiled to `wasm32` and run in Node and the browser, producing diagnostics and `lexlean/semantic-snapshot/2`. Per-theorem address in the snapshot (upstream). Upstream LexLean PR.

Gates: snapshot bytes equal to native `lexlean` on the three briefs; `semantic_id` equal.

Budgets: check after an edit under 1 s; WASM size inside the 10 MB first-run total.

### Phase 4. In-process producers

Work: consume LexLean #561 producers (reflexivity, decide, cases, induction, apply, law) as pinned WASM. Uncovered forms go only to the user's own Actions run, whose terms come back content-addressed and are judged locally.

Gates: every produced term judged by the WASM kernel; uncovered share reported per build.

Budgets: edit to verdict under 500 ms when reused or produced in-process.

### Phase 5. Seal and self-verify

Work: holo fingerprint is `semantic_id` plus kernel, library and compiler addresses. The page recomputes `semantic_id`, re-judges every proof, replays vectors, and refuses on mismatch.

Gates: planted defect: a page served with one guarantee altered is refused. Budgets: page ready under 3 s.

### Phase 6. Guest without a toolchain

Work: measure three options (LexLean emits WASM; pinned guest built by the user's Actions; prebuilt guest per model shape) and recommend one.

Taken: one prebuilt evaluator guest for every text application, with the model's program attached as data, so nothing is compiled for an app. Record: [canonical-serverless-build/PHASE-6.md](canonical-serverless-build/PHASE-6.md).

### Phase 7. Canonical surface and end-to-end briefs

Work: `setup`, the `prism` MCP, the skill and the docs describe only this path. Run leap year, shopping cart and booking calendar end to end, then a verdant-sized slice.

Budgets: `setup` under 60 s and under 10 MB; reuse rate on the second and tenth app.

## Ask first

Creating a public repository or release, publishing to a shared proof store, or anything outside a draft PR.
