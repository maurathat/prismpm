# Edit, check and prove (phases 2b and 2c, first steps)

A static page, with no build step, that opens one LexLean model for editing and shows LexLean's verdict as you type. It is the first step of phase 2b of `docs/proposals/prism-ide-phase-2.md`.

LexLean's front end runs in a worker in the tab. It is the executable prism-code pins (`src/journey/lexlean-wasm.mjs`), run on the in-memory file system prism-code already has (`src/journey/wasi-memory.mjs`), with the same command the SDK runs: `lexlean --diagnostic-format json check --all`. The worker inflates the executable and runs it only if its bytes hash to the pinned BLAKE3 label. Nothing is saved and nothing leaves the tab.

```sh
node tools/serve-edit.mjs <a folder holding lexlean.toml>     # from sdk/npm/prism-code/ide
# then open http://localhost:4170/edit/
```

Tried by hand in one browser, on `model/ide-capability-gate`:

| Step | Shown |
|---|---|
| Open | LexLean (18.2 MB inflated) checked against its label and ready in about 0.8 s; "The model checks, in 96 ms", with the identity `sha256:a245e321…`, the one prism-code gives this model |
| Break a line (`body: 2` to `body: (2`) | about 0.4 s after the edit: 1 problem, `LLP2001` at line 66, column 66; line 66 marked |
| Undo it | the mark clears; the model checks; the same identity |
| Change a rule (the fallback answer from 2 to 1) | the model checks; a different identity, `sha256:2cf31890…` |
| Name a type that does not exist | 1 problem, `LLT4001 forward or missing type` |
| Give the worker a label the executable does not hash to | the worker refuses to start and names both labels |

Later checks take 14 to 23 ms; the wait is the 350 ms pause after the last keystroke.

## Prove on edit (phase 2c, for rule tables)

When the model checks, the page goes on to its guarantees. LexLean gives the model's semantic snapshot; prism-code's `rule-table.mjs` reads it as a rule table; each guarantee is first tried against every request in the bounds, which finds a request that breaks it if there is one; then Lean's kernel, in a second worker (`prove-worker.mjs`), judges a proof term for each. "Proved" is the kernel's word alone, within the axioms a rule table is allowed. The kernel, its loader and its library run only when their bytes hash to what `src/journey/kernel/manifest.json` names. The kernel is put back to its just-loaded state before every batch.

Tried by hand in the same browser, on `model/ide-capability-gate`:

| Step | Shown |
|---|---|
| Open | 13 of 13 proved by Lean's kernel in the tab, in about 0.86 s; the kernel itself ready in about 0.7 s |
| Flip the last rule ("granted is yes → allow" to "granted is no → allow") | about 1.3 s after the edit: 7 proved, 6 broken, each broken one with the request that breaks it, such as `When granted = no and resource > write, the answer is never allow`: "the request `network yes no yes workspace no` answers allow" |
| Undo it | 13 of 13 proved again |
| A syntax error | the guarantees are hidden: a model that does not check has nothing to prove |

## In the VS Code workbench

`../model.html` with `../src/model-editor.js` is the same loop inside the workbench of `@codingame/monaco-vscode-api`: the model opens in the workbench's own editor, and the two workers above feed its own Problems panel.

- A LexLean diagnostic is an error marker at its place in the file.
- A guarantee a request breaks is an error marker on the line that states the guarantees, naming the request.
- A strip above the workbench says how many guarantees Lean's kernel proved.

```sh
npm ci                                             # from sdk/npm/prism-code/ide, once
npx vite build -c vite.model.config.js             # writes dist-model/, about 28 MB, not committed
node tools/serve-edit.mjs <a folder holding lexlean.toml>
# then open http://localhost:4170/edit/ide/
```

Tried by hand in the same browser, on `model/ide-capability-gate`:

| Step | Shown |
|---|---|
| Open | the model in the workbench editor; "13 of 13 guarantees proved by Lean's kernel in this tab, in 998 ms"; no problems |
| Flip the last rule | about 1.4 s after the edit: "7 of 13 … 6 not, listed under Problems"; the Problems panel lists 6 "Guarantee broken" entries at line 76, each with its request; the tab and the status bar show 6 |
| A syntax error | about 0.4 s after the edit: 1 problem from LexLean at line 66; guarantees not judged |
| Undo | no problems; 13 of 13 proved |

