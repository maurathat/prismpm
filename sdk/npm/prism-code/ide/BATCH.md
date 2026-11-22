# Batch: 25 real web extensions through the gate

Since 2026-11-22 these 25 are pinned by content: `tools/extension-pins.json` names each by id, version and the BLAKE3 label of its package, and `node tools/install-extension.mjs` installs one only when the bytes Open VSX serves derive to that label. Each was fetched again on that day and is byte for byte the package this document reports on (the same SHA-256 and size `public/ext/batch.json` records). `tools/fetch_batch.py`, which made the batch, checks a package against the hash the registry itself publishes; the installer checks it against a pin in this repository, so a package changed at the registry is refused.

2026-11-20. The 25 most-downloaded Open VSX extensions that declare a browser entry and ship one universal package. Each `.vsix` was downloaded from open-vsx.org, checked against the SHA-256 the registry publishes, unpacked and loaded unmodified. 138 MB in total. The downloaded `.vsix` files were later deleted to free disk space; the unpacked copies in `public/ext/` remain and the fetcher can download them again. List and hashes: `public/ext/batch.json`. Fetcher: `tools/fetch_batch.py`. Harness: `public/batch.html`.

Setup for every run: full workbench, gate on with the proved judge, worker on a second origin, strict network policy. Grants: show and read yes; write, network, secrets and exec no. Scope: paths under `/workspace/`, plus each extension's own storage and log folders. One page load per extension, 22 seconds each. A probe extension in the same worker force-activates the extension under test and reports the outcome.

The Answer below is run 4, the latest, with all 25 on one build. The results table further down is run 3. Earlier runs are under History.

## Answer

18 of 25 activate through the gate. 7 do not. The probe and the page reported in all 25.
With the gate off, the same 18 activate and the same 7 do not. The gate no longer stops any of the 25.
Of the 7 failures, 5 have a known cause outside the gate and 2 (Vue, YAML) time out for an unknown reason.

"Activates" means the extension's start-up code ran without throwing. It does not mean the extension works. Only Error Lens was checked for visible behaviour, in a separate run.

## Run 4: Phase 1 build

Same 25, 22 seconds each, gate on. What changed since run 3:

- Storage rule proved. The gate model is version 3 (`../model/ide-capability-gate/README.md`, 13 guarantees). The page sends `target` (outside, workspace, storage) and the judge decides.
- Command classes proved. A second model (`../model/ide-command-table/README.md`, 5 guarantees) names three commands `show` and every other `exec`. Amazon Q, the one extension the gate stopped in run 3, now activates.
- Judge files checked by BLAKE3 label before use. A one-byte change was refused.
- Prism ID. The page hosts the template's `<prism-frame>` from local, unmodified copies pinned in `public/prism-frame/PIN.json`. One id served all 26 loads, with no sign-in.
- Grants store. Each extension's grants are a record signed by the id's session key and sealed with the id's workspace key (`src/identity.js`). A stored grant took effect after a reload; a record with one byte flipped was refused and the defaults applied.
- One worker per extension. The extension under test runs in its own worker, apart from the probe, through the editor's affinity setting. In all 25 runs the probe wrote its own storage and its write into the other extension's storage was denied.

Refusals beyond the baseline in run 4: GitLens 18 secrets and 2 terminal, Jupyter 5 secrets, Material Theme 1 stat of `file:/temp/flag.txt`, and telemetry. No command and no storage call was refused for any extension.

Baseline for a two-worker run adds, per extension: 1 chat-tools lookup by the second worker and the probe's 1 denied write into the other extension's storage.

Because the probe cannot see an extension in another worker, the page now activates the extension and reads the outcome from that worker's activation notice or error.

Limits of run 4:

- Which worker hosts which extension is taken from the worker's own notices. A hostile worker could claim another id.
- The relay is not admitted, so the id stays on this device. Linking devices, sync, recovery and removal are untested here.
- The frame runs from unmodified source files, not the published, hash-checked frame every deployed app loads.
- The gate-off control was run on the build before these changes. Its 18 and 7 are the same extensions as here.
- One run per extension.

## Results (run 3)

| Extension | Activated | Gate refusals beyond the baseline | Note |
|---|---|---|---|
| ms-python.python | yes | none | |
| eamodio.gitlens | yes | 18 secrets, 2 terminal | 43 `_setContext` calls now allowed |
| ms-toolsai.jupyter | yes | 5 secrets | 7 `_setContext` calls now allowed |
| ms-toolsai.jupyter-renderers | yes | none | |
| esbenp.prettier-vscode | yes | none | |
| ms-toolsai.vscode-jupyter-cell-tags | yes | none | |
| ms-toolsai.vscode-jupyter-slideshow | yes | none | |
| PKief.material-icon-theme | yes | none | |
| quarto.quarto | yes | none | |
| amazonwebservices.aws-toolkit-vscode | yes | none | 2 `_setContext` calls now allowed |
| mechatroner.rainbow-csv | yes | none | |
| ms-vscode.vscode-js-profile-table | yes | none | |
| vscodevim.vim | yes | 2 commands (`editor.action.wordHighlight.trigger`) | 69 `_setContext` calls now allowed |
| DavidAnson.vscode-markdownlint | yes | none | |
| vscode-icons-team.vscode-icons | yes | none | |
| usernamehw.errorlens | yes | none | gave no reading in the first run |
| zhuangtongfa.material-theme | yes | 1 stat of `file:/temp/flag.txt` | not a storage path, so the refusal is correct |
| amazonwebservices.amazon-q-vscode | no | 1 command (`workbench.action.webview.reloadWebviewAction`), 3 extra telemetry | fails on that refused command: caused by the gate |
| redhat.vscode-yaml | no | none | timed out after 8 s; nothing refused, cause unexplained |
| Vue.volar | no | none | timed out after 8 s; nothing refused, cause unexplained |
| GitHub.vscode-pull-request-github | no | none | needs the built-in `vscode.github-authentication` extension, which the page does not ship |
| GitHub.vscode-github-actions | no | none | `process is not defined`: its web build expects a Node global |
| shd101wyy.markdown-preview-enhanced | no | none | `global is not defined`: same kind of problem |
| cweijan.vscode-office | no | none | `Cannot load module 'pdf-lib'` |
| jeanp413.open-remote-ssh | no | none | `Cannot load module 'os'`: needs Node despite declaring a browser entry |

