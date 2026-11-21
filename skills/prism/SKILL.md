---
name: prism
description: Build a new Prism app from one sentence and publish it, or load, run, inspect and verify a holo, the Prism package that carries its own proof and provenance. Use when asked to build, start or ship a Prism app, when a task mentions Prism, LexLean, a .holo file or prism-code, or when it asks whether an application can be trusted before it runs.
---

# Prism

Prism works like Docker. A model is built into a holo, an immutable package addressed by its digest, like an image. A runtime runs the holo, like a container runtime runs an image, and every run starts from a loaded, verified instance, like a container. A holo carries its own proof and provenance, so you check it before anything runs.

| Docker | Prism |
| --- | --- |
| Dockerfile | model |
| image, tag and digest | holo |
| container | instance |
| base image pinned in `FROM` | SDK image pinned in the lockfile |
| `docker run` | `prism-code run` |
| `docker inspect` | `prism-code inspect` |

## Install

```bash
npx prism-code@latest setup
```

One run adds the local MCP server `prism` (the guided build) to every agent on the machine, installs this skill, checks the GitHub sign-in, and ends with what to do next: restart the agent if it changed, then ask it for an app. It needs no Docker: every app is checked by LexLean and proved by Lean's own kernel, both as WebAssembly, on this machine. `--local` also readies Docker and the SDK image for full local builds.

This skill verifies itself. `setup` installs it only after the skill gate, a LexLean model whose theorems Lean's kernel proves on this machine, admits it: these exact bytes have the BLAKE3 label prism-code pins, every `prism-code` command named here ships, it holds no credential, executable or outside link, and nothing it teaches sends a model unless the user asks. To check the copy you are reading, run `npx prism-code skill verify`; trust it only when that prints `verified`. Spell it `prism-code@latest`, because `npx` prefers an older `prism-code` installed in any folder above the current one. To use the package from code, `npm install prism-code`.

Use `npx prism-code` followed by a verb to run it without installing. The package ships a sample holo, `Calculator.holo`, so you can try every command below without building anything.

## Try it

<!-- generated:try:begin -->
```bash
npx prism-code --version   # print the installed version
npx prism-code inspect node_modules/prism-code/fixtures/Calculator.holo   # print what the holo says about itself, without running it
npx prism-code vectors node_modules/prism-code/fixtures/Calculator.holo   # replay its acceptance vectors; exit 0 means every one passed
```
<!-- generated:try:end -->

## Commands

Run `npx prism-code --help` for the list your installed version has. The commands below are the ones that ship today.

