# Prism IDE, phase 2: open any Prism app to audit it and edit it, in any browser

Status: proposed, and partly built. Since this was written, `main` has gained the audit page, the edit pages, the model in the VS Code workbench, LexLean colouring, a published model and the check that a model is the one its app runs, all live at https://uor-foundation.github.io/prismpm/ (`audit/`, `edit/`, `edit/ide/`). The table below was read before that work; the rows the terminal phase depends on are corrected, the rest are as written. Phase 2f is built: the terminal is in the plain edit page and in the workbench's terminal panel. Phase 2d is built but for one part awaiting review (below). Phase 2e is not built.

## Why

A Prism app carries its own proof, but reading that proof today means reading a repository. The person who should be able to check an app is whoever is looking at it, in the tab they are already in.

Phase 2 gives every Prism app one control, **Open in IDE**. It opens the app's own model beside what backs it: which guarantees Lean proved, which examples were only tested, and the fingerprint of the bytes that are running. The same page lets them change a rule and see at once which guarantees still hold.

No install, no sign-in and no server of Prism's own. The visitor's Prism id is already in the frame.

## What exists, and what is missing

Read at `main` on 2026-11-20. Paths are under `sdk/npm/prism-code` unless they name the template.

| Piece | Exists | Missing for phase 2 |
|---|---|---|
| Audit of a holo app | The template's `bootstrap/page.mjs` renders `spec.html` at build time: theorems with their proof method, a "Tested, not proved" list, the examples, the fingerprint. `site/app.mjs` verifies the holo in a worker and sets the frame's `verdict`, `fingerprint` and `examples`. | It is a rendered page, not the model's source. Proofs are the build's; none is re-run in the tab. |
| Audit of a rule app | `src/journey/rule-app-site.mjs` writes `.prism/site/`. Its `start.mjs` checks the judge archive, runs every vector and re-proves every guarantee with Lean's kernel in the tab. | The page says "N guarantees hold". It lists neither the rules nor the guarantees. |
| LexLean in a browser | `src/journey/lexlean-wasm.mjs` pins the front end by BLAKE3 (19.1 MB, 4.1 MB compressed) and exposes `wasmCheck` and `wasmSnapshot`. `sdk/npm/lean-prover/web/lexlean-worker.mjs` already runs it in a worker. | Corrected 2026-11-20: it now runs in the tab, in `ide/edit/lexlean-worker.mjs`, admitted only when its bytes hash to the pinned BLAKE3 label. There is still no format function: the WASI build refuses commands that write. It accepts only models configured for Lean 4.32.2. |
| Lean's kernel in a browser | `src/journey/kernel-prove.mjs` proves a rule app's guarantees in the tab (2.2 MB kernel, 7.8 MB library). `src/journey/model-prove.mjs` proves a model's theorems from its snapshot, for `linear_arithmetic`, `decide` and `reflexivity`. | `model-prove` did not finish on `model/ide-scope` (8 theorems, up to 28 numbers each) in 40 minutes on a development machine. Its limits on real models are not measured. |
| A local studio | `prism-code dev` serves `src/studio/` on port 4100. Its Check tab re-judges the holo in the page and compares with the CLI's verdict. | It needs its server for state and events. Its Replay tab is a stub (`src/dev-replay.mjs` always answers `unavailable`). |
| An editor | `ide/` is the phase 1 spike: `@codingame/monaco-vscode-api` with every extension call judged by the three IDE kernels. | Corrected 2026-11-20: `ide/model.html` opens a model in the workbench, checked and proved as it is edited. It is still not in the package. It has no terminal. |
| An entry point | `<prism-frame>` has one slot, `status`, and fixed trust checks. It is published by content address and loaded at run time, so a change to it reaches every app with no rebuild. | No edit, source-model or IDE control. |
| Storage by content | `src/journey/kappa-opfs.mjs` keeps proofs and images in OPFS. `lean-prover/web/sealed-store.mjs` uses OPFS with BLAKE3. The template's `site/sw.js` caches by a SHA-256 list. | `kappa-opfs` labels with SHA-256, not BLAKE3. Nothing fetches by label. There is no client for kappa-registry. |