### Colours

`../src/lexlean-language.js` makes LexLean a language of the editor: the status bar names it, brackets and `%` comments behave, and the text is coloured.

- The tokenizer is written from the models in this repository, not from LexLean's grammar. It decides nothing: a wrong colour changes no verdict.
- The workbench cannot run a tokenizer of this kind on an open file: it logs an error for every line and colours nothing. So the tokenizer is registered under a name no file has and is only asked for a text's tokens, which are handed over as semantic tokens of the standard kinds (keyword, type, string, number, operator, property, namespace, comment).
- The workbench writes the stylesheet for token colours from its TextMate service, which this page does not load. The page writes that stylesheet itself from the theme's colour table, and again when the theme changes.

Tried by hand in the same browser. `edit/ide/?theme=<a theme's name>` opens the page in that theme.

| Model, theme | Shown |
|---|---|
| `model/ide-capability-gate`, Light 2026 | five distinct text colours in the visible lines; the prove loop unchanged (13 of 13; flip, 6 problems; undo, none) |
| the same, Dark Modern | coloured on the dark background; 13 of 13 proved |
| the same, Default High Contrast | five distinct text colours on black |
| `model/ide-scope`, Light 2026 | six distinct colours, numbers among them |
| a theorem file of `model/ide-scope`, put into the editor by script | `theorem`, `linear_arithmetic`, `project` and `false` as keywords; `Scope` in `Scope::judge` and `Bool` as types; operators and numbers coloured |

A diagnostic in another file of the project is now named in the strip rather than dropped. On `model/ide-scope` it reads `lexlean.toml: LLC0101: lean_toolchain must be exactly leanprover/lean4:v4.32.2`: the pinned LexLean refuses every model configured for Lean 4.32.1.

### Every file of the model

The workbench shows the model as its one folder, in its own Explorer, and any file can be opened and changed. The command palette (F1) and the keyboard shortcuts are the workbench's own.

- A check reads every file as it stands in the editor: the entry file, and any other file that was opened and changed.
- A diagnostic is marked in the file it is about, and listed under Problems with that file's name.
- A changed file keeps its change after its editor is closed, for as long as the tab is open. Nothing is written anywhere: a reload brings back the model as fetched.

Tried by hand in the same browser, on `model/ide-capability-gate`, and on an app's model served as Pages serves it:

| Step | Shown |
|---|---|
| Open | the Explorer lists `language`, `src` and the project's files; the entry file is open; 13 of 13 proved |
| Click `lexlean.lock` in the Explorer | it opens in a second tab |
| In `lexlean.toml`, change the Lean toolchain to one LexLean does not take | one problem, `LLC0101`, marked in `lexlean.toml`; guarantees not judged |
| Undo | no problems; 13 of 13 proved |
| F1, "Color Theme" | the command palette lists the theme commands |
| On an app's model, add a comment to `prism.toml` | still proved; "Your text still gives the rules the app at … runs." |

### Changes kept across a reload

The workbench page keeps the reader's changes in the browser, in the origin's private file system (`drafts.mjs`). Everything is named by its BLAKE3 label, from prism-code's own `blake3.mjs`:

- The model as fetched has one label, over its entry and every file's label: the base.
- Each changed file's text is stored once, under its own label.
- A draft says, for one base, which paths were changed and the label of each one's text.

So a draft belongs to exactly the model it was made on: when an app publishes a different model, the old draft is not laid over it. A stored text comes back only if its bytes derive again to its label; one that does not is left out and the page says so. A line under the strip names the changed files and has a "Discard my changes" button.

Tried by hand on the assembled site, served as Pages serves it:

| Step | Shown |
|---|---|
| Change the entry file and `prism.toml` | "Changed and kept in this browser: prism.toml, src/App.lex.tex." |
| Reload | both files open as they were left; the same line; the check runs on the restored text |
| "Discard my changes" | the page reloads with the model as fetched; 13 of 13 proved |
| A change on one model, then another model opened | the second model has no draft and no line |

`tools/drafts-test.mjs` holds the store to this on a directory in memory, with a stored text altered behind its back and a draft that names another model.

### Taking the model out

"Download model", beside the strip, gives the model as it stands in the editor as one tar archive (`model-tar.mjs`) that unpacks into a folder named `model`, a LexLean project.