<!-- generated:commands:begin -->
| Command | What it does |
| --- | --- |
| `prism-code run <app.holo> [<input>] [--input <text>] [--rm] [--port <n>] [--policy <file>] [--allow-unverified] [--capabilities <file>]` | Check the holo against the policy. With an input, this is one run as a container: dispatch the input, print the output and exit with the container's code, keeping the container until `rm` unless `--rm`. Without one, serve its view on a local port; a POST to `/_hologram/intent` dispatches one request. A holo that fails check is refused unless `--allow-unverified`, which warns on every start. |
| `prism-code rm <container>...` | Remove containers, by id or unique id prefix. A running container is refused. |
| `prism-code init [<dir>] [--sdk-image <ref>]` | Scaffold a project: `prism.toml`, a language-1.2 model and its Lean workspace, and a `.gitattributes` that keeps sources LF, because LexLean refuses CRLF. Print the build tiers to run next, cheapest first. With `--sdk-image`, also copy that image's `standards.lock` and write `prismpm.lock` (needs Docker). `npm create prism-code` runs the same command. A Prism application is a LexLean project too, started from a content-addressed starter module by the `mcp` verb's `prism` server. Hand-written LexLean is for a project like this one. |
| `prism-code manifest [<dir>] [--target <target>]` | Check and lint the project's `prism.toml`, with the overlay for the target merged in, and print the application, the grant and the variables. |
| `prism-code providers <verb> [<dir>] [--target <target>] [--json]` | `up` runs the `prism-provider-<type>` each capability in `prism.toml` declares and prints the variables it produced, and `down` releases them. Text output names them, and `--json` also prints their values. The capability set must allow the type and each variable. Experimental. |
| `prism-code vectors <app.holo> [--allow-unverified]` | Replay every acceptance vector the holo carries and exit 1 on a failure. An altered holo is refused; `--allow-unverified` replays it and still exits 1. |
| `prism-code record <app.holo> [--output <file>]` | Write the acceptance vectors the image carries as a recording, its first. `history` is the deprecated spelling, kept through 0.8. |
| `prism-code replay <recording>... --image <app.holo> [--statement <file>] [--json]` | Re-execute recordings, or every recording in a directory, against this build and compare every outcome: exit 0 unchanged, 1 diverged, 2 could not replay. `--statement` writes the `prism/replay/v1` statement, also on a divergence. |
| `prism-code inspect <holo-or-container> [--format <path>]` | Print what the holo says about itself, without running it, or a container's state, exit code, image digest and output. |
| `prism-code attest <app.holo> --predicate <file> --type <uri>` | Sign an in-toto statement about the holo into its attestation section: keyless with an OIDC token, or with `--key`. `--unsigned` signs the statements the build left unsigned, and `--statement <file>` signs a whole statement, such as the proof statement in the verified directory. |
| `prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>` | Check the holo's attestations against the signer you expect, or against `--key`. |
| `prism-code export <name@sha256:digest> [--out <dir>] [--tar <file>] [--project <dir>] [--json]` | Write a release's six-file browser export or tarball, byte-checked against the build manifest, attestations beside. |
| `prism-code generate <app.holo> --out <dir> [--lang <language>]` | Write bindings and a typed client (`--lang` js, the default, rust or python) from the holo's WIT world and model into `<dir>`, with a record of what they came from. A second run with the same inputs writes nothing. |
| `prism-code check <app.holo> [--policy <file>] [--replay <file>] [--key <file>] [--certificate-identity <id>] [--certificate-oidc-issuer <url>] [--trusted-root <file>] [--json]` | Judge the holo against a policy and print its verdict: the assurance level, whether the policy passed, and every reason. `--policy` takes a Rego file, the name of a shipped policy (`pure-only`, `provenance-only`) or a JSON file. Exit 1 when the policy denies, 2 when it cannot be parsed or evaluated. A holo that carries signed provenance and proof statements reaches P1 and P2 only when `--key`, or a certificate identity and issuer, names the signer that signed them. Without a holo it is a usage error that names `build --check`, the model check. |
| `prism-code images <verb> ... [--dangling] [--force] [--all] [--json]` | The `images` module's verbs. `build`, `inspect`, `pull`, `push` and `verify` are each the same command as the flat verb it names (`verify` is `check`). `ls`, `tag`, `rm` and `prune` read and change the local image store (`$PRISM_IMAGES`, else `$PRISM_HOME/images`): `ls` lists repository, tag, image id, created and size; `rm` untags one of several tags and removes an image only when no container references it, unless `--force`; `prune` removes untagged images no container references, and with `--all` every image none references. `images` alone is `images ls`, and the top-level verbs `tag` and `rmi` are `images tag` and `images rm`. `prism-code images --help` lists them. |
| `prism-code containers <verb> ...` | The `containers` module's verbs: `create`, `inspect`, `logs`, `ls`, `ps`, `rm`, `run` and `start`. `run`, `rm` and `inspect` are the flat verbs they name; `create` prints the new container's id, `ps` lists running containers (every one with `--all`), `ls` is `ps`, and `logs` prints a container's stored output. The top-level verbs `ps` and `logs` are `containers ps` and `containers logs`, and Docker's singular spellings `container`, `image` and `volume` name the same groups as `containers`, `images` and `volumes`. `prism-code containers --help` lists them. |
| `prism-code volumes <verb> ... [--project <dir>]` | The `volumes` module's verbs: `create`, `inspect`, `ls` and `rm`, over the capability grant and provider declarations of a project's prism.toml. A volume is a declared store, never a host folder; `create` prints the names of the variables a provider returned, never their values. `prism-code volumes --help` lists them. |
| `prism-code push [<app.holo>] <reference> [--key <file>] [--keyless] [--no-attestations] [--signing-config <file>] [--store <dir>] [--plain-http] [--json]` | Put the holo in an OCI registry or a local store as a deterministic manifest, each attestation a referrer. With `--key` or `--keyless`, also sign a statement naming the manifest, so `cosign verify-attestation` passes on the same reference. With no holo, push the image of that name in the local image store. |
| `prism-code pull <reference> [<out.holo>] [--policy <file>] [--key <file>] [--certificate-identity <id>] [--certificate-identity-regexp <re>] [--certificate-oidc-issuer <url>] [--type <uri>] [--trusted-root <file>] [--entries <n>] [--timestamps <n>] [--store <dir>] [--plain-http] [--json]` | Fetch a holo and write it only after its digests, archive, verdict and attestations pass; the signer flags are those of `verify-attestation`. A reference is `registry/repo:tag`, `@sha256:`, `@blake3:` or `dir://`. A verified holo is also kept in the local image store under the name it was pulled by. |
| `prism-code dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--image <path>]` | Watch the project, rebuild and re-check on every change, and serve the local studio at `http://localhost:4100`, with a Check tab and a Replay tab. The page loads nothing from outside the machine. |
| `prism-code setup [--agent <id>] [--local] [--pull] [--image <ref>] [--agents-only] [--machine-only] [--json] [--dry-run]` | Get this machine and its agents ready, with no Docker needed. The machine rows: Node 22 or later; `* text eol=lf` in the project's `.gitattributes`, unless it already keeps every file byte for byte (`* -text`); and, read only, whether apps can build on GitHub Actions: outside a repository, a GitHub sign-in (`GITHUB_TOKEN`, `GH_TOKEN` or `gh`); inside one, a github.com origin, the token and `.github/workflows/build.yml`. With `--local`, which `--pull`, `--image` and `--machine-only` imply, also Docker on the PATH or, on Windows without Docker Desktop, inside the first WSL distribution whose `docker version` answers, recorded in `$PRISM_HOME/config.json` so every delegated verb spawns it; the SDK image `prismpm.lock` pins (or `--image`), pulled only with `--pull` or `--image` and otherwise deferred: the first `build`, `verify` or `axioms` pulls it, about 5.5 GB, saying so first; and a cache volume per image, mounted at `/tmp`. Then add the local Prism server `prism`, the `mcp` verb, to every agent found: Claude Code, Codex, Cursor, VS Code and Claude Desktop. It is the one way an app is made: the agent starts the app's LexLean model from a content-addressed starter and writes it; Prism checks, proves and builds it. Without Docker, LexLean runs as WebAssembly once its pinned copy is here, and every app's theorems are proved by Lean's own kernel, as WebAssembly, in this process. Install the `prism` skill this package ships into `~/.claude/skills` and `~/.agents/skills`, only after the skill gate admits it: Lean's kernel proves the gate's theorems here and the skill's facts pass it (see `skill verify`); a refused skill is written nowhere and its row fails with `skill.refused`. Install the `holo://` link handler and remember the preferred agent. A server already there, and a `holo://` handler another program owns, are left alone. Last, it prints the next steps: sign in to GitHub when that is missing, restart the agent it changed, and the first sentence to ask it. Then one line on gap telemetry: what the journey sends and that `PRISM_TELEMETRY=0` turns it off. `--agent` limits it to one agent. `--dry-run` prints every file and command and changes nothing; `--json` prints the report, next steps included. |
| `prism-code skill verify [<dir>]` | Judge an installed skill again, as `setup` judged it before writing it. The skill gate is a LexLean model (`skills/gate`) whose eleven theorems Lean's kernel proves here, now, in about two seconds: a skill installs only when its `SKILL.md` has the BLAKE3 label prism-code pins, the gate model is the pinned one, every `prism-code` command it names ships in this CLI, every `prism_` tool it names is one of the six the MCP server answers, it links no host outside Prism's own sites, holds nothing shaped like a credential and no executable file, nothing would send a model unless the user asked, no proof needs Docker, and every theorem the gate declares is proved. Every fact is computed from the bytes and the code, never declared by the skill. With no folder, it verifies the `prism` skill in `~/.claude/skills` and `~/.agents/skills`. Exits 0 when every skill is verified, 1 when one is refused, naming the theorem each fact breaks, and 2 when there is no skill to verify. |
| `prism-code mcp [--project <dir>]` | Serve the Prism MCP server on stdio, for any agent that speaks MCP. It lists six tools, the only ones, named as Docker names its verbs. An app's one source of truth is its LexLean model under `prism/src/`, which the agent writes. `prism_init` starts it from a content-addressed starter module; with no starter before an app exists it lists the starters, and after, it says where the app stands. `prism_build` checks the model, proves every theorem with Lean's kernel in this process and, for a rule app, builds the verified rule judge; when the model does not check, it returns the first problem with its line and the exact fix; with `check: true` it only checks, as `docker build --check`. `prism_run` answers one request from the built app, building it first when the model changed. `prism_inspect` says where the app stands and lists the theorems of the last proof, with whether they are current, and changes nothing. `prism_push` publishes a proved app as one bundle of objects named by their BLAKE3 labels, the app by the label of its manifest, to this machine's Prism store or a `dir://` folder any static host can serve. `prism_pull` fetches an app by that address from such a store or an `https://` site, admits every object by its label, and has Lean's kernel prove the model in this process before anything runs. A rule app's guarantees are checked by Lean's kernel in this process from the model's semantic snapshot (`lexlean/semantic-snapshot/2`). LexLean runs as WebAssembly on this machine once its pinned copy is here; every app's theorems are proved by Lean's own kernel, as WebAssembly, in this process, and a step with nothing to run on fails with `build.frontend-unavailable`; nothing about an app is sent anywhere. `setup` adds it to every agent it configures. Experimental. |
| `prism-code open <link> [--dry-run]` | Hand a `holo://build?agent=<id>&q=<sentence>` link to its agent. Claude Code and Codex get a new terminal that shows the sentence and runs `claude` or `codex` with it after Enter. Cursor and VS Code get their MCP install link and the sentence on the clipboard. Claude and ChatGPT get their prompt URL. Another host, an unknown agent or parameter, or a sentence over 2000 characters exits 2. |
| `prism-code build [--check] [--project <dir>] [--remote github] [--repo <owner/name>] [--ref <commit>] [--timeout <s>] [--allow-dirty] [--json]` | Build the project into a holo inside the SDK image the lockfile pins. With `--remote github`, the repository's own GitHub Actions builds one commit instead, pushed to `prism/build/<sha>` so the run is that commit and no other, and this machine verifies what comes back before anything lands under `.prism/build/`: the commit and repository named in the artifact, the holo's SHA-256, the signed provenance (its subject, its repository and commit, and its signature by a workflow of the repository through GitHub's issuer), then `check` at the P0 policy unless `--policy` names one, the recorded fingerprint, and every acceptance vector replayed here. Needs the template's `build.yml` in the repository, a token (`GITHUB_TOKEN`, `GH_TOKEN` or `gh`), and the Sigstore packages or `gh` for the signature. No Docker. With `--check`, validate the model and write nothing: `prism.toml` here, then `lexlean check` of the LexLean project as WebAssembly, in this process: syntax and types, not proofs. No Docker, no server, nothing sent. |
| `prism-code verify [--lean] [--project <dir>] [--all]` | Run verify in the SDK image the lockfile pins. With `--lean`, prove every theorem of the project's LexLean model with Lean's own kernel, as WebAssembly, in this process instead: LexLean as WebAssembly gives the model's semantic snapshot, it is lowered to Lean kernel declarations, a proof is found for each theorem, and the kernel judges every declaration and proof, each within its declared axioms. It takes seconds, needs no Docker, and sends nothing; a theorem judged before on this machine is not judged again. |
| `prism-code axioms [--write] [--json]` | Compile the project once in the SDK image and print the axiom set Lean observes for every definition and theorem beside the set the source declares; exit 1 while any differs. With `--write`, set each `axioms` member to the observed set and format the project. |
| `prism-code conformance` | Run the conformance suite in the SDK image the lockfile pins. |
| `prism-code system <verb> [--project <dir>] [--since <time>] [--until <time>] [--filter <key=value>] [--verbose] [--force] [--all] [--json]` | Report on this installation and tidy it, with the verbs info, version, events, df and prune: `info` and `version` name the package, the holo format, the runtime and the toolchain and builder image the project's `prismpm.lock` pins; `events` prints container create, start, die and destroy events from the container store and follows it until `--until`; `df` says what the container records and the local image store take; `prune` removes exited containers, then untagged images no container references (with `--all`, every such image), asking first unless `--force`. |
| `prism-code auth <verb> [<registry>] [--username <name>] [--password-stdin] [--json]` | Log in to a registry or out of it, with the verbs login and logout. `login` checks the username and password with the registry, then stores them where Docker would, so `push`, `pull` and `docker` find them; the password comes from `--password-stdin` or a prompt that does not echo, never from the command line. `logout` removes the credential from every store that holds it. |
| `prism-code login [<registry>] --username <name> [--password-stdin] [--json]` | The same as `prism-code auth login`. |
| `prism-code logout [<registry>] [--json]` | The same as `prism-code auth logout`. |
| `prism-code ps [--all] [--json]` | The same as `prism-code containers ps`. |
| `prism-code logs <container>` | The same as `prism-code containers logs`. |
| `prism-code tag <image> <name>` | The same as `prism-code images tag`. |
| `prism-code rmi [--force] <image>...` | The same as `prism-code images rm`. |

| Exit code | Name | Meaning |
| --- | --- | --- |
| 0 | ok | The verb did what you asked, or `check` reached a verdict the policy accepts. |
| 1 | vectors failed | At least one acceptance vector did not replay or the holo carries none, `replay` diverged, `verify-attestation` did not verify, `check` reached a verdict the policy rejects, or `pull` found a digest that does not match or a holo that fails verification and wrote nothing. |
| 2 | refused | The holo, capability file or manifest cannot be read or fails its checks, an identity check failed, a guest import, the holo's world or a provider is not granted, or a provider failed; or `check` reached no verdict: not a holo, an unreadable policy or an unknown format revision; or `push` or `pull` got no answer: an unreachable registry, refused credentials, a reference that does not exist or referrers that cannot be stored; or an export's bytes differ from the build manifest; or `generate` refused to write: the guest does not conform to its world, or a file in the output directory is not one it wrote; or `replay` could not be carried out. |
| 3 | signing failed | `attest` could not sign, or the optional sigstore packages are not installed. |
| 10 | proof mismatch | `run` refused a holo for a proof reason. 11 is a world mismatch, 12 a determinism violation, 13 a replay error. |
| 64 | usage | The arguments were wrong, or `prismpm.lock` is missing. |
| 69 | no Docker | Docker is not installed or not on the PATH. |
| 70 | untyped | Dispatch threw something untyped: a guest trap, or a bug in the runtime. |

Node.js 22 or later. build, verify, axioms and conformance also need Docker and a `prismpm.lock` in the current directory; `build --check` and `verify --lean` find the lockfile here or above, up to the repository's root, and run in this process without the image. `--help` after any command prints that command's usage and runs nothing.
<!-- generated:commands:end -->

## Load a holo from code

Three calls: `load` opens a holo and verifies its digests, `dispatch` runs one request on the instance, `acceptance` replays the examples the holo carries. The script expects `Calculator.holo` beside it; copy it from `node_modules/prism-code/fixtures/`.

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

## How to work with a holo

- Check before you run. `inspect` and `vectors` read a holo without trusting it. A holo that fails an identity check exits 2: stop and report it. Do not run it, and do not edit its bytes.
- Report what the output says. `inspect` prints the holo's identities, limits, provenance and view files. Do not infer a proof or a signed statement from what it leaves out; say what is and is not there.
- Read the exit code before the text. 0 is ok, 1 is a failed vector, 2 is a refused holo, 64 is a usage error, 69 is no Docker.
- `check`, `build`, `verify`, `axioms` and `conformance` run the project's SDK image, so they need Docker and a `prismpm.lock` in the current directory. `build --check` and `verify --lean` run in this process instead, with no image. Say so when Docker is missing instead of working around it.
- The docs say which release each feature needs. Read the release status page before you promise a feature.

## Build a new app

The user says something like "build me a Prism app that tells whether a year is a leap year". That sentence is the whole brief. Give back a live page where anyone can load the app, check its fingerprint and replay its examples.

**The canonical path.** Every Prism app is built this way, and no other: its one source of truth is its LexLean model under `prism/src/`, which you write. Call `prism_init` with no arguments to see the starters, then again with the one whose shape fits the user's app: `rule-app` (decides one answer from one request, each condition a field against a value: Lean's kernel checks its guarantees from the model's semantic snapshot, and the app is the verified rule judge with the model's numbers, served as a static page), `decision-app` (decides one answer from one request, with its own judge and theorems, built into a holo) or `stateful-app` (keeps state between steps). Each starter is a LexLean module named by its SHA-256, copied only when its bytes match. Then edit the model to the app the user describes: its fields, rules, answers, guarantees and examples are LexLean definitions and theorems. After every edit call `prism_build`: it checks the model, proves every theorem with Lean's kernel in this process and, for a rule app, builds the verified rule judge. When the model does not check, it returns the first problem with its line of `prism/src/` and the exact fix, the name to write when one is misspelled; make exactly that fix and call it again. Call it again while it says `running`. When it lists the theorems, show the user what each guarantees, as plain sentences: Lean proved them, so the user must agree they are the right ones, and may strike any. `prism_run` answers one request from the built app, and `prism_inspect` reports where the app stands and the theorems of its last proof. The app's machine-readable form is the JSON LexLean exports for the model, `lexlean/semantic-snapshot/2`, named by its `semantic_id`; Prism reads nothing else.