## The one path

The IDE is one static page, published once by content address, like the frame. It is given an app by its address and reads everything else from the app's own published files. It is not copied into each app and it is not in the npm package: a package that grows by an editor would break its size budget (`scripts/check-package.mjs`, 2006 KiB today) for something a browser fetches anyway.

An app needs to publish three things the IDE reads, beside what it publishes now:

1. its model sources (`src/*.lex.tex` and the project files), listed with a BLAKE3 label each;
2. its verification record (which theorems, which axioms, which image, the attestation);
3. its acceptance vectors, which the holo and the rule-app record already carry.

`prism-code` writes 1 and 2 into the site at build. That is the whole change to what an app ships, and it is a few kilobytes.

## What is proved, tested, and neither

- **Proved, already**: the three IDE kernels (`model/ide-*`), which decide what an extension may do inside the IDE.
- **Proved, by reuse**: what the IDE displays as "proved" is what Lean's kernel accepts in the tab, or what the app's signed attestation says the build proved. The IDE never marks a guarantee proved on the model's word.
- **Proved since** (14 guarantees, `model/ide-audit`): one small model stating how a guarantee's status is derived. The rule it must prove: a guarantee is shown as proved only if the kernel accepted it in this tab for this exact model, or a verified attestation names this exact model. Everything else is shown as tested or unknown.
- **Tested only**: the editor, the page, and every step that turns files into what the kernels and the audit model are asked.
- **Neither**: that the editor is pleasant to use. Phase 2 measures load time and proof time, not usability.

## Phases

Each phase ends in something a person can open. A phase that misses its gate stops the ones after it.

### Phase 2a: the audit view, read only

Work: one static page that takes an app's address and shows its rules, each guarantee with its status, its vectors with a replay control, and the fingerprint checked in the tab. Rule apps first, because their guarantees are data and the kernel already proves them in the tab. Then holo apps, from the verification record and the attestation. `model/ide-audit` with its proofs and workflow.

Gates: for `model/ide-capability-gate` published as a rule app, the page lists 6 rules and 13 guarantees, all marked proved by the kernel in the tab; with one rule changed in the published record, at least one guarantee is marked refused and none is marked proved from the old proof. `model/ide-audit` verified in CI with a planted defect rejected.

Budgets: first load to a full audit of a rule app within 5 s on a cold cache and 1 s warm, on the CI runner.

### Phase 2b: edit and check

Work: the model's `.lex.tex` in the phase 1 editor, with LexLean's front end in a worker checking on each pause in typing and marking diagnostics at their lines. No formatting on save, since the WASI build has none.

Gates: a syntax error is marked at its line within 1 s of the pause; a corrected file clears it. The front end is fetched by its BLAKE3 label and refused when one byte differs.

Budgets: the front end is 4.1 MB compressed and is fetched only when the editor opens, never by the audit view.

### Phase 2c: prove in the tab

Work: after a clean check, the kernel re-proves and the audit view updates in place. Rule apps through `kernelProve`. Models with theorems through `modelProve`, each theorem with a time limit, and "not settled in this tab" as an honest third answer.

Gates: the starter apps (`templates/starters/*`) prove in the tab. A measured table of which of this repository's models do and do not, with times. `model/ide-scope` is expected not to; the gate is that the page says so and offers the build's attestation, not that it proves it.

Budgets: none promised for arbitrary models. The table is the deliverable.

### Phase 2d: by content, offline

Work: every file the IDE and an app publish is named by its BLAKE3 label and fetched through one store that verifies before it returns. `kappa-opfs` labels move from SHA-256 to BLAKE3, with SHA-256 kept as a checked field where tooling emits it. A first read-only client for kappa-registry's blob endpoint as a second source.

