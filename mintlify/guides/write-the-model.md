---
title: Write the model
description: A Prism application's one source of truth is its LexLean model.
available_in: "0.6"
---

<Note>This page describes Prism 0.6, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

A Prism application's one source of truth is its LexLean model under `prism/src/`. You write it, or an agent writes it with you through the `prism` MCP server. Its machine-readable form is the JSON LexLean exports for it, `lexlean/semantic-snapshot/2`, named by its `semantic_id`; that is what is sealed and what a page verifies.

## Start from a starter

`prism_init` starts the model from a starter, a LexLean module named by its SHA-256 and copied only when its bytes match:

- `rule-app`: one answer from one request, each condition a field against a value. Lean's kernel checks its guarantees from the model's semantic snapshot, and the app is the verified rule judge with the model's numbers, served as a static page.
- `decision-app`: one answer from one request, with its own judge and theorems, built into a holo.
- `stateful-app`: state kept between steps, with actions and invariants, built into a holo.

## Check, prove, build

Check after every edit: each diagnostic names the line of `prism/src/` it anchors to. Before anything is proved, a rule app's guarantees are tried for a counterexample among the values its conditions tell apart. Lean then proves the model, and the build replays its examples as acceptance vectors. Guarantees are proved; the reading of requests and the examples are tested.

## What runs without Docker

Every step of the guided build runs with no Docker and no image. LexLean's front end runs as WebAssembly on your machine once its pinned copy is there: it checks every app and takes its semantic snapshot in under a second, and a rule app is then proved by Lean's kernel on your machine and built, with no server. Its pinned copy is fetched once, about 4 MB, and used only when it has its BLAKE3 digest; `PRISM_LEXLEAN_FETCH=0` fetches nothing. Any other app's theorems are proved by the hosted verifier, which stores the model unlisted, not privately; `PRISM_CODE_TIER=offline` sends nothing anywhere. Such an app is not yet built into a holo by the guided build, which needs Lean's export, Rust and WebAssembly; that, and a step with nothing to run on, fails with `build.frontend-unavailable`.

## Next steps

- [Verify and inspect](/guides/verify-and-inspect)
- [Agents and holos](/guides/agents)