**What runs without Docker.** Every step of the guided build runs with no Docker and no image. LexLean's front end runs as WebAssembly on this machine once its pinned copy is here (`docs/proposals/canonical-serverless-build.md`, Phase 3): it checks every app and takes its semantic snapshot in under a second. Every app's theorems are then proved by Lean's own kernel, as WebAssembly, in this process (Phase 4): the snapshot is lowered to kernel declarations, a proof of each theorem is found, and the kernel judges all of it, in seconds, with nothing sent anywhere. A rule app is also built with no server. Its pinned copy is fetched once, about 4 MB, and used only when it has its BLAKE3 digest; `PRISM_LEXLEAN_FETCH=0` fetches nothing and `PRISM_LEXLEAN_WASM` names a copy of your own. The kernel, its loader and a 1.2 MB base library are fetched once, about 1.7 MB, each used only when it has its BLAKE3 label. It proves theorems whose proof is `linear_arithmetic`, `decide` or `reflexivity`; another kind is reported as not proved here, by name. A theorem may be proved on fewer axioms than it declares, and is said to be. There is no server: nothing about an app is sent anywhere, and `PRISM_CODE_TIER=offline` fetches nothing either; never set `PRISM_CODE_TIER` yourself. An app other than a rule app is built into a holo with nothing compiled: one pinned evaluator guest runs the model's program, and the build is refused unless that guest answers the model's own examples, and requests made from them, as the model's definitions do. That is tested, not proved; say so. A model the guest does not run yet is refused by name with `build.guest-uncovered`, a model with no examples or a wrong one with `build.vectors`, and a step with nothing to run on fails with `build.frontend-unavailable`; say so plainly. Publishing to GitHub from `prism_build` is also unavailable until the template's ID rows, scenarios and tests are written from the semantic snapshot (`build.publish-unavailable`).