Gates: a second visit to the audit view of an app makes no network request. One changed byte in any stored file is refused. A blob pushed to a locally run kappa-registry under a `blake3:` label is fetched and verified by the page.

Budgets: warm audit view within 1 s with the network off.

Built (2026-11-21), with what is not:

- Offline, by content. The site lists every file by its BLAKE3 label (`offline.json`), and a service worker serves each only as the bytes its label names. Live.
- The kappa-registry client, read only, and a model opened by its label (`edit/ide/?registry=…&namespace=…&model=blake3:…`). Live. The gate was met against kappa-registry itself, built from its `main` and run on a development machine: a model pushed under its `blake3:` label was fetched, verified and opened by the page, served from that machine. The published page could not reach it: a browser does not let an https page read from `http://127.0.0.1`. No https registry was tried. `ide/edit/README.md` has the table.
- `kappa-opfs` under BLAKE3 labels, with the SHA-256 label as a checked field: written, in review, not merged. Its keys are still derived with SHA-256, because the reuse rules are shared with Node and a holo's own label is SHA-256. prism-code's BLAKE3 is plain JavaScript and measured 46 MB/s on a development machine; what that costs a returning visit in a browser is not measured.
- Not built: installing an extension from Open VSX by content label. The terminal's kept output is in its own store, not `kappa-opfs`.

### Phase 2e: the entry point

Work: **Open in IDE** in the frame, shown when the app publishes the three things above. `prism-code` writes them at build. Conformance ids, a scenario and a package allowance for what the build now writes.

Gates: an app built from the template shows the control and opens its own audit view. An app that does not publish its sources shows no control. The frame's existing tests pass.

Budgets: the frame grows by under 2 KiB. An app's page pays nothing until the control is used.

Not built (2026-11-21). What was found on reading `UOR-Foundation/template` at `3fa228d`:

- No build publishes a holo app's model. The template's Pages workflow copies the holo and renders `spec.html`; it writes no `model/`, no `model/project.json` and no `app.holo.json`. prism-code writes a model beside a rule app's page only.
- The prism-code the template vendors for its page is 0.2.0, which has neither `model-files.mjs` nor the holo app record.
- The frame is published on every push to the template's `main` and every app loads it on its next visit. A control added there reaches every Prism app at once.
- The frame already has a `status` slot an app's page fills. A link put there by the app's own page would need no change to the frame; the proposal asks for a control in the frame itself.

So this phase needs three changes in order: prism-code writes the model and the record for a holo app; the template's build calls it and publishes them; the frame, or the page, shows the control when they are there. The first is in this repository. The other two are the template's, and are items 2 and 3 of "Ask first".

### Phase 2f: the terminal

What the user gets: a terminal panel in the edit page and in the workbench, where `check`, `snapshot`, `prove` and `audit` run on the open model with real output, beside 28 builtins for the model's files and for text (`ls`, `cat`, `grep`, `diff`, `write`, `rm` and the rest), joined on a line by pipes, `;`, `&&`, `||` and redirection, in the tab, with nothing sent anywhere.

What it is, said plainly. The terminal is xterm.js itself (`@xterm/xterm` 6.0.0, MIT), not a rewrite: the same emulator VS Code's own terminal panel is built on, depended on by version and lockfile, never copied into this repository. xterm.js draws what a program writes and reports keys. It runs nothing. A browser tab has no operating system, no PTY and no shell, so there is no bash, no native program and no SSH here, and no phase of a serverless IDE can add them. What answers the keys is a small interpreter in the page with a fixed list of commands, each one something that already runs in a tab as WebAssembly. It is a command line for the model, not a shell, and the page says so in its first line.

Work:

- The emulator. `@xterm/xterm` with the fit, webgl, search, web-links, serialize and unicode11 addons. Not loaded: clipboard and image (the effects table ignores what they handle), attach (it needs a websocket server), ligatures and progress. Renderer: the WebGL addon; on a lost context or a browser without WebGL2, xterm.js's built-in DOM renderer. The canvas addon no longer exists in 6.0.0.
- The interpreter, in the plain edit page first, with a line editor, history and completion over the command list. Every line is judged by `model/ide-terminal-commands` before anything runs, every use of a resource by `model/ide-terminal-reach`.
- Outside effects. A handler on each sequence that acts outside the grid, and on paste and links, each judged by `model/ide-terminal-effects`.
- Flow control by `model/ide-terminal-flow`: the write callback counts pending bytes, a command is held at 100000 and released at 10000.
- The workbench panel, through `@codingame/monaco-vscode-terminal-service-override`, which takes a backend with `start`, `input`, `resize` and `shutdown`. The same interpreter is that backend.
- BLAKE3. One pin file names every executable the terminal can start by its `blake3:` label, and `prove` moves from the SHA-256 its manifest names to a label. `site.json` records a `blake3:` label for every published file as the primary name, the xterm.js bundle and each addon among them, with SHA-256 kept as a checked field. A program's output is kept under the derivation key of its program label and its input label and shown again by the reuse rule `reuseAdmits`, which is already proved in `model/rule-app`; a warm `check` of an unchanged model starts no executable. A saved session is a list of labels of output pieces, itself named by its label, so the same output is stored once and a saved session re-derives or is not shown. All of this goes through `kappa-opfs`, not a second store, and so it waits on phase 2d moving that store's labels to BLAKE3.

Proved: four rule tables, by Lean's kernel in process, 63 guarantees in all. `ide-terminal-commands` (19): an unlisted command is refused; a path outside the model is refused to every command; nothing runs unless its bytes hash to the pinned label; nothing is reused without the reuse rule's word; a file that is not there can be named only by the five commands that make one. `ide-terminal-reach` (22): no command is ever handed the network, the clipboard or a process; six commands may change a file of the model and no other may; the store is read and written only by the programs and the session commands. `ide-terminal-effects` (17): clipboard sequences, notifications, transfers and window operations are ignored; no link opens without a click and a question; output alone can never raise a question. `ide-terminal-flow` (5): at the high mark a command is always held. Each has a planted defect in CI that must be refused by name. The first two tables were restated on 2026-11-21 for 32 commands: their guarantees are over runs of the command list, because one guarantee for each command would be 105 and 152 of them at about five seconds each in Lean's kernel.

