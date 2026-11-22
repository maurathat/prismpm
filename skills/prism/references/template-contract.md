# The template contract

A workspace made from the UOR template keeps `uor/template-contract/1`: six rules, R1 to R6, and the registers that make them checkable. PrismPM's SPEC.md, section 17, is the normative text. This page says what the rules ask of an author.

`prism-code check`, `build` and `verify` judge the LexLean model, its theorems and its acceptance vectors. When the workspace has `model/ids.toml`, they also run the contract's ratchet over the registers and the scenarios, and a violation fails the gate with exit 1. The workspace's own gate still judges what only it can: the generated documents, byte for byte.

## The rules

| Rule | What it asks |
| --- | --- |
| R1 | One authoritative model. Behavior is authored in the LexLean modules; generated documents and bindings are never edited by hand. |
| R2 | Claim tiers stay apart: *imported* from a named authority, *built* by proof and acceptance vector, *open* as a measurement. |
| R3 | Register and specify first: an identifier and its scenarios exist before the behavior does. |
| R4 | No stubs: no `sorry`, no undeclared axiom, no placeholder, no flag hiding unfinished work. |
| R5 | Typed public failures: every rejection is a typed code with recovery text and at least one rejecting vector. |
| R6 | Locked dependencies: every import resolves through a committed lockfile pinned by digest. |

## The registers, when the workspace has them

- `model/ids.toml`: every conformance ID the workspace holds, as `[[id]]` rows with `id`, `suite`, `level` and `statement`. The level is `some-true` (reproduced from an authority), `build` (constructed and validated here) or `open` (measured, never asserted).
- `model/authorities.toml`: what the workspace cites instead of proving, as `[[authority]]` rows. `realized_by` lists the IDs that are evidence for it.
- `model/ledger.toml`: the claims that are not conformance IDs, as `[[claim]]` rows with `id`, `level`, `statement` and, for `some-true`, the `authority` it cites.
- `features/suites/*.feature`: one scenario for each ID, tagged `@ID @level`.
- A test for each ID, whose name ends in the ID in lower case with underscores: `TC-01` is tested by a name ending in `tc_01`.

Read the files a workspace already has for their exact shape, and follow it. Do not invent a member.

## What the ratchet refuses

| Code | Rule | What is wrong |
| --- | --- | --- |
| `contract.conformance` | R1 | `CONFORMANCE.md` does not list an ID the register holds. Regenerate it; never edit it by hand. |
| `contract.level` | R2 | A level is not `some-true`, `build` or `open`, or a scenario is tagged another level than its ID has. |
| `contract.authority` | R2 | A `some-true` claim cites an authority the workspace does not name, or an authority is realized by an ID that is not there. |
| `contract.duplicate` | R2 | One ID has two rows, in one register or across them. |
| `contract.unspecified` | R3 | A registered ID has no scenario. |
| `contract.unregistered` | R3 | A scenario is tagged with an ID the register does not hold. |
| `contract.untested` | R3 | A registered ID has no test named for it: the ID in lower case, every other character an underscore. |
| `contract.register` | | A register cannot be read. |

R4 and R6 are the model check's: no stub, no undeclared axiom, locked imports. R5 is `build`'s and `verify`'s: every typed failure has a rejecting example, replayed as an acceptance vector.

## What an author does

1. Register the identifier, then write its scenarios, then change the model.
2. Keep each claim in the register of its tier. Never move a *built* claim to *open* to pass a gate.
3. Run `npx prism-code check --json` after every edit to the model or a register, and the workspace's own gate before proposing the change.
