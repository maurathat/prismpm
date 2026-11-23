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
2. **Keep the three kinds apart.** A theorem Lean's kernel proved is *built*. A standard cited from its authority is *imported*; never restate it as a local theorem. A runtime or benchmark figure is *open*; never call it proved.
3. **State it first.** Before changing behavior, state the guarantee as a theorem and the behavior as examples in the model, so `check` or `build` fails first for what is not there yet.
4. **No stubs.** No `sorry`, no undeclared axiom, no placeholder value, no flag hiding unfinished behavior. A theorem's `axioms` member lists exactly what its proof uses.
5. **Typed failures.** Model every rejection as an explicit typed answer with recovery text, and give each at least one rejecting example.
6. **Locked imports.** Resolve every import through the committed `lexlean.lock`. Never edit a lock by hand. After `lexlean.toml` or a lexicon of the project's own changes, `npx prism-code lock` writes the lock again, and LexLean checks it before it is written.

`prism-code check` enforces rules 4 and 6 and the theorems of rule 3. `build` and `verify` enforce the examples of rules 3 and 5. In a workspace made from the project template, which keeps ledgers under `model/` and scenarios under `features/`, `check` also runs the contract's ratchet for rules 1, 2 and 3 and reports each violation with a `contract.` code; `./references/template-contract.md` lists them. In a plain app, rules 1 and 2 are yours to keep.

## Where things are

Find the model root before editing: the project root, or the one subdirectory that holds a `lexlean.toml` (`app/` in a template workspace).

- `prism.toml`: the application's identity and its capability grant, deny by default.
- `prism.project`: the project's ID to a holospace, made once by `init`. No build reads it; never change it to pass a check.
- `lexlean.toml` and `lexlean.lock`: the LexLean project and its locked digests.
- `src/*.lex.tex`: the LexLean modules, the model and its proofs.
- `language/`: the lexicons the modules are bound to, when the project has them.
- `.prism/build/`: what `build` wrote. Never edit it.

`./references/lexlean-1.2.md` is the LexLean an app uses: every form, the rules LexLean holds them to, and the proof kinds the kernel accepts. LexLean's vocabulary is closed, so a guessed form is refused. Read it before the first edit.

## Workflow

### 1. Scaffold or inspect

Every Prism app starts with one command:

```bash
npx prism-code@latest init <app-name>
```

It writes the canonical template, `UOR-Foundation/template`, and this skill beside it, all inside the folder, fetching nothing. Every app starts from the same template, simple or complex; there is no other to choose. Its LexLean app is in `app/src/`, a working model to replace with the app the user describes. Its ledgers are in `model/`: `ids.toml` lists each capability by ID, with a level and the theorems that prove it. Its scenarios, one for each ID, are in `features/suites/`. Run again in a folder that holds a model, it leaves the model as it is. In an existing project, read `prism.toml`, `model/ids.toml` and the modules under `app/src/`, then establish where it stands:

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

1. List the capability first: a row in `model/ids.toml` with its level, statement and `theorems`, then its scenario in `features/suites/`. A refusal is a row with `failure`, the exact response the app refuses with, and `negative`, and its scenario is tagged `@rejects`.
2. Write total functions over bounded inputs: explicit ranges, total matches.
3. State each guarantee as a theorem, and name it in its row as `Module.name`: say what would break it, then prove that never happens.
4. State examples for every accepted path and every refusal. Each becomes an acceptance vector, and a registered refusal needs one answered with exactly its text.
5. `npx prism-code build` regenerates `CONFORMANCE.md` from `model/ids.toml`; never edit it by hand.

### 4. Check after every edit

```bash
npx prism-code check --json
```

`check` reads `prism.toml`, checks the model and proves every theorem, in seconds, and writes nothing in the project. It also enforces the template contract, R1 to R6 in `AGENTS.md`: `CONFORMANCE.md` is generated from `model/ids.toml` (R1); every level is some-true, build or open (R2); every ID has a scenario, and every theorem a build ID names is stated and proved (R3); every refusal listed there has a `@rejects` scenario and a vector answered with it (R5); imports are locked (R6); and every universal policy file still has the label `template.lock` binds. Each violation is a diagnostic with a `contract.` code. It answers one JSON report: `ok`, a `summary` with the modules checked and the theorems proved, and `diagnostics`, each with a `code`, a `file`, a `line`, a `message` and often a `remediation`. Make exactly the fix a diagnostic names, in the model, and run it again until it exits 0.