Baseline, present in every run and subtracted above: 2 telemetry calls, 1 chat-tools lookup by the worker, and the probe's own out-of-scope read, ungranted write and ungranted command. Almost every extension added 2 more refused telemetry calls, which the table leaves out.

## Control run, gate off

Same build, same 25, same window, `gate=off`. The probe reported in all 25 and nothing was refused.

- Amazon Q activates. Its failure with the gate on is caused by the gate.
- Vue and YAML time out after 8 s exactly as with the gate on. The gate is not the cause.
- The other 5 failures show the same error messages as with the gate on. The gate is not the cause.
- The 17 that activate with the gate on also activate with it off.

Why the earlier control gave no reading: with the gate off the probe's own test command, `workbench.action.files.saveAll`, really runs and never returns, so the probe never reached its report. Each probe step now has a 3 second limit.

## What the batch shows

1. An extension's own storage must be in scope. Confirmed by the paths. In the first run 10 extensions had a storage `mkdir` or `stat` refused. With storage in scope, under both the `vscode-userdata:` and `file:` schemes, no storage call is refused.
2. `_setContext` is a UI flag, not exec. Confirmed by the command ids. 129 of the 132 commands that extensions ran are `_setContext`. Judged as "show" they all pass. Three commands remain refused: Vim's 2 and Amazon Q's 1.
3. Amazon Q fails on whatever the gate refuses first. Run 1: storage `mkdir`. Run 2: `_setContext`. Run 3: reloading a webview. Each fix exposed the next refusal, so whether one more allowance is enough is unknown.
4. Secrets are used at start-up. GitLens and Jupyter read and delete stored secrets while activating. A blanket "ask" on first use would prompt the user before they have done anything.
5. A browser entry does not mean the extension runs in a browser. 4 of the 25 fail on a missing Node global or module, with nothing refused by the gate. The 38% compatibility figure in `COMPATIBILITY.md`, which counts a browser entry as "runs", is an upper bound.
6. Built-in extensions matter. GitHub Pull Requests depends on a built-in the page does not ship.
7. Vue and YAML stall with the gate on and with it off. The gate is ruled out. The cause is unknown.

## How far to trust this

- One run per extension, one fixed time window. Activation results matched across runs for every extension read more than once, except Error Lens, which the first run missed.
- The control is one gate-off run per extension. It was made with the probe's 3 second step limit; the gate-on run was made just before that limit was added. With the gate on no probe step stalls, so the limit should not change that run, but the two runs are not on an identical probe.
- Refusals cannot be attributed to an extension with certainty. All extensions share one worker with the probe; the numbers are differences from a baseline run.
- Storage is not separated per extension. With one shared worker the gate cannot tell one extension's storage folder from another's, so any extension may use any storage folder.
- Activation only. No extension's actual feature was exercised, apart from Error Lens.
- No write, network, secrets or exec grant was given, so the allow path for those was not tested on real extensions.

## History

- Run 1, all 25, 17 s each: 16 activated, 8 did not, Error Lens gave no reading. Scope was `/workspace/` only and every command but the probe's was exec.
- Run 2, the 10 extensions with a storage refusal, after putting `vscode-userdata:` storage in scope: every refused `mkdir` gone, same 8 of 10 activated. It exposed the `file:` form of the storage path and showed that the refused commands were `_setContext`.
- Run 3, all 25, after adding the `file:` form and judging `_setContext` as "show": this file.

- After run 3: the storage rule moved out of the page's JavaScript into the proved model (gate version 3, `../model/ide-capability-gate/README.md`). Six cases re-run under it gave the same results. The page now checks the judge's files by BLAKE3 label before use.

## Next

Phase 1 is done. The path-and-host scope kernel (`../model/ide-scope/README.md`) has 8 theorems verified by Lean on the hosted verifier; the page runs a tested copy of its rules, since the model is not built into a runnable judge. Five extensions re-run with that copy gave the same results as run 4; the full 25 were not re-run. The numbered list below is from run 3; items 1, 2 and 5 are done.


1. Build the command table from the ids real extensions call. Start with the two seen here: `workbench.action.webview.reloadWebviewAction` and `editor.action.wordHighlight.trigger`.
2. Done: gate-off control for all 25. See the control section.
3. Give Vue and YAML a longer window and capture why they stall. The gate is not involved.
4. Decide how start-up secret reads should be handled.
5. Separate storage per extension, which needs to know which extension made a call.
