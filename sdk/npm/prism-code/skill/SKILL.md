---
name: prism
description: Author, kernel-verify and build self-verifying Prism applications (.holo archives) from LexLean 1.2 models (.lex.tex) using only the local prism-code CLI. Use whenever creating, editing, proving, auditing or packaging a Prism app, a prism.toml manifest or a LexLean model, or when asked whether a .holo can be trusted before it runs.
---

# Prism

Author, formally verify and package a deterministic Prism application from one authoritative LexLean 1.2 model, with `npx prism-code` as the only dependency.

## What runs, and where

- **One dependency.** Node.js 22 or later and `npx prism-code`. Inside a project that installs it, `npx` runs the local copy.
- **Everything in this process.** LexLean checks the model as WebAssembly, Lean's own kernel proves every theorem as WebAssembly, and the app is written with nothing compiled. No command starts a server, a container, a cloud build or a host Lean toolchain, and none changes the machine's configuration.
- **Nothing is fetched or sent.** Nothing about a model leaves the machine. LexLean and Lean's kernel ship inside prism-code, each admitted only when its bytes have the BLAKE3 label prism-code pins, so a first run needs no network.
- **Say only what was established.** "Proved" is for what Lean's kernel proved. "Tested" is for what the acceptance vectors cover.

## Rules

Hold to all six before and during every change.

1. **One source of behavior.** Author all domain logic, state transitions, bounds, error codes and theorems in the `.lex.tex` modules. Never hand-edit what a build wrote, and never add fallback code beside the model.
2. **Keep claims apart.** A theorem Lean's kernel proved is *built*. A standard cited from its authority is *imported*; never restate it as a local theorem. A runtime or benchmark figure is *open*; never call it proved.
3. **State it first.** Before changing behavior, state the guarantee as a theorem and the behavior as examples in the model, so `check` or `build` fails first for what is not there yet.
4. **No stubs.** No `sorry`, no undeclared axiom, no placeholder value, no flag hiding unfinished behavior. A theorem's `axioms` member lists exactly what its proof uses.
5. **Typed failures.** Model every rejection as an explicit typed answer with recovery text, and give each at least one rejecting example.
6. **Locked imports.** Resolve every import through the committed `lexlean.lock`. Never edit a lock by hand.

`prism-code check` enforces rules 4 and 6 and the theorems of rule 3. `build` and `verify` enforce the examples of rules 3 and 5. Rules 1 and 2 are yours to keep. A workspace made from the UOR template also keeps registers under `model/` and scenarios under `features/`; `./references/template-contract.md` says how, and that prism-code does not read them.

## Where things are

Find the model root before editing: the project root, or the one subdirectory that holds a `lexlean.toml` (`app/` in a template workspace).

- `prism.toml`: the application's identity and its capability grant, deny by default.
- `lexlean.toml` and `lexlean.lock`: the LexLean project and its locked digests.
- `src/*.lex.tex`: the LexLean modules, the model and its proofs.
- `language/`: the lexicons the modules are bound to, when the project has them.
- `.prism/build/`: what `build` wrote. Never edit it.

`./references/lexlean-1.2.md` is the LexLean an app uses: every form, the rules LexLean holds them to, and the proof kinds the kernel accepts. LexLean's vocabulary is closed, so a guessed form is refused. Read it before the first edit.

## Workflow

### 1. Scaffold or inspect

A new app starts from a starter, which is a working model to edit:

```bash
npx prism-code init <app-name> --template rule-app
```

`rule-app` decides one answer from one request by a table of rules. `decision-app` does the same with its own definitions and theorems. `stateful-app` keeps state between steps. In an existing project, read `prism.toml` and the modules under `src/`, then establish where it stands:

```bash
npx prism-code check --json
```

### 2. Gate the manifest

Keep `prism.toml` deny by default. A pure text application needs no grant. Never write a credential, a token or a secret-shaped literal in it.

```bash
npx prism-code manifest --json
```

Fix every finding before going on.

### 3. Write the model

1. Write total functions over bounded inputs: explicit ranges, total matches.
2. State each guarantee as a theorem: say what would break it, then prove that never happens.
3. State examples for every accepted path and every typed rejection. Each becomes an acceptance vector.

### 4. Check after every edit

```bash
npx prism-code check --json
```

`check` reads `prism.toml`, checks the model and proves every theorem, in seconds, and writes nothing in the project. It answers one JSON report: `ok`, a `summary` with the modules checked and the theorems proved, and `diagnostics`, each with a `code`, a `file`, a `line`, a `message` and often a `remediation`. Make exactly the fix a diagnostic names, in the model, and run it again until it exits 0.

Exit codes: 0 passed; 1 a theorem is not proved; 2 the manifest or the model does not check.

### 5. Build, then verify

```bash
npx prism-code build --json
npx prism-code verify --json
```

`build` checks again, writes the app under `.prism/build/` and replays its acceptance vectors. `verify` checks the model again, requires what is built to be the build of the model as it is on disk, and replays every vector on a fresh instance. The task is not done until `verify` exits 0 and its report shows every theorem proved, the identities verified and every vector passing.

A holo from anywhere else is judged the same way, before it runs:

```bash
npx prism-code verify <AppName>.holo --json
npx prism-code inspect <AppName>.holo
```

When a host application consumes the holo, write its typed bindings:

```bash
npx prism-code generate <AppName>.holo --out src/client
```

## Never

- **Never weaken a gate to pass it.** Do not delete a rejecting example, drop a theorem, add an axiom or widen an answer to silence a failure. Repair the rule or the bound in the model.
- **Watch ordered rules.** In a rule table or a chain of guards, test the boundary values (zero, the greatest, one either side of a threshold), so an earlier rule never shadows a later one.
- **Never add another build step.** No container file, no server configuration and no outside compiler to work around a diagnostic.
- **Never edit a holo's bytes.** A holo that `verify` refuses is refused. Report it; do not run it.