- The archive is written the same way every time: paths in order, no dates, no owners, one mode. The same model gives the same bytes.
- So the archive has one BLAKE3 label. The file is named by its first twelve digits and the page states it in full. Two people who download the same model hold the same label.
- A path that would leave the folder it is unpacked into is refused, whoever wrote the model's listing.

`tools/model-tar-test.mjs` has the system's own tar unpack an archive and compares every file, and plants paths that must be refused.

Checked in the same browser on `model/ide-capability-gate`: the archive the page makes of the model as fetched is 45056 bytes with the label `blake3:a4ac2e2ff115…`, the same bytes count and label Node gives for the repository's files; a changed file gives another label; undoing the change gives the first one back. The button itself was not pressed by hand: what was checked is the archive the button hands over.

### Opening a model by its label, from a kappa-registry

The archive "Download model" gives is named by its BLAKE3 label. Stored as a blob in a [kappa-registry](https://github.com/UOR-Foundation/kappa-registry), it opens from an address that names only the label:

```
edit/ide/?registry=https://<registry>&namespace=<namespace>&model=blake3:<64 hex>
```

- `kappa-registry.mjs` is a read-only client for the registry's blob endpoint, `GET <registry>/v2/<namespace>/blobs/<label>`. It gives the bytes back only when they derive to the label asked for, so the registry is a place to fetch from, not something to trust. What the registry says of the bytes in its own headers is not read.
- The request carries nothing but the address: no cookie, no credential, and a redirect is not followed. The registry must be reached by https, or by http on this machine.
- `readModelTar` in `model-tar.mjs` reads the archive strictly: plain files of text under one folder, every header's checksum, no path that leaves the folder. Anything else is refused whole.
- A line under the strip says which label was opened, how many bytes, and from where. A model opened this way is compared with no app.

Tried against kappa-registry itself (2026-11-21): its server built from `main` at `bd231d0` and run on this machine, with nothing configured but its address and its store.

| Step | Result |
|---|---|
| Push two model archives with a plain `PUT` under their BLAKE3 labels | 201 each; `Docker-Content-Digest` is the label, `X-Kappa-Axis` is `blake3` |
| Push other bytes under a label that is not theirs | 400: the registry checks before it stores |
| The client fetches both back, from Node | the same bytes, the same labels, the same files |
| A request that names the Pages site as its origin | answered with that origin allowed |
| The workbench, served from this machine, opens one by label | 5 of 5 proved; "This is the model blake3:42a411b0…: 40448 bytes fetched from …, which derive to that label." |
| A label the registry does not have | "the registry has no blob … under acme/models" |

Two things that trial found:

- **The published page cannot reach a registry on the reader's own machine.** Opened from `https://uor-foundation.github.io`, the browser refused the request to `http://127.0.0.1` before sending it; the registry's log shows nothing arrived. The page said the registry did not answer. A registry the published page can use must be reached by https.
- **The registry refuses a preflight.** `OPTIONS` on a blob's address answers 405, though its own CORS code means to answer 204. The client's request is a plain `GET` and needs none, so reading works. A browser that sends one first (a request with a credential, or to a private network) would be refused.

The rest was tried by hand in the same browser against a stand-in on this machine that answers at the registry's address shape, because the cases need a registry that lies.

| Step | Shown |
|---|---|
| A stored model's label | the workbench opens it; 5 of 5 proved; "This is the model blake3:42a411b0…: 40448 bytes fetched from …, which derive to that label." |
| Its archive, made again by the page | the same label |
| Change a rule | "Opened as blake3:42a411b0… You have changed it since"; the page's archive now has another label |
| A label under which the stand-in serves other bytes, claiming them in its header | nothing opens: "the registry answered with bytes that are blake3:a4ac2e2f…, not the blake3:ce07bb9e… asked for" |
| A label the registry does not have | "the registry has no blob … under acme/models" |
| A registry reached by http across a network | refused before any request |

`tools/kappa-registry-test.mjs` holds the client and the archive reader to this, with a registry that lies, archives with a path that leaves the folder, a link, a broken checksum, and addresses that carry a password or the wrong kind of label.

Limits of the workbench page:

- Opening by label is read only: the page pushes nothing to a registry. A model gets there by `curl`, as the registry's README shows, or by a tool that can push.
- Only a registry that needs no sign-in for reading can be used: the client sends no credential.
- The published page reaches only a registry served by https. No such registry was tried: the one run here was on this machine.
- A draft is trusted no further than the origin that serves the page: another page of the same origin can write to the same store. It is the reader's convenience, not evidence of anything.
- Texts a discarded draft named stay in the browser until the site's data is cleared. Nothing names them.
- Where the browser has no private file system for the page (a private window), nothing is kept, and the line says a reload loses the changes. That case was not tried by hand.
- The plain edit page keeps nothing.
- New files, renames and deletions made in the Explorer are not read by a check: it reads the files the model was fetched with.
- Edits to files other than the entry were made by setting their text from a script, not by typing keys.

- Colours were looked at in three of the ten themes, and on three files. Names a model defines, such as `judge`, keep the plain text colour.
- The themes above were chosen by the address, before the command palette was switched on.
- The token stylesheet is also rewritten once a second, because the theme's colour table grows as tokens are first seen and no event says so.
- Every broken guarantee is reported on the one line where the guarantees are stated, not at its own place in that line.
- Edits were made by setting the editor's text from a script, not by typing keys.
- No extension runs on this page, so the capability gate is not loaded. Putting the two together is not done.
- The build is 28 MB and needs `npm ci`. The published site is 34 MiB with it.

## The terminal (phase 2f)

Both pages have a terminal, and both are answered by one command line (`terminal/programs.mjs`; the command language is `terminal/shell.mjs`, the keys are `terminal/line-editor.mjs`).

- The plain page: below the guarantees, on xterm.js itself (`@xterm/xterm` 6.0.0, MIT) with the fit, webgl, web-links, search and unicode11 addons, installed by `ide/package-lock.json` and published beside the page as the files npm ships.
- The workbench page: the workbench's own terminal panel (`@codingame/monaco-vscode-terminal-service-override` 39.0.5, which brings VS Code's terminal and the xterm.js it pins, 6.1.0-beta.327). The panel, its tabs, its find box and its renderer are VS Code's. `src/model-terminal.js` is the "process" behind it.

