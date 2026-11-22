# Terminal reach, version 2

2026-11-21. Model: `src/App.lex.tex`, written by `tools/gen_reach.py`. A rule table, proved by `../ide-prove-rule-app.mjs` with this checkout's prism-code. Nothing is sent anywhere.

The terminal that asks it is `../../ide/edit/terminal` (`shell.mjs`). Version 1 denied every command a write to the model. Version 2 allows it to six commands and to no other.

## What it decides

Whether a command running in the Prism IDE's embedded terminal may use a resource: `deny` or `allow`. The commands are those of `../ide-terminal-commands`, in the same order.

A request is two words, in order:

| Field | Values | Meaning |
|---|---|---|
| command | other, help, clear, ls, cat, kappa, check, snapshot, prove, audit, echo, pwd, set, unset, env, history, sessions, restore, save, grep, head, tail, wc, sort, uniq, diff, cd, append, mv, cp, write, touch, rm | the command that is running |
| resource | screen, readmodel, writemodel, readstore, writestore, network, clipboard, process | what it asks its host for |

`screen` is writing to the terminal. `readmodel` and `writemodel` are the open model's files, as the editor holds them in this tab. `readstore` and `writestore` are the content-addressed store, by BLAKE3 label. `network` is any request to any address. `process` is starting another program, worker or frame.

| Commands | screen | readmodel | writemodel | readstore | writestore | network, clipboard, process |
|---|---|---|---|---|---|---|
| help, clear, echo, pwd, set, unset, env, history | allow | deny | deny | deny | deny | deny |
| ls, cat, kappa, grep, head, tail, wc, sort, uniq, diff, cd | allow | allow | deny | deny | deny | deny |
| append, mv, cp | allow | allow | allow | deny | deny | deny |
| write, touch, rm | allow | deny | allow | deny | deny | deny |
| sessions, restore | allow | deny | deny | allow | deny | deny |
| save | allow | deny | deny | allow | allow | deny |
| check, snapshot, prove, audit | allow | allow | deny | allow | allow | deny |
| other | deny | deny | deny | deny | deny | deny |

A command that is piped to another still asks for `screen` only when it writes to the screen; its output otherwise goes to the next command, which is judged for what it does with it.

## Proved

Lean's kernel accepted all 22, for every request (264 of them).

1. Network is always denied, whatever the command.
2. The clipboard is always denied.
3. Starting a process is always denied.
4. An unlisted command is always denied everything.
5. to 7. Reading the model is always denied to every command outside the two runs that read it.
8. Changing the model is always denied to every command from `other` to `cd`: every command but `append`, `mv`, `cp`, `write`, `touch` and `rm`.
9. to 11. Reading the store is always denied to every command but the programs, `sessions`, `restore` and `save`.
12. to 14. Writing the store is always denied to every command but the programs and `save`.
15. and 16. `ls`, `cat`, `kappa`, the programs, and `grep` to `cp` are always allowed to read the model.
17. `append`, `mv`, `cp`, `write`, `touch` and `rm` are always allowed to change the model.
18. and 19. The programs, `sessions`, `restore` and `save` are always allowed to read the store.
20. and 21. The programs and `save` are always allowed to write the store.
22. Each listed command is always allowed the screen.

Guarantees 1 to 3 together say that what is typed into the terminal, and what a command reads, has nowhere to go: no command is handed a way to send it. Guarantees 5 to 21 say, for each of the four resources and every command, either always allow or always deny: the generator checks that the runs leave no command out.

What changed from version 1: its guarantee 4 was "Writing the model is always denied. The terminal changes no file; the editor does." That is no longer so, by design: six commands change a file, and guarantee 8 holds every other command to the old rule.

Model identity: `sha256:14ecea48ca87fef04deed31ecb150ac950e7c7fb75127b4f6e56db1e77fb854b`.
Built app: `sha256:a93f2ffb4e970c11545e4f5edd61b2664d2be4d2ca8e09c7e9fa6446cff735c9`.
These names are SHA-256 because that is what prism-code emits today.

## Tested, not proved

34 of 34 acceptance vectors pass through the built judge.
A planted defect (allow the network) is refused in CI, and the step checks that the kernel names guarantee 1 and the request `help network`.

## Not covered

The table says what a command is handed. That the host hands it nothing else is the page's job and is unproved. Every command is the page's own JavaScript, given one object whose every method asks this table first (`shell.mjs`, `handOf`); the programs are questions to the page's two workers. The page is served with a content security policy.
A file a command changes is changed in the editor's copy of the model, in this tab. Whether that copy is kept between visits is the page's (the workbench keeps a draft in this browser; the plain page keeps nothing).
Fetching a pinned executable the first time is done by the page's loader, from the page's own origin, before any command runs. It is not a command's use of the network and this table does not judge it.
The page itself, any extension, and the browser are outside this table. An extension's reach is `../ide-capability-gate`.
Copying text the user selected in the terminal is the browser's own copy, started by the user. It is not a command using the clipboard.
`lexlean fmt` was not run on this model.
