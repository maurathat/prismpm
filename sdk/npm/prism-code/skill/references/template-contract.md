# The template contract

A workspace made from the UOR template keeps `uor/template-contract/1`: six rules, R1 to R6, and the registers that make them checkable. PrismPM's SPEC.md, section 17, is the normative text. This page says what the rules ask of an author.

prism-code does not read the registers. `prism-code check`, `build` and `verify` judge the LexLean model, its theorems and its acceptance vectors. The registers are judged by the template's own gate, in the workspace that has them.

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

- `model/ids.toml`: the stable identifier of every capability, theorem and error.
- `model/authorities.toml`: the *imported* claims, each cited from its authority.
- `model/ledger.toml`: the *built* claims, each backed by a theorem or a vector.
- `model/measures.toml`: the *open* claims, each a measurement.
- `features/suites/*.feature`: the scenarios, each mapped to an identifier.

Read the files a workspace already has for their exact shape, and follow it. Do not invent a member.

## What an author does

1. Register the identifier, then write its scenarios, then change the model.
2. Keep each claim in the register of its tier. Never move a *built* claim to *open* to pass a gate.
3. Run `npx prism-code check --json` after every edit to the model, and the template's gate before proposing the change.
