---
title: Write the model
description: A Prism application's one source of truth is its LexLean model.
available_in: "0.6"
---
A Prism application's one source of truth is its LexLean model under `app/src/`. You write it, or an agent writes it with you through the Prism skill that `init` puts in the project. Its machine-readable form is the JSON LexLean exports for it, `lexlean/semantic-snapshot/2`, named by its `semantic_id`; that is what is sealed and what a page verifies.

## Start from the canonical template

`npx prism-code@latest init` starts every app from the same template, `UOR-Foundation/template`, which the package carries with every file under the BLAKE3 label of its bytes, so it fetches nothing. Its model in `app/src/` is a small working app, a checker that proves its verdict, to replace with yours. Beside it, `model/ids.toml` lists each capability by ID with the theorems that prove it, and `features/suites/` holds one scenario for each.

## Check, prove, build

Check after every edit: each diagnostic names the line of `app/src/` it anchors to, or the row of `model/ids.toml`. `check` has Lean's kernel prove every theorem, and refuses an ID whose theorems the model does not state or the kernel does not prove. `build` writes the app and replays its examples as acceptance vectors. Theorems are proved; examples are tested.

## What runs where

Every step runs on your machine, in one process, with no Docker, no image and no server. LexLean's front end and Lean's kernel both run as WebAssembly from the package's own copies, each used only when it has its BLAKE3 label. Nothing about the app is sent anywhere.

## Next steps

- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Agents and holos](/docs/guides/agents)