Say "proved" only for what Lean reports as proved, and "tested" for what the acceptance vectors cover. `prism_run` answers only from a built app, never from a second reading of the model.

There is no second way to build a Prism app: no spec file, no renderer, no model written anywhere but `prism/src/`. Do not use the `lexlean` MCP server to draft an app's model; write it under `prism/src/` and build it with `prism_build`.

### Verify locally in tiers

`build --check` and `verify --lean` run in this process with no Docker: LexLean as WebAssembly checks the model, and Lean's own kernel, as WebAssembly, proves every theorem. Nothing is sent anywhere. `npx prism-code@latest setup --local` also readies full local builds: it finds Docker, also inside WSL on Windows, and creates the build cache. It does not pull the SDK image (about 5.5 GB) unless you pass `--pull`; the first `build`, `verify` or `axioms` pulls the image and says so first. Then judge every edit by the cheapest gate that can refuse it:

```bash
npx prism-code build --check
npx prism-code verify --lean
npx prism-code axioms --write
npx prism-code verify
```

- `build --check` takes about a second: `prism.toml` and LexLean's check of the model, syntax and types, not proofs. Run it after every edit.
- `verify --lean` takes seconds: every theorem judged by Lean's kernel, each within its declared axioms, and a theorem judged before on this machine is not judged again. Run it before the full build, never instead of it. A theorem whose proof kind the kernel path does not cover yet is reported as not proved, by name.
- When `verify --lean` names an axiom policy, run `axioms --write` once. It sets every declaration's `axioms` member from what Lean observes, in one pass. Do not guess axiom lists by hand; the verify reports only the first wrong one per run.
- `verify` takes minutes: the guest, the vectors and the holo. Run it once the cheaper gates pass.
- Keep sources LF. `init` writes `* text eol=lf`; LexLean refuses a file with CRLF.
- Exit 69 means no Docker. Run `npx prism-code@latest setup --local` and report what its `docker` row says, or build on GitHub instead (below).

