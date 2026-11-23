# The template contract

Every Prism app starts from the canonical template, which keeps `uor/template-contract/2`, the standalone frame: six rules, R1 to R6, the registers that make them checkable, and the universal policy that binds them. Nothing in it needs a container, a toolchain or a workflow: `prism-code` checks all of it in its own process. The template's `TEMPLATE-CONTRACT.md` is the normative text. This page says what the rules ask of an author.

`prism-code check`, `build` and `verify` judge the LexLean model, its theorems and its acceptance vectors. When the workspace has `model/ids.toml`, they also run the contract's ratchet over the registers, the scenarios and the universal policy, and a violation fails the gate with exit 1.

## The rules

| Rule | What it asks |
| --- | --- |
| R1 | One authoritative model. Behavior is authored in the LexLean modules; `CONFORMANCE.md` is generated from the register by `prism-code build`, never edited by hand. |
| R2 | Claim tiers stay apart: *imported* from a named authority, *built* by proof, *open* as a measurement. |
| R3 | Register and specify first: an identifier and its scenario exist before the behavior does, and a *built* identifier names the theorems that prove it. |
| R4 | No stubs: no `sorry`, no undeclared axiom, no placeholder, no flag hiding unfinished work. |
| R5 | Registered public failures: every refusal is registered with the exact response it answers, a rejecting scenario, and an acceptance vector answered with it. |
| R6 | Locked dependencies: every import resolves through a committed lockfile pinned by digest. |

## The registers

- `model/ids.toml`, `spec = "template/2"`: every conformance ID the workspace holds, as `[[id]]` rows with `id`, `suite`, `level` and `statement`. The level is `some-true` (reproduced from an authority), `build` (constructed here and proved by Lean's kernel) or `open` (measured, never asserted). A `build` row has `theorems`, each a theorem of the model as `Module.name`. A row that specifies a public failure has `failure`, the exact response the app refuses with, and `negative`, the `build` row whose theorems prove the refusal's condition (often the row itself).
- `model/authorities.toml`: what the workspace cites instead of proving, as `[[authority]]` rows. `realized_by` lists the IDs that are evidence for it.
- `model/ledger.toml`: the claims that are not conformance IDs, as `[[claim]]` rows with `id`, `level`, `statement` and, for `some-true`, the `authority` it cites.
- `features/suites/*.feature`: one scenario for each ID, tagged `@ID @level`, and also `@rejects` for a row with `failure`.
- `template.lock`: every universal policy file (`AGENTS.md`, `VERIFICATION.md`, `template-contract.json`) by the BLAKE3 label of its bytes.

Read the files a workspace already has for their exact shape, and follow it. Do not invent a member. A workspace whose `model/ids.toml` says `spec = "template/1"` keeps contract 1: a test named for each ID in place of `theorems`, and no `failure` rows.

## What the ratchet refuses

| Code | Rule | What is wrong |
| --- | --- | --- |
| `contract.conformance` | R1 | `CONFORMANCE.md` is not what the register generates. Run `prism-code build`, which writes it; never edit it by hand. |
| `contract.level` | R2 | A level is not `some-true`, `build` or `open`, or a scenario is tagged another level than its ID has. |
| `contract.authority` | R2 | A `some-true` claim cites an authority the workspace does not name, or an authority is realized by an ID that is not there. |
| `contract.duplicate` | R2 | One ID has two rows, in one register or across them. |
| `contract.unspecified` | R3 | A registered ID has no scenario. |
| `contract.unregistered` | R3 | A scenario is tagged with an ID the register does not hold. |
| `contract.untested` | R3 | A `build` ID names no theorem. |
| `contract.theorem-unstated` | R3 | A `build` ID names a theorem the model does not state. |
| `contract.theorem-unproved` | R3 | A `build` ID names a theorem Lean's kernel did not prove within its declared axioms. |
| `contract.rejects-scenario` | R5 | A failure's scenario is not tagged `@rejects`. |
| `contract.negative` | R5 | A failure's `negative` is not a registered `build` ID, or the failure is not the text of a refusal. |
| `contract.refusal-unreplayed` | R5 | No acceptance vector is answered with exactly the failure's text. |
| `contract.policy-drift` | | A universal policy file does not have the label `template.lock` binds. It changes only with a template release. |
| `contract.artifact` | R6 | An authority's committed artifact is missing, or its recomputed SHA-256 is not the checksum its row records. |
| `contract.spec` | | The register names a template spec this prism-code does not read. |
| `contract.register` | | A register cannot be read. |

R4 and R6 are the model check's: no stub, no undeclared axiom, locked imports.

## What an author does

1. Register the identifier, then write its scenario, then change the model; name the theorem that proves it in the row.
2. Register each refusal with the exact response the app gives, and state an acceptance vector the app answers with it.
3. Keep each claim in the register of its tier. Never move a *built* claim to *open* to pass a gate.
4. Run `npx prism-code check --json` after every edit to the model or a register, and `npx prism-code build` to write the app and `CONFORMANCE.md`.