xterm.js draws and reports keys; a browser tab has no operating system to run anything else. What answers the keys is a command language over a fixed list of 32 commands, each of them the page's own code or a question to one of the page's two workers:

| Commands | What they do |
|---|---|
| `help`, `clear`, `history`, `set`, `unset`, `env` | the terminal itself: the commands, the screen, the lines entered, variables |
| `ls [-l]`, `cd`, `pwd`, `cat`, `kappa` | the model's files: list, move about, print, print a `blake3:` label |
| `echo`, `grep`, `head`, `tail`, `wc`, `sort`, `uniq`, `diff` | text, from files of the model or from the command before in a pipe |
| `write`, `append`, `touch`, `cp`, `mv`, `rm` | make, change or remove a file of the model, as the editor holds it |
| `check`, `snapshot` | `lexlean check` and `lexlean snapshot`, on the model as it is in the editor |
| `prove` | Lean's kernel on each guarantee |
| `audit` | each guarantee's status by the rule of `model/ide-audit` |
| `save`, `restore`, `sessions` | keep this session's transcript in this browser, print one, list them |

A line is commands joined as in a shell: `a | b` pipes, `a ; b`, `a && b` and `a || b` join, `> file` and `>> file` write a file of the model, `< file` reads one. `'…'` and `"…"` quote, `$NAME` and `${NAME}` are variables (`NAME=value` sets one, `$?` is the last command's status), `*` and `?` match the model's files, `#` starts a comment.

It is a command line for the model, in this tab, and no more than that. Any other word is refused: there is no bash, no native program, no package manager, no git and no connection to any machine, because nothing in a browser tab can run them and this page talks to no server. A command cannot be run inside a word (`$( … )`), nothing runs in the background (`&`), and there are no scripts, loops or functions.

The line is edited as in a terminal: Left, Right, Home, End, Ctrl+A, Ctrl+E; by word with Ctrl+Left, Ctrl+Right, Alt+B, Alt+F; Backspace, Delete, Ctrl+D; Ctrl+U, Ctrl+K, Ctrl+W, Alt+Backspace and Alt+D cut, and Ctrl+Y puts back; Up, Down, Ctrl+P and Ctrl+N walk the history and Ctrl+R searches it; Tab completes a command or a file of the model, and a second Tab lists what fits; Ctrl+C abandons the line or stops the running line; Ctrl+L clears. Keys pressed while a command runs are entered after it.

### What decides

- Every command of a line is put to `model/ide-terminal-commands` before it runs, and a redirection is put to it as the command it stands for: `> file` as `write file`, `>> file` as `append file`, `< file` as `cat file`. A pipeline in which one word is not a command runs none of its commands. A program runs only when its executable hashed to its pinned label; with one byte of the LexLean executable changed, `check`, `snapshot`, `prove` and `audit` are refused and the builtins still answer.
- Every use of a resource by a running command is put to `model/ide-terminal-reach`. A command is handed the screen, the model's files, the kept outputs and nothing else; six commands may change a file of the model, and no command is handed the network, the clipboard or a process.
- A path never leaves the model: `..` above its root, an address, a drive letter or a control byte in a path is `outside`, and the command table refuses it to every command. A file that is not there can be named only by the five commands that make one. The whole model is not removed from here.
- A file a command changes is changed where the editor holds it: the open file in its editor, the others beside it. The model is checked again, as after typing. The workbench keeps the change in its draft, in this browser; the plain page keeps nothing. A file removed from the workbench is back when the page is loaded again.
- Everything a command prints is written as text: a control byte in it is written out (`^[`), never sent. So no file and no program output can carry a sequence to the terminal, in either page.
- In the plain page, a sequence that would act outside the grid is also put to `model/ide-terminal-effects` (`terminal/effects.mjs`): OSC 52, notifications, file transfers and sixel are taken from xterm.js and ignored, a title is set as plain text, a link asks before it opens and only after a click, a paste of several lines asks first. The clipboard and image addons are not loaded. Window operations (CSI `t`) are dropped by xterm.js itself, whose options for them are all off.
- In the workbench page the emulator and its handlers are VS Code's, so links and paste behave as they do in VS Code and the effects table is not asked. What protects that panel is the rule above: output is text.
- Output waits on `model/ide-terminal-flow`: 16 KiB pieces, held at 100000 pending, released at 10000. The plain page counts bytes by xterm.js's write callback; the workbench page counts characters by VS Code's own acknowledgement, which comes in batches of 5000.

### BLAKE3 and Hologram

- `terminal/pins.json` names each published file of xterm.js by its `blake3:` label, and the plain page runs a file only when its bytes have that label. `node tools/terminal-site.mjs pin` rewrites the pins after a version change; the site builder refuses an installed file that is not the pinned one. The workbench's xterm.js is part of the workbench bundle and is held by the lockfile, not by a label the page checks.
- A program's output is kept under the label of its program's label and the label of everything it read, and shown again only when `reuseAdmits` (proved in `model/rule-app`) admits it. A second `check` of an unchanged model starts nothing, on this visit or a later one, in either page.
- The store (`terminal/kappa-space.mjs`) follows the browser store of Hologram (github.com/Hologram-Technologies/hologram, `crates/hologram-store/src/opfs/js_api.rs` at `e8fcdc70`): one file to a blob in the origin's private file system, named by its label, returned only when it re-derives to that label. It is that layout written in JavaScript, because Hologram publishes no browser build of its store. Where the browser has no such file system, things are kept for the visit only.
- Hologram's rule that a pure function over a finite domain is computed once and kept as a table is applied to the decision tables: the command, reach, effects and audit tables are each computed once into a lookup table (792, 264, 108 and 108 answers, one byte each), named by its label, and a request is answered with one read. The flow table has a number in it and is judged rule by rule. `tables.json` carries the label each lookup table must have, and a terminal whose tables compute to another label does not start.
- `site.json` names every published file by its `blake3:` label, beside its SHA-256.

What this does and does not buy: content addressing makes a repeated command cost a few milliseconds and makes what is stored checkable. It does not make a key press faster. That time is xterm.js drawing, and it was already short.

The tables reach the pages as `terminal/tables.json`, read at build time from the models through LexLean's own snapshot. The guarantees are proved of the tables; that this code asks them and obeys, and that each lookup table answers as its rules do, is tested by `node tools/terminal-test.mjs` (30 tests), not proved.

### Measured

On 2026-11-21, on one Windows development machine, in headless Chrome driven over its debugging protocol, the page served from localhost, the display at 60 frames a second. Not measured in CI, and not in other browsers. An earlier table here was taken in the Claude desktop app's browser pane, which was not painting when the workbench was tried.

| What | Plain page | Workbench page |
|---|---|---|
| Key to character drawn (1000 keys) | median 16.7 ms, 95th percentile 17.0 ms, worst 17.5 ms, none lost | median 16.6 ms, 95th percentile 17.1 ms, worst 23.4 ms, none lost |
| The same, during a 10 MB write (100 keys) | 95th percentile 18.4 ms, worst 37.5 ms | 95th percentile 19.8 ms, worst 27.8 ms |
| 10 MB of text | 1255 ms, 8.0 MB/s, at most 114688 bytes pending | 1270 ms, 7.9 MB/s, at most 116382 characters pending |
| Terminal asked to start, to first prompt | 901 ms the first time, 91 and 118 ms on later loads | the panel and its emulator were there 1.9 s after the page was opened |
| A pipeline of builtins (`ls \| grep tex \| wc -l`) | 3.3 ms | 15.8 ms |
| `check` | 106 ms run, 16 ms kept | 77 ms |
| `prove`, 13 guarantees | 2003 ms run, 15 ms kept | 2131 ms |
| Heap after the 10 MB write | 47.5 MB | 109.4 MB, the whole workbench |

What the key figure is. `term.input` of one key to the next `onRender`: the key reaches the emulator, the command line echoes it, and xterm.js draws it in the next frame of the display. It leaves out the browser's own key event and the frame reaching the screen. The test sends each key just after a frame was drawn, so every key waits nearly a whole frame: 16.7 ms is the worst case at 60 frames a second, and a key that arrives mid-frame is drawn sooner. No key took two frames outside the 10 MB write.

What the command line adds to a key: 0.35 µs to edit the line and hand the echo to the emulator, measured over 50000 keys. One decision of the proved command table is one read of its lookup table, 190 ns. Completing a file's name over this model takes 21 µs. Nothing between a key and its echo waits on a promise, a worker or the store.

The prompt no longer waits for the WebGL renderer: it is drawn by xterm.js's own renderer and the fast one is put in just after. `window.prismTerminal.timing` says when each part of starting was done. The first load's 0.8 s is fetching xterm.js, hashing it against its pins and compiling it.

### Not built

- A shell that runs programs. No native program, package manager, git or SSH, and no connection to any machine. A WASI shell with core utilities is a later phase with its own proposal.
- Scripts, loops, functions, command substitution and background commands.
- A program is not paused mid-run: its output is produced whole, then written under flow control. Ctrl+C stops what is being written and the rest of the line.
- A transcript is kept only by `save`, as text. The screen itself (colours, the scrollback as drawn) is not kept, and the serialize addon is not loaded.
- The history is this visit's. It is not kept between visits unless a transcript is saved.
- A character is taken to be one column wide by the line editor, so a line with wide characters is edited out of place.
- `prove` is held to the SHA-256 names in the kernel's manifest; only the label of the whole list is BLAKE3.
- The workbench bundle grew by the terminal: the published `edit/ide/` folder is 31 MiB.
- Leaving the workbench page logs one more of the workbench's own shutdown notices (`join.terminalAutoReplies`).
- Extension-contributed terminals are untried.

## Published

`tools/build-edit-site.mjs` adds this page to the site `tools/build-audit-site.mjs` assembles, and `.github/workflows/ide-audit-pages.yml` publishes both on this repository's GitHub Pages: the plain page at `<pages>/edit/`, the workbench at `<pages>/edit/ide/`. Both work from whatever folder they are published in.

- The LexLean executable and the kernel are published beside the page. A browser cannot fetch them from where prism-code does, because those addresses do not let another site read them. The workflow checks that what it publishes is what prism-code pins, and the workers check again in the tab.
- With no address the page opens the capability gate's model, which comes with it.
- `?project=<address of a folder>` opens the model published there. The folder holds the model's files and a `project.json` listing them, `{ "files": ["lexlean.toml", "src/App.lex.tex", ...], "entry": "src/App.lex.tex" }`, as prism-code's `src/journey/model-files.mjs` writes it. Its host must let other sites read it; when it does not, the page says so.

Tried by hand on the assembled site, served from a subfolder as Pages serves it:

| Step | Shown |
|---|---|
| `edit/` | 13 of 13 proved by Lean's kernel in the tab |
| `edit/ide/` | the workbench, coloured; 13 of 13 proved; no file failed to load |
| `edit/ide/?project=` a second model on another origin that allows reading | that model: 5 of 5 proved |
| the same on an origin that does not allow reading | "The model at … could not be opened (Failed to fetch). It needs a project.json listing its files, and its host must let other sites read them." |

## An app's own model

A rule app built by prism-code publishes its model with its page: the build writes `model/` into the page's folder, with `model/project.json` listing it (`src/journey/model-files.mjs`). The audit page looks for that listing at the app's address and, when it is there, links to the editor with the app's model.

- What is published is what LexLean reads to check the model. Left out: anything whose name starts with a dot, `session.json` (it names folders on the author's machine), every other `.json` but `lake-manifest.json`, notes and logs.
- Both edit pages say whether the model they opened is the one its app runs (`app-match.mjs`). The app's record, `app.rule-app.json` beside `model/`, holds what the app runs: its rules as numbers, its guarantees, fields and answers. The page reads the model with LexLean and prism-code's `rule-table.mjs` and compares those four. Nothing is taken from what the listing says of itself, since the same host wrote both.
- The edit pages do not check the record. The audit page does.
- A holo app has another record, `app.holo.json` (schema `prism/holo-app/1`): the BLAKE3 label of its holo and the identity LexLean gave the model it was built from. For such an app the pages compare two things (`holo-match.mjs`): the holo fetched from the app must derive to the label the record names, and the identity LexLean gives the fetched model, in the tab, must be the one the record names. An app that does not serve the holo its record names is compared with nothing. That the holo really was built from that model is the holo's own provenance to show; these pages do not read it.
- The holo comparison was tried on three stand-in apps made by hand around a real model, not on an app built by prism-code: no released prism-code writes `app.holo.json` yet. One with everything as recorded: "This is the model the app at … was built from", with both labels. One with a rule changed in its published model: "This is NOT the model the app at … was built from", with both identities. One serving a holo altered by one byte: "The app at … does not serve the holo its record names". `tools/holo-match-test.mjs` holds the same cases.

Tried by hand, on a rule app built from `model/ide-command-table` by this checkout and served beside the assembled site, dot-files removed:

| Step | Shown |
|---|---|
| The app's own page | proves its 5 guarantees in the tab, as before |
| The audit page, given the app's address | 5 proved of 5, and "This app publishes its model. Open the model in the editor" |
| That link | the workbench with the app's model; 5 of 5 proved; the identity `sha256:8307e81d…`, the one the build proved |

The comparison, tried by hand in the workbench on that app and on a copy whose published model had one rule changed while its record was left alone:

| Step | Shown |
|---|---|
| The app's model | "This is the model the app at … runs: it gives the app's own rules, guarantees, fields and answers." |
| Change a rule in the editor | "Your changes differ from the app at … in its rules. The app itself is unchanged." |
| Undo | the first line again |
| A syntax error | the line is hidden: a model that does not check is compared with nothing |
| The altered copy | in red: "This is NOT the model the app at … runs: as published it differs from the app's record in its rules." |
| A model with no record beside it | "No app record is beside this model, so it is compared with no app." |
| The model that comes with the page | no line |

`tools/app-match-test.mjs` holds the comparison to a record the package's own build writes, with a record altered in each of the four.

Apps published before this have no `model/`, so the audit page offers no editor for them until they are built again. A holo app's page is not written by prism-code and publishes no model.

Limits:

- `index.html` here is a plain text area: no syntax colours, no completion, no formatting (the WASI build of LexLean refuses commands that write).
- On the plain page one file is editable: the project's first entrypoint. The workbench page opens every file.
- Rule tables only. A model with theorems of its own is checked, and the page says its guarantees are not proved here. `model-prove.mjs` could be tried for those; it did not finish on `model/ide-scope` in 40 minutes in Node.
- "Refused" (the kernel does not accept a guarantee that no request breaks) was never seen: no such model was tried.
- A blank line added at the end of the file makes LexLean refuse the model. That is LexLean's rule, shown as it reports it.
- Nothing an edit changes is saved or can be sent anywhere: the page has no way to write a model back.
- The pin reaches the page as `pin.json` from the same server that serves the page. That is no weaker than the page's own code, which the same server serves.
- LexLean's positions are shown as it gives them. A missing type is reported at the line of the module's first structure, not where it is used.
- No automated test runs the page.
