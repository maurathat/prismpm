# Terminal command table, version 3

2026-11-23. Model: `src/App.lex.tex`, written by `tools/gen_commands.py`. A rule table, proved by `../ide-prove-rule-app.mjs` with this checkout's prism-code. Nothing is sent anywhere.

The terminal that asks it is `../../ide/edit/terminal` (`shell.mjs`), in the plain edit page and in the workbench's terminal panel. Version 1 listed nine commands and let none of them name a file that was not there. Version 2 listed 34 and added the target `new`. Version 3 lists 36: it adds the programs `build` and `verify`.

## What it decides

How the Prism IDE's embedded terminal answers one command: `refuse`, `builtin`, `run` or `reuse`.

The terminal is xterm.js. xterm.js draws what a program writes and reports keys; it runs nothing. A browser tab has no operating system, so what runs is a small interpreter in the page with a fixed list of commands. This table is that list. A line may hold several commands (`a | b`, `a ; b`, `a > file`), loop and choose over them (`for`, `while`, `if`, `case`), name some as a function and run some inside a word (`$( … )`); each command is put to this table on its own, wherever in the line it stands, and `> file`, `>> file` and `< file` are put to it as `write file`, `append file` and `cat file`.

A request is four words, in order:

| Field | Values | Meaning |
|---|---|---|
| command | other, help, clear, ls, cat, kappa, check, snapshot, prove, audit, build, verify, echo, pwd, set, unset, env, history, sessions, restore, save, grep, head, tail, wc, sort, uniq, diff, cd, run, test, append, mv, cp, write, touch, rm | the command's first word; any word not listed is `other` |
| target | none, outside, model, new | where the command's paths point: it names none; one leaves the open model; each names a file or folder of the model; all are inside the model and one names no file yet |
| bytes | absent, mismatch, pinned | the executable the command needs, as held in this tab: not there, hashing to another label, or hashing to its pinned BLAKE3 label |
| stored | no, yes | the reuse rule admitted a kept output for this program label and this input label |

| Commands | Kind | What they do |
|---|---|---|
| help, clear, history, set, unset, env | builtin | the terminal itself: list the commands, clear the screen, the lines entered, variables |
| run | builtin | enter the lines of a file of the model; each command of each line is put to this table on its own |
| save, restore, sessions | builtin | keep this session's transcript in this browser, print one, list them |
| ls, cd, pwd, cat, kappa | builtin | the model's files: list, move about, print, print a `blake3:` label |
| echo, grep, head, tail, wc, sort, uniq, diff | builtin | text, from files of the model or from the command before in a pipe |
| test | builtin | say by its status whether a comparison holds; `[ … ]` is the same command |
| write, append, touch, cp, mv | builtin | make or change a file of the model; these five may name a file that is not there yet |
| rm | builtin | remove a file of the model |
| check, snapshot | program | `lexlean check` and `lexlean snapshot`: LexLean's front end as WebAssembly, pinned in `src/journey/lexlean-wasm.mjs` |
| prove | program | Lean's kernel on the model's guarantees (`src/journey/kernel-store.mjs`) |
| audit | program | each guarantee's status, by the rule of `../ide-audit` |
| build | program | `prism-code build`, by the package's own functions, in the tab: check, prove, make the holo |
| verify | program | `prism-code verify`: judge the holo that was built and replay its examples |

The list is ordered so that each group is a run of neighbours: the first five builtins, the four programs, then the other builtins with the five that make a file side by side and `rm` last. A rule or a guarantee names a group as one run.

Rules, first match decides:

1. a path points outside the open model → refuse
2. one of the five that make a file, and a path names no file yet → builtin
3. a path names no file → refuse
4. a builtin → builtin
5. `check`, `snapshot`, `prove` or `audit`, and a kept output is admitted → reuse
6. a program, and its executable hashes to its pinned label → run
7. otherwise → refuse

Rule 5 comes before rule 6 on purpose: a kept output is shown without fetching or starting the executable.
Rule 5 does not name `build` or `verify`. What they are asked for is an app made and an app judged, now; a line of text kept from an earlier run is neither. The reach table (`../ide-terminal-reach`) hands them no store, so nothing of theirs is kept.

## Proved

Lean's kernel accepted all 21, for every request (888 of them).

1. An unlisted command is always refused.
2. A path outside the open model is always refused, whatever the command.
3. With the executable absent, nothing is ever run.
4. With an executable that hashes to another label, nothing is ever run.
5. With no admitted kept output, nothing is ever reused.
6. and 7. No builtin ever runs an executable (the two runs of builtins).
8. and 9. No builtin ever reuses a kept output.
10. No program is ever answered as a builtin.
11. Each program, on the open model, with its pinned executable and no kept output, is always run.
12. `build` and `verify` are never answered from a kept output.
13. `build` and `verify`, on the open model, with the pinned executable, are always run, whatever is kept.
14. Each of `check`, `snapshot`, `prove` and `audit`, on the open model, with an admitted kept output, is always reused.
15. and 16. A path that names no file is always refused to every command but the five that make one (`rm` included).
17. Each of the five that make a file, with a path that names no file yet, is always answered.
18. to 21. Each builtin that names no path, or only paths in the model, is always answered.

Version 1 stated guarantees 6 to 12 once for each command, 23 lines for nine commands. Stated that way the 36 commands need over 110, and Lean's kernel takes about five seconds for each, so they are stated over runs of the list. What they say is the same.

Model identity: `sha256:3dd427e5b68b0fa359fadc5b10ea7ae4872334b016b66fb71b4fd83965451c56`.
Built app: `sha256:85641b1d55b21a7157f536d01cd71aab34a71cbdd559d3b92514569b8d44cda0`.
These names are SHA-256 because that is what prism-code emits today.

## Tested, not proved

44 of 44 acceptance vectors pass through the built judge.
That the page's `build` and `verify` do what the package's commands do is tested (`ide/tools/terminal-test.mjs`) and tried in a browser, not proved: this table decides only whether they run.
A planted defect (run bytes that hash to another label) is refused in CI, and the step checks that the kernel names guarantee 4 and the request `check none mismatch no`.

## Not covered

The four words are the page's to compute, and that is unproved: splitting the line into commands, expanding its words, resolving each path, hashing the executable, asking the reuse rule. It is tested in `ide/tools/terminal-test.mjs`.
That a line's redirections reach this table as `write`, `append` and `cat`, and that every command inside a loop, a `case`, a function, a `$( … )` or a script reaches it at all, is the interpreter's doing, tested, not proved.
`stored` is the answer of `reuseAdmits`, which is proved in `../rule-app` (`RuleAppProofs.lex.tex`), not here. The terminal asks it with the program's label and the input's label as the derivation key (`src/journey/kappa-rules.mjs`, `derivationKey`).
That a kept output is still the right output rests on the programs being deterministic. `check` and `snapshot` were built twice to the same bytes; that their output is the same for the same input is not proved.
`prove` is held to the SHA-256 names in the kernel's manifest; only the label of the whole list is BLAKE3.
`lexlean fmt` was not run on this model: the in-tab front end has no format command.