Tested only: that the page asks the tables and obeys them; that the worker a program runs in really has no network (a content security policy limiting connections to the page's own origin, and a test that tries); xterm.js itself, which is used as published and not modelled; the programs' output being the same for the same input, which reuse rests on.

Gates: in the published page, `check` on the shipped model prints LexLean's own result; with one byte of the executable changed, `check` is refused and nothing runs; a file holding an OSC 52 sequence, printed with `cat`, leaves the clipboard as it was; a second `check` of the same model is answered from the store with the network off.

Built (2026-11-21): one command line behind two terminals, the plain edit page's on xterm.js 6.0.0 and the workbench's own terminal panel. The four tables are asked before every line, every use of a resource and every piece of output, and in the plain page before every outside effect; in the workbench panel the emulator is VS Code's, so there the defence is that every command's output is written as text. xterm.js is held to BLAKE3 pins in the plain page. Output is kept between visits in a store laid out as Hologram's browser store, and shown again only when `reuseAdmits` admits it. The four finite tables are answered from lookup tables computed once and named by label. Added the same day: a command language (pipes, `;`, `&&`, `||`, redirection to files of the model, quoting, variables, patterns), 23 more builtins, six of which change a file of the model in the editor, completion of file names, a history search, and transcripts kept by label when asked. Not built: pausing a program mid-run. `ide/edit/README.md` has the detail and the figures.

Budgets. These are targets. The figures are in `ide/edit/README.md`: one development machine, headless Chrome at 60 frames a second, the page served from localhost, not the CI runner. On that machine, in both pages, every one of 1000 keys was drawn in the frame after it arrived (worst 17.5 ms in the plain page, 23.4 ms in the workbench panel); during a 10 MB write the 95th percentile was under 20 ms; a large write ran at 8 MB/s; the first prompt came 0.9 s after the terminal was asked to start the first time and about 0.1 s later. The median key figure is one whole frame, 16.7 ms, because the test sends each key just after a frame; it is over the 16 ms target by that much and cannot be under a frame for a key that arrives then. The phase is not done until each is measured in Chrome on the CI runner and the figure written here.

| What | Target | How it is measured |
|---|---|---|
| Key press to character drawn | median 16 ms, 95th percentile 33 ms | time at `keydown`, time at the `onRender` that follows the echo, over 1000 keys |
| The same, during a 10 MB write | 95th percentile 50 ms | as above, while a command prints 10 MB |
| Panel opened to first prompt | 1.5 s cold, 300 ms warm | navigation start to the prompt's `onRender`; the prompt does not wait for any executable |
| First `check` result | 5 s cold, 1 s warm, 100 ms when reused | Enter to the last byte's write callback |
| Throughput of a large write | 5 MB/s | 10 MB of text, first write to last callback; xterm.js states 5 to 35 MB/s |
| Memory with a full scrollback | 50 MB for 10000 lines of 120 columns | the tab's heap before and after, from the browser's own tooling |

Not done: a shell that runs programs. Native programs, package managers, git, SSH, or a connection to any machine. Scripts, loops, functions, command substitution and background commands. A WASI shell with core utilities on files held in the browser is a later phase with its own proposal; a container in the browser is a different project. Extension-contributed terminals are untried.

## The goal, stated so it can be checked

The goal is the editing experience of vscode.dev, serverless and in any browser, without Microsoft's own services. It is not "feature complete with vscode.dev": parts of vscode.dev are services, and a page with no server cannot be one.

The workbench is not an imitation. `ide/` runs `@codingame/monaco-vscode-api`, which packages the open-source VS Code workbench that vscode.dev is built from. Layout, editor, palette and keybindings are the same code. The Visual Studio Code name, logo and product icons are Microsoft's and are not used.

"Tried" below means run in the phase 1 spike. "In the workbench" means the code is the same as vscode.dev's and is loaded, but nobody has exercised it here.

| vscode.dev | Prism IDE | Today | Planned |
|---|---|---|---|
| Editor: tabs, split, minimap, multi-cursor, find in file | Same code | Tried: a file opens and edits in the full workbench | |
| Layout: activity bar, side bar, panel, status bar | Same code | Tried: renders | |
| Command palette, keybindings, settings editor | Same code | In the workbench, not exercised | Phase 3 check |
| Themes and icon themes | Same code; themes from Open VSX | Tried: two icon themes and a colour theme activate | |
| Problems panel and diagnostics | Same code | Tried: markers shown, and drawn by an extension | |
| Extensions that run in a browser | Same extension host, each call judged by the proved gate | Tried: 18 of the 25 most-downloaded web extensions activate | |
| Extensions that need Node or native programs | Not possible in any browser; vscode.dev cannot run them either | 4 of the 25 fail for this reason; 1 more needs a built-in extension the page does not ship, and 2 time out for a reason not yet found | Phase 3 looks at a Node-compatible runtime, with no promise |
| Extension marketplace | Open VSX. The Visual Studio Marketplace's terms limit it to Microsoft's products | A fixed list, fetched by script | Phase 2d: install from Open VSX by content label |
| Open a local folder | The browser's File System Access API, where the browser has it | Not built | Phase 3 |
| Search across files | Same code, over files held in the browser | Not built | Phase 3 |
| Source control (git) | git in the browser, speaking to the host the user names | Not built | Phase 3 |
| Open a GitHub or Azure repository by address | vscode.dev does this with a closed Microsoft extension. Here: git over HTTPS to that host, which is the user's server, not Prism's | Not built | Phase 3 |
| Terminal | The same emulator, xterm.js. No shell exists in a browser, and vscode.dev has none either without a tunnel to a machine. Here: a command line for the open model (check, snapshot, prove, audit, and 28 builtins for its files and for text, with pipes and redirection), every program admitted by its BLAKE3 label, with a proved rule for what it may run, touch and do outside its grid. vscode.dev has no equivalent of those rules | Built in the plain edit page and in the workbench's terminal panel; four rule tables, 63 guarantees proved | Phase 2f. A WASI shell is after phase 2, with no promise |
| Debugging | Only for what can run in the browser | Not built | After phase 3 |
| Settings Sync | Prism ID: the same id on every device, sealed to it | The id works on one device; linking and sync are untested | Phase 3 |
| Sign in | None needed: Prism ID is made on first use | Tried | |
| Copilot, Live Share, tunnels to a remote machine | Not offered: they are Microsoft services or need a machine | | |
| Works offline | Yes, after the first visit | Not built | Phase 2d |
| Extension permissions | A proved gate: deny, allow or ask per resource, grants signed by the user's id. vscode.dev has no equivalent | Tried on 25 extensions | |
| Audit of the app being edited | The audit view. vscode.dev has no equivalent | Tried on 4 rule apps and 13 published apps | Phase 2a |

Serverless means no server of Prism's own. Three things still reach a network, each one the user's own choice: Open VSX to install an extension, a git host to clone or push, and the place a Prism app is published.

## Not in phase 2

- Saving an edit back to a repository. That needs git and write access in the browser.
- Building a holo in the browser. A changed holo app is checked and proved in the tab; building it still needs the SDK image or GitHub Actions.
- A shell that runs programs. Phase 2f is a terminal with a fixed list of commands and a command language over them; it runs no native program and reaches no machine.
- Search across files, and extensions that need Node.
- Running the proved scope kernel in the page. `ide/src/scope.js` stays a tested copy until a holo of it is built.

## Ask first

1. **Where the IDE page is published.** Beside the frame in `UOR-Foundation/template`, or from this repository. Beside the frame means every app gets it with no rebuild, and one more thing the template's frame lock pins.
2. **Changing the frame.** Phase 2e adds a control to a component every Prism app loads. It should be reviewed as a frame change in the template, not carried in by this proposal.
3. **Publishing model sources with every app.** Today a rule app's page ships its numbers, not its `.lex.tex`. Phase 2 publishes the source. That is the point of an audit, and it is a change in what an app makes public.
4. **The order.** 2a is useful alone and touches nothing shipped. If only one phase is wanted first, it is 2a.
5. **xterm.js itself, not a rewrite.** "An exact clone" is met by using the real emulator, pinned and recorded by label, as the workbench is. A rewrite would be neither exact nor complete for a long time. It adds a dependency to `ide/`, not to the npm package.
6. **Where the terminal stops.** Phase 2f is a command line over what already runs in a tab. Decided on 2026-11-21 ("feature complete"): it has pipes, redirection, variables and the usual text and file commands, and its file commands change the model in the editor. It still starts no program that is not on its list, and it is not called a shell. A WASI shell is the next step up and is not in phase 2.
7. **Which xterm.js the workbench panel gets.** The terminal override for the workbench carries its own xterm.js, a 6.1.0 beta at version 40 of the workbench packages, and `ide/` is on version 39. The plain edit page can use stable 6.0.0 now; the workbench panel means moving the workbench to the version whose override is used, and taking the xterm.js it pins. Whether a version 39 override exists was not checked.
8. **Saving sessions.** A transcript can hold what was typed. The proposal saves nothing unless the user asks, and then only in this browser.
9. **The site's listing moves to BLAKE3.** `site.json` gains a `blake3:` label per file as the primary name. Anything reading its `sha256` field keeps working, but it is a change to a published format.
10. **Pausing a program needs a choice.** GitHub Pages cannot send the headers that let a worker block on shared memory. Either programs yield between pieces of output, or the site gets those headers through a service worker.