Exit codes: 0 passed; 1 a theorem is not proved or the contract is broken; 2 the manifest or the model does not check.

### 5. Build, then verify

```bash
npx prism-code build --json
npx prism-code verify --json
```

`build` checks again, writes the app under `app/.prism/build/` and replays its acceptance vectors. To try the app, run the project: `npx prism-code run --input "<request>"` builds it when the model changed, then runs exactly the holo that build wrote, and with no input serves its view. A project needs no signature to run what was proved here. A holo from anywhere else that carries its proof record is proved again by `run` before it starts; one that carries none is judged by the default policy. `verify` checks the model again, requires what is built to be the build of the model as it is on disk, and replays every vector on a fresh instance. The task is not done until `verify` exits 0 and its report shows every theorem proved, the identities verified and every vector passing.

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

## Reference

Every command prism-code ships, and what each exit code means. Run `npx prism-code --help` for the list your installed version has.

<!-- generated:commands:begin -->
| Command | What it does |
| --- | --- |
| `prism-code run [<project-or-holo>] [<input>] [--input <text>] [--rm] [--port <n>] [--policy <file>] [--allow-unverified] [--capabilities <file>]` | With a project folder, or nothing inside one: build it when the model changed since its last build, which checks the model, proves every theorem and replays every acceptance vector in this process, then run exactly the holo that build wrote, pinned by its digest; no signature is needed for what was proved here. With a holo: check it against the policy; with no `--policy`, a holo the default policy refuses that carries its proof record is proved again in this process, its vectors replayed, and then run, pinned by its digest, so whoever runs a holo re-checks it and no signature is needed. A holo that carries no proof record is judged by the default policy. With an input, this is one run as a container: dispatch the input, print the output and exit with the container's code, keeping the container until `rm` unless `--rm`. Without one, serve its view on a local port; a POST to `/_hologram/intent` dispatches one request. A holo that fails check is refused unless `--allow-unverified`, which warns on every start. |
| `prism-code rm <container>...` | Remove containers, by id or unique id prefix. A running container is refused. |
| `prism-code init [<dir>] [--name <name>] [--no-skill] [--force]` | Start a Prism application. `npx prism-code@latest init` is the one command every app begins with: it writes the canonical template, `UOR-Foundation/template` (contract 2, the standalone frame), with its LexLean app in `app/`, its ledgers in `model/` and its scenarios in `features/suites/`, then `prism.toml` naming the app, `prism.project` holding an ID made once from 32 random bytes, which names the project's holospace and which no build reads, and the Prism skill for an agent, all inside the folder, and prints the steps that follow. There is no choice of template: every app, simple or complex, starts from the same one. The package carries it, and each file is admitted by its BLAKE3 label before any is written. A folder that already holds a model keeps it and gets only the skill, so the command is safe to run again; `--no-skill` leaves the skill out. Nothing outside the folder is written or configured, and nothing is fetched. `npm create prism-code` runs the same command. |
| `prism-code manifest [<dir>] [--target <target>] [--json]` | Check and lint the project's `prism.toml`, with the overlay for the target merged in, and print the application, the grant and the variables. |
| `prism-code providers <verb> [<dir>] [--target <target>] [--json]` | `up` runs the `prism-provider-<type>` each capability in `prism.toml` declares and prints the variables it produced, and `down` releases them. Text output names them, and `--json` also prints their values. The capability set must allow the type and each variable. Experimental. |
| `prism-code vectors <app.holo> [--allow-unverified] [--json]` | Replay every acceptance vector the holo carries, each on a fresh instance, and exit 1 on a failure. An altered holo is refused; `--allow-unverified` replays it and still exits 1. `--json` prints one `prism/report/1` report with a row for each vector: whether it passed, and the bytes of its request and response. |
| `prism-code record <app.holo> [--output <file>]` | Write the acceptance vectors the image carries as a recording, its first. `history` is the deprecated spelling, kept through 0.8. |
| `prism-code replay <recording>... --image <app.holo> [--statement <file>] [--json]` | Re-execute recordings, or every recording in a directory, against this build and compare every outcome: exit 0 unchanged, 1 diverged, 2 could not replay. `--statement` writes the `prism/replay/v1` statement, also on a divergence. |
| `prism-code inspect <holo-or-container> [--format <path>]` | Print what the holo says about itself, without running it, or a container's state, exit code, image digest and output. |
| `prism-code attest <app.holo> --predicate <file> --type <uri>` | Sign an in-toto statement about the holo into its attestation section: keyless with an OIDC token, or with `--key`. `--unsigned` signs the statements the build left unsigned, and `--statement <file>` signs a whole statement, such as the proof statement in the verified directory. |
| `prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>` | Check the holo's attestations against the signer you expect, or against `--key`. |
| `prism-code export <name@sha256:digest> [--out <dir>] [--tar <file>] [--project <dir>] [--json]` | Write a release's six-file browser export or tarball, byte-checked against the build manifest, attestations beside. |
| `prism-code generate <app.holo> --out <dir> [--lang <language>]` | Write bindings and a typed client (`--lang` js, the default, rust or python) from the holo's WIT world and model into `<dir>`, with a record of what they came from. A second run with the same inputs writes nothing. |
| `prism-code publish-model <app.holo> --project <dir> --out <dir> [--json]` | Write the LexLean model in `--project` into `<dir>/model`, with `<dir>/app.holo.json` naming the holo and the model identity the holo gives, so the model can be opened and held to the app in a browser. Writes nothing when the holo names no model identity or the folder is no LexLean project. |
| `prism-code lock [<dir>] [--project <dir>] [--check] [--json]` | Write the project's `lexlean.lock` again after `lexlean.toml`, a workspace file or a lexicon of the project's own changed: the project renamed or re-bounded, a lexicon edited or added in a folder. The lock is proposed from the project's files and judged by LexLean as WebAssembly, which checks it byte for byte, so nothing is written unless LexLean accepts it as the lock it would have written. `--check` writes nothing and exits 1 when the lock is not current. A project that newly needs a package embedded in LexLean which the lock does not hold, a Git package, a source package or a PDF provider is refused with exit 2. `--json` prints one `prism/report/1` report. |
| `prism-code check [<project-or-holo>] [--project <dir>] [--policy <file>] [--replay <file>] [--key <file>] [--certificate-identity <id>] [--certificate-oidc-issuer <url>] [--trusted-root <file>] [--json]` | With a project, or nothing: check its model and prove every theorem, in this process, and write nothing. It reads `prism.toml`; in a workspace that keeps the template's ledgers (`model/ids.toml`) it runs the template contract's ratchet over them and the scenarios, reporting each violation with a `contract.` code (under `template/2` ledgers, each build ID's named theorems must be proved, each refusal `model/ids.toml` lists must answer an acceptance vector, and the universal policy must have the BLAKE3 labels `template.lock` binds; `build` writes `CONFORMANCE.md` from `model/ids.toml`, and `check` only compares); then LexLean as WebAssembly checks the model, then Lean's own kernel, as WebAssembly, proves each theorem within its declared axioms. `--json` prints one `prism/report/1` report: `ok`, a `summary` and `diagnostics`, each with a code, a file, a line, a message and often a remediation. Exit 0 when it passed, 1 when a theorem is not proved or the contract is violated, 2 when the manifest or the model does not check. With a holo: judge the holo against a policy and print its verdict, the assurance level, whether the policy passed, and every reason. `--policy` takes a Rego file, the name of a shipped policy (`pure-only`, `provenance-only`) or a JSON file. Exit 1 when the policy denies, 2 when it cannot be parsed or evaluated. A holo that carries signed provenance and proof statements reaches P1 and P2 only when `--key`, or a certificate identity and issuer, names the signer that signed them. |
| `prism-code images <verb> ... [--dangling] [--force] [--all] [--json]` | The `images` module's verbs. `build`, `inspect`, `pull`, `push` and `verify` are each the same command as the flat verb it names (`verify` is `check`). `ls`, `tag`, `rm` and `prune` read and change the local image store (`$PRISM_IMAGES`, else `$PRISM_HOME/images`): `ls` lists repository, tag, image id, created and size; `rm` untags one of several tags and removes an image only when no container references it, unless `--force`; `prune` removes untagged images no container references, and with `--all` every image none references. `images` alone is `images ls`, and the top-level verbs `tag` and `rmi` are `images tag` and `images rm`. `prism-code images --help` lists them. |
| `prism-code containers <verb> ...` | The `containers` module's verbs: `create`, `inspect`, `logs`, `ls`, `ps`, `rm`, `run` and `start`. `run`, `rm` and `inspect` are the flat verbs they name; `create` prints the new container's id, `ps` lists running containers (every one with `--all`), `ls` is `ps`, and `logs` prints a container's stored output. The top-level verbs `ps` and `logs` are `containers ps` and `containers logs`, and the singular spellings `container`, `image` and `volume` name the same groups as `containers`, `images` and `volumes`. `prism-code containers --help` lists them. |
| `prism-code volumes <verb> ... [--project <dir>]` | The `volumes` module's verbs: `create`, `inspect`, `ls` and `rm`, over the capability grant and provider declarations of a project's prism.toml. A volume is a declared store, never a host folder; `create` prints the names of the variables a provider returned, never their values. `prism-code volumes --help` lists them. |
| `prism-code push [<app.holo>] <reference> [--key <file>] [--keyless] [--no-attestations] [--signing-config <file>] [--store <dir>] [--plain-http] [--json]` | Put the holo in an OCI registry or a local store as a deterministic manifest, each attestation a referrer. With `--key` or `--keyless`, also sign a statement naming the manifest, so `cosign verify-attestation` passes on the same reference. With no holo, push the image of that name in the local image store. |
| `prism-code pull <reference> [<out.holo>] [--policy <file>] [--key <file>] [--certificate-identity <id>] [--certificate-identity-regexp <re>] [--certificate-oidc-issuer <url>] [--type <uri>] [--trusted-root <file>] [--entries <n>] [--timestamps <n>] [--store <dir>] [--plain-http] [--json]` | Fetch a holo and write it only after its digests, archive, verdict and attestations pass; the signer flags are those of `verify-attestation`. A reference is `registry/repo:tag`, `@sha256:`, `@blake3:` or `dir://`. A verified holo is also kept in the local image store under the name it was pulled by. |
| `prism-code dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--image <path>]` | Watch the project, rebuild and re-check on every change, and serve the local studio at `http://localhost:4100`, with a Check tab and a Replay tab. The page loads nothing from outside the machine. |
| `prism-code skill [--out <dir>] [verify [<dir>]]` | With `--out`, copy the `prism` skill this package ships, `SKILL.md` and its references, into that folder; it reads only the package and never writes to a default place. `init` writes the same files into the project. With `verify`, judge a copy again. The skill gate is a LexLean model (`skills/gate`) whose eleven theorems Lean's kernel proves here, now, in about two seconds: a skill passes only when its `SKILL.md` has the BLAKE3 label prism-code pins, the gate model is the pinned one, every `prism-code` command it names ships in this CLI, it names no server tool, it links no host outside Prism's own sites, holds nothing shaped like a credential and no executable file, nothing would send a model, and every theorem the gate declares is proved. Every fact is computed from the bytes and the code, never declared by the skill. |
| `prism-code build [<dir>] [--project <dir>] [--out <dir>] [--check] [--json]` | Check the project as `check` does, then write the app under `.prism/build` with nothing compiled, and replay its acceptance vectors. A rule app is written as the verified rule judge with the model's numbers; any other text application as a holo whose guest is one pinned evaluator running the model's program, refused unless that guest answers the model's own examples as its definitions do. `--out` also copies what was built into that folder, and `--check` stops after the check. `--json` prints one `prism/report/1` report. Every step runs in this process: no server, no container and nothing sent. |
| `prism-code verify [<project-or-holo>] [--project <dir>] [--policy <file>] [--json]` | With a holo: verify its digests and its world within the grant, and replay every acceptance vector on a fresh instance. With a project, or nothing: check the model and prove every theorem again, require what is built to be the build of the model as it is on disk, then do the same for it. The assurance level is reported, and judged only when `--policy` names a policy. `--json` prints one `prism/report/1` report. Exit 0 when it passed, 1 when a theorem is not proved, a vector fails, nothing is built or the build is stale, 2 when the manifest or the model does not check. |
| `prism-code system <verb> [--project <dir>] [--since <time>] [--until <time>] [--filter <key=value>] [--verbose] [--force] [--all] [--json]` | Report on this installation and tidy it, with the verbs info, version, events, df and prune: `info` and `version` name the package, the holo format, the runtime and the toolchain and builder image the project's `prismpm.lock` pins; `events` prints container create, start, die and destroy events from the container store and follows it until `--until`; `df` says what the container records and the local image store take; `prune` removes exited containers, then untagged images no container references (with `--all`, every such image), asking first unless `--force`. |
| `prism-code auth <verb> [<registry>] [--username <name>] [--password-stdin] [--json]` | Log in to a registry or out of it, with the verbs login and logout. `login` checks the username and password with the registry, then stores them with the registry logins on this machine, so `push` and `pull` find them; the password comes from `--password-stdin` or a prompt that does not echo, never from the command line. `logout` removes the credential from every store that holds it. |
| `prism-code login [<registry>] --username <name> [--password-stdin] [--json]` | The same as `prism-code auth login`. |
| `prism-code logout [<registry>] [--json]` | The same as `prism-code auth logout`. |
| `prism-code ps [--all] [--json]` | The same as `prism-code containers ps`. |
| `prism-code logs <container>` | The same as `prism-code containers logs`. |
| `prism-code tag <image> <name>` | The same as `prism-code images tag`. |
| `prism-code rmi [--force] <image>...` | The same as `prism-code images rm`. |

| Exit code | Name | Meaning |
| --- | --- | --- |
| 0 | ok | The verb did what you asked, or `check` reached a verdict the policy accepts. |
| 1 | vectors failed | A theorem of the model is not proved, at least one acceptance vector did not replay or the holo carries none, `replay` diverged, `verify-attestation` did not verify, `check` reached a verdict the policy rejects, or `pull` found a digest that does not match or a holo that fails verification and wrote nothing. |
| 2 | refused | The holo, capability file or manifest cannot be read or fails its checks, the model does not check, an identity check failed, a guest import, the holo's world or a provider is not granted, or a provider failed; or `check` reached no verdict: not a holo, an unreadable policy or an unknown format revision; or `push` or `pull` got no answer: an unreachable registry, refused credentials, a reference that does not exist or referrers that cannot be stored; or an export's bytes differ from the build manifest; or `generate` refused to write: the guest does not conform to its world, or a file in the output directory is not one it wrote; or `replay` could not be carried out. |
| 3 | signing failed | `attest` could not sign, or the optional sigstore packages are not installed. |
| 10 | proof mismatch | `run` refused a holo for a proof reason. 11 is a world mismatch, 12 a determinism violation, 13 a replay error. |
| 64 | usage | The arguments were wrong. |
| 70 | untyped | Dispatch threw something untyped: a guest trap, or a bug in the runtime. |

Node.js 22 or later, and nothing else. Every command runs in this process; LexLean and Lean's kernel ship in the package as WebAssembly, so no command needs a network, a server or a container. `--help` after any command prints that command's usage and runs nothing.
<!-- generated:commands:end -->

### Try it on the sample holo

The package ships a sample holo, `Calculator.holo`, so these run without building anything.

<!-- generated:try:begin -->
```bash
npx prism-code --version   # print the installed version
npx prism-code inspect node_modules/prism-code/fixtures/Calculator.holo   # print what the holo says about itself, without running it
npx prism-code vectors node_modules/prism-code/fixtures/Calculator.holo   # replay its acceptance vectors; exit 0 means every one passed
```
<!-- generated:try:end -->

### Load a holo from code

Three calls: `load` opens a holo and verifies its digests, `dispatch` runs one request on the instance, `acceptance` replays the examples the holo carries.

<!-- generated:example:begin -->
```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```
<!-- generated:example:end -->

### Docs

<!-- generated:docs:begin -->
- https://universal-coordinate-foundation.lovable.app/docs/llms.txt: the index of every page, written for agents
- https://universal-coordinate-foundation.lovable.app/docs/llms-full.md: every page in one file
- https://universal-coordinate-foundation.lovable.app/docs/reference/cli: every command, flag and exit code
- https://universal-coordinate-foundation.lovable.app/docs/reference/release-status: what has shipped and what is planned
- https://universal-coordinate-foundation.lovable.app/docs/guides/verify-and-inspect: check and inspect a holo
- https://universal-coordinate-foundation.lovable.app/docs/guides/agents: agents and holos
- https://universal-coordinate-foundation.lovable.app/docs/reference/holo-format: the byte layout of a holo
- Append `.md` to any page URL to get that page as Markdown.
<!-- generated:docs:end -->
