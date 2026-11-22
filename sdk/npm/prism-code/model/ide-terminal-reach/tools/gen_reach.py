"""Write what a terminal command may touch into a rule-app App.lex.tex. Usage: python -I gen_reach.py PATH"""
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
head = src[: src.index("definition{name: title")]

# The same words as ../ide-terminal-commands, in the same order. A builtin is the page's own code; a program is a
# pinned executable. The order puts each group of commands side by side, so a rule or a guarantee names a group as
# one run of the list.
BUILTINS = ["help", "clear", "ls", "cat", "kappa"]
PROGRAMS = ["check", "snapshot", "prove", "audit"]
MORE = ["echo", "pwd", "set", "unset", "env", "history", "sessions", "restore", "save",
        "grep", "head", "tail", "wc", "sort", "uniq", "diff", "cd", "append", "mv", "cp", "write", "touch", "rm"]
LISTED = BUILTINS + PROGRAMS + MORE
# command: the command that is running. resource: what it asks its host for.
#   screen: write to the terminal.          readmodel, writemodel: the open model's files.
#   readstore, writestore: the content-addressed store, by BLAKE3 label.
#   network: any request to any address.    clipboard: read or write the clipboard.
#   process: start another program, worker or frame.
FIELDS = [("command", ["other"] + LISTED),
          ("resource", ["screen", "readmodel", "writemodel", "readstore", "writestore", "network", "clipboard", "process"])]
F = {n: i for i, (n, _) in enumerate(FIELDS)}
ANSWERS = ["deny", "allow"]
A = {n: i for i, n in enumerate(ANSWERS)}
OTHERWISE = "deny"
LT, LE, GT, GE, EQ, NE = range(6)


def c(field, op, value):
    vals = dict(FIELDS)[field]
    v = vals.index(value) if isinstance(value, str) else value
    return (F[field], op, v)


WORDS = dict(FIELDS)["command"]
N = {w: i for i, w in enumerate(WORDS)}


def run_of(first, last, resource):
    """The commands from `first` to `last` in the list, asking for `resource`, as conditions."""
    return [c("command", GE, N[first]), c("command", LE, N[last]), c("resource", EQ, resource)]


# Who may use what. Each is one or two runs of the list; everything else is denied.
#   the model is read by ls, cat, kappa and the programs, and by grep to cp
#   the model is changed by append, mv, cp, write, touch and rm, and by nothing else
#   the store is read by the programs and by sessions, restore and save; written by the programs and by save
ALLOWED = [("ls", "audit", "readmodel"), ("grep", "cp", "readmodel"), ("append", "rm", "writemodel"),
           ("check", "audit", "readstore"), ("sessions", "save", "readstore"),
           ("check", "audit", "writestore"), ("save", "save", "writestore")]
DENIED = [("other", "clear", "readmodel"), ("echo", "save", "readmodel"), ("write", "rm", "readmodel"),
          ("other", "cd", "writemodel"),
          ("other", "kappa", "readstore"), ("echo", "history", "readstore"), ("grep", "rm", "readstore"),
          ("other", "kappa", "writestore"), ("echo", "restore", "writestore"), ("grep", "rm", "writestore")]
# The two lists leave no command out, for any of the four resources.
for resource in ("readmodel", "writemodel", "readstore", "writestore"):
    covered = sorted(i for first, last, r in ALLOWED + DENIED if r == resource for i in range(N[first], N[last] + 1))
    assert covered == list(range(len(WORDS))), resource

# First match decides. Nothing names network, clipboard or process, so they fall to "deny".
RULES = [([c("command", EQ, "other")], "deny")]
RULES += [([c("resource", EQ, "screen")], "allow")]
RULES += [(run_of(*group), "allow") for group in ALLOWED]
# (always?, conditions, answer). No guarantee is stated with "is not": the kernel route does not settle it.
GUARANTEES = [(1, [c("resource", EQ, r)], "deny") for r in ("network", "clipboard", "process")]
GUARANTEES += [(1, [c("command", EQ, "other")], "deny")]
GUARANTEES += [(1, run_of(*group), "deny") for group in DENIED]
GUARANTEES += [(1, run_of(*group), "allow") for group in ALLOWED]
GUARANTEES += [(1, run_of("help", "rm", "screen"), "allow")]
EXAMPLES = [
    ("other screen", "deny"),
    ("other network", "deny"),
    ("help screen", "allow"),
    ("help readmodel", "deny"),
    ("clear screen", "allow"),
    ("ls readmodel", "allow"),
    ("cat readmodel", "allow"),
    ("cat writemodel", "deny"),
    ("cat readstore", "deny"),
    ("kappa readmodel", "allow"),
    ("kappa writestore", "deny"),
    ("check readmodel", "allow"),
    ("check writemodel", "deny"),       # a program changes no file of the model
    ("check network", "deny"),          # no command is handed the network
    ("check readstore", "allow"),
    ("snapshot writestore", "allow"),
    ("prove writestore", "allow"),
    ("prove clipboard", "deny"),
    ("prove process", "deny"),
    ("audit readstore", "allow"),
    ("audit network", "deny"),
    ("write writemodel", "allow"),      # six commands change the model, and only those
    ("write network", "deny"),
    ("rm writemodel", "allow"),
    ("rm readstore", "deny"),
    ("grep readmodel", "allow"),
    ("grep writemodel", "deny"),
    ("echo readmodel", "deny"),
    ("save writestore", "allow"),
    ("save writemodel", "deny"),
    ("restore readstore", "allow"),
    ("restore writestore", "deny"),
    ("mv process", "deny"),
]


def lst(items, ty):
    out = f"(nil {ty})"
    for it in reversed(items):
        out = f"(cons {it} {out})"
    return out


s = lambda x: '"' + x + '"'
cond = lambda t: f"(record Condition {{field := {t[0]}, op := {t[1]}, value := {t[2]}}})"
conds = lambda cs: lst([cond(x) for x in cs], "Condition")
fields = lst([f"(record Field {{name := {s(n)}, least := 0, greatest := {len(v) - 1}, values := {lst([s(x) for x in v], 'String')}}})" for n, v in FIELDS], "Field")
rules = lst([f"(record Rule {{conditions := {conds(cs)}, answer := {A[a]}}})" for cs, a in RULES], "Rule")
guar = lst([f"(record Guarantee {{always := {al}, conditions := {conds(cs)}, answer := {A[a]}}})" for al, cs, a in GUARANTEES], "Guarantee")
exs = lst([f"(record Example {{request := {s(r)}, answer := {s(a)}}})" for r, a in EXAMPLES], "Example")


def d(name, ty, body):
    return f"definition{{\n  name: {name},\n  parameters: [],\n  result: {ty},\n  body: {body}\n}}\n\n"


body = 'definition{name: title, parameters: [], result: String, body: "Terminal reach"}\n\n'
body += d("fields", "(List Field)", fields)
body += d("answers", "(List String)", lst([s(a) for a in ANSWERS], "String"))
body += f"definition{{name: otherwise, parameters: [], result: Nat, body: {A[OTHERWISE]}}}\n\n"
body += d("rules", "(List Rule)", rules)
body += d("guarantees", "(List Guarantee)", guar)
body += d("examples", "(List Example)", exs).rstrip("\n") + "\n\\end{semanticmodule}\n\\end{lexlean}\n"
open(path, "w", encoding="utf-8", newline="\n").write(head + body)
print("written", len(RULES), "rules", len(GUARANTEES), "guarantees", len(EXAMPLES), "examples")
