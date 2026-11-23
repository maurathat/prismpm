# Terminal reach, version 3

2026-11-23. Model: `src/App.lex.tex`, written by `tools/gen_reach.py`. A rule table, proved by `../ide-prove-rule-app.mjs` with this checkout's prism-code. Nothing is sent anywhere.

The terminal that asks it is `../../ide/edit/terminal` (`shell.mjs`). Version 1 denied every command a write to the model. Version 2 allows it to six commands and to no other. Version 3 adds the programs `build` and `verify`, which read the model and are handed no store.

## What it decides

Whether a command running in the Prism IDE's embedded terminal may use a resource: `deny` or `allow`. The commands are those of `../ide-terminal-commands`, in the same order.

A request is two words, in order:

| Field | Values | Meaning |
|---|---|---|
| command | other, help, clear, ls, cat, kappa, check, snapshot, prove, audit, build, verify, echo, pwd, set, unset, env, history, sessions, restore, save, grep, head, tail, wc, sort, uniq, diff, cd, run, test, append, mv, cp, write, touch, rm | the command that is running |
| resource | screen, readmodel, writemodel, readstore, writestore, network, clipboard, process | what it asks its host for |

`screen` is writing to the terminal. `readmodel` and `writemodel` are the open model's files, as the editor holds them in this tab. `readstore` and `writestore` are the content-addressed store, by BLAKE3 label. `network` is any request to any address. `process` is starting another program, worker or frame.

| Commands | screen | readmodel | writemodel | readstore | writestore | network, clipboard, process |
|---|---|---|---|---|---|---|
| help, clear, echo, pwd, set, unset, env, history | allow | deny | deny | deny | deny | deny |
| ls, cat, kappa, grep, head, tail, wc, sort, uniq, diff, cd, run, test | allow | allow | deny | deny | deny | deny |
| append, mv, cp | allow | allow | allow | deny | deny | deny |
| write, touch, rm | allow | deny | allow | deny | deny | deny |
| sessions, restore | allow | deny | deny | allow | deny | deny |
| save | allow | deny | deny | allow | allow | deny |
| check, snapshot, prove, audit | allow | allow | deny | allow | allow | deny |
| build, verify | allow | allow | deny | deny | deny | deny |
| other | deny | deny | deny | deny | deny | deny |

`run` is handed the model to read its script and nothing more: what the script's lines do is asked of this table line by line, under each command's own name. So a script cannot change a file except through the six commands that may. `test` reads the model only to say whether a path names a file or a folder of it. A function is not a command of this table: it is its lines, and each command of them is asked about under its own name.

A command that is piped to another still asks for `screen` only when it writes to the screen; its output otherwise goes to the next command, which is judged for what it does with it.

## Proved

Lean's kernel accepted all 24, for every request (296 of them).

1. Network is always denied, whatever the command.
2. The clipboard is always denied.
3. Starting a process is always denied.
4. An unlisted command is always denied everything.
5. to 7. Reading the model is always denied to every command outside the two runs that read it.
8. Changing the model is always denied to every command from `other` to `test`: every command but `append`, `mv`, `cp`, `write`, `touch` and `rm`.
9. to 12. Reading the store is always denied to every command but `check`, `snapshot`, `prove`, `audit`, `sessions`, `restore` and `save`. `build` and `verify` are among the denied (guarantee 10).
13. to 16. Writing the store is always denied to every command but `check`, `snapshot`, `prove`, `audit` and `save`. `build` and `verify` are among the denied (guarantee 14).
17. and 18. `ls`, `cat`, `kappa`, the six programs, and `grep` to `cp` are always allowed to read the model.
19. `append`, `mv`, `cp`, `write`, `touch` and `rm` are always allowed to change the model.
20. and 21. `check`, `snapshot`, `prove`, `audit`, `sessions`, `restore` and `save` are always allowed to read the store.
22. and 23. `check`, `snapshot`, `prove`, `audit` and `save` are always allowed to write the store.
24. Each listed command is always allowed the screen.

Guarantees 1 to 3 together say that what is typed into the terminal, and what a command reads, has nowhere to go: no command is handed a way to send it. Guarantees 5 to 23 say, for each of the four resources and every command, either always allow or always deny: the generator checks that the runs leave no command out.

What changed from version 1: its guarantee 4 was "Writing the model is always denied. The terminal changes no file; the editor does." That is no longer so, by design: six commands change a file, and guarantee 8 holds every other command to the old rule.

Model identity: `sha256:abfb3c3073e1ad64f7590538ff7b231d0baf5d2bc87cbf05b61104bc656f7eec`.
Built app: `sha256:66f20b6b9fa9fb25b97de80236dfdea10caa5257ea4196be9a6c32589b3c5d8d`.
These names are SHA-256 because that is what prism-code emits today.

## Tested, not proved

46 of 46 acceptance vectors pass through the built judge.
A planted defect (allow the network) is refused in CI, and the step checks that the kernel names guarantee 1 and the request `help network`.

## Not covered

The table says what a command is handed. That the host hands it nothing else is the page's job and is unproved. Every command is the page's own JavaScript, given one object whose every method asks this table first (`shell.mjs`, `handOf`); the programs are questions to the page's two workers. The page is served with a content security policy.
A file a command changes is changed in the editor's copy of the model, in this tab. Whether that copy is kept between visits is the page's (the workbench keeps a draft in this browser; the plain page keeps nothing).
Fetching a pinned executable the first time is done by the page's loader, from the page's own origin, before any command runs. It is not a command's use of the network and this table does not judge it.
The page itself, any extension, and the browser are outside this table. An extension's reach is `../ide-capability-gate`.
Copying text the user selected in the terminal is the browser's own copy, started by the user. It is not a command using the clipboard.
`lexlean fmt` was not run on this model.