### Build without Docker: GitHub builds, this machine checks

```bash
npx prism-code build --remote github
```

The repository's own GitHub Actions builds one commit, and this machine verifies what comes back before it counts as built. Nothing here needs Docker, the SDK image or a toolchain, so it works from any machine with Node and a token, and the same run serves a phone: an edit committed on github.com or GitHub Mobile builds the app, signs its provenance and publishes the page, which verifies the holo again in the visitor's browser.

- It needs: the template's `.github/workflows/build.yml` in the repository (a new instance has it; an older one copies it from the template), a token (`GITHUB_TOKEN`, `GH_TOKEN` or `gh auth login`), and the commit pushed as the working tree stands. A tree with uncommitted changes is refused; commit, or name a commit with `--ref`.
- What happens: the commit goes to `refs/heads/prism/build/<sha>`, so the run is that commit and no other; `build.yml` runs the full verify in the SDK image and uploads `prism-build-<sha>` with the holo and its signed provenance; the ref is deleted afterwards. A run that already exists for the commit, from a push to `main` for instance, is reused with no push.
- What is checked here, in order, before anything lands under `.prism/build/`: the artifact names this commit and repository; the holo's SHA-256 is the one recorded; the provenance's subject is that digest and its build names this repository and commit; the signature is by a workflow of this repository through GitHub's issuer (prism-code's Sigstore verifier, else `gh attestation verify`, else refused); `check` passes at the P0 policy, or the one `--policy` names; the fingerprint matches; every acceptance vector replays. Report the fingerprint and the run URL it prints.
- Read the exit code: 2 is a refusal (`remote.*`, the message says which check), 1 is bytes that differ from their digest or a verdict or vector that failed, 0 is verified. A run that ended in failure is reported as a failure and nothing is written: read its log on GitHub.
- `setup`'s `github` row says what is in place: outside a repository, whether you are signed in; inside one, the origin repository, where a token would come from, and whether `build.yml` is there. Pages on a private repository needs a paid plan; the artifact and the run's summary need none.

## Docs

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

## MCP

<!-- mcp:begin -->
`setup` never adds the remote MCP server `lexlean`, and a Prism app never needs it: every check and proof runs on this machine. Never use it to draft a model for an app: an app's model is written under `prism/src/` and built with `prism_build`.

`npx prism-code@latest setup` adds the local server `prism`, which is `prism-code mcp` on stdio, to every agent it finds, Claude Desktop included. It lists six tools, the only ones, named as Docker names its commands: `prism_init` starts the app from a starter, or lists the starters, or says where the app stands; `prism_build` checks the model, proves every theorem with Lean's kernel in this process and, for a rule app, builds the verified rule judge, and on a check failure returns the first problem with the exact fix; with `check: true` it only checks, as `docker build --check`; `prism_run` answers one request from the built app, building it first when the model changed; `prism_inspect` reports where the app stands and the theorems of its last proof, changing nothing; `prism_push` publishes a proved app by the BLAKE3 address of its bundle, to this machine's Prism store or a `dir://` folder any static host can serve; `prism_pull` fetches an app by that address, admits every object by its label, and has Lean's kernel prove the model here before anything runs. They are the canonical path under Build a new app, where a LexLean model becomes a proved app. They run on LexLean as WebAssembly when its pinned copy is here, with no server. When they say `build.frontend-unavailable`, LexLean as WebAssembly could not be fetched: tell the user to run `npx prism-code@latest setup` again with a network connection.
<!-- mcp:end -->
