"""Write the terminal's command table into a rule-app App.lex.tex. Usage: python -I gen_commands.py PATH"""
import json, os, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
head = src[: src.index("definition{name: title")]

# The terminal's interpreter maps the first word of each command of a line to one of these; any other word is "other".
# A builtin is the page's own code and starts no executable. A program is an executable named by a BLAKE3 label.
# The first five builtins and the programs keep the places they had in version 1; the rest follow them.
BUILTINS = {
    "help": "list these commands",
    "clear": "clear the screen",
    "ls": "list the open model's files",
    "cat": "print files of the open model, or what is piped in, control bytes shown as text",
    "kappa": "print the BLAKE3 label of a file of the open model, or of what is piped in",
}
PROGRAMS = {
    "check": "lexlean check: LexLean's front end, as WebAssembly",
    "snapshot": "lexlean snapshot: the same executable",
    "prove": "Lean's kernel on the model's guarantees",
    "audit": "the audit view's statuses, from the kernel and the vectors",
}
MORE = {
    "echo": "print its words",
    "pwd": "print the folder paths start from",
    "set": "give a variable a value",
    "unset": "forget a variable",
    "env": "list the variables",
    "history": "list the lines entered",
    "sessions": "list the kept transcripts",
    "restore": "print a kept transcript",
    "save": "keep this session's transcript in this browser, under a name",
    "grep": "print the lines that hold a pattern",
    "head": "print the first lines",
    "tail": "print the last lines",
    "wc": "count lines, words and bytes",
    "sort": "print the lines in order",
    "uniq": "drop a line that repeats the one before",
    "diff": "print the lines in which two files differ",
    "cd": "change the folder paths start from",
    "append": "add what is piped in to the end of a file of the model",
    "mv": "rename a file of the model",
    "cp": "copy a file of the model",
    "write": "write what is piped in to a file of the model, replacing it",
    "touch": "make an empty file in the model",
    "rm": "remove a file from the model",
}
BUILTINS_ALL = {**BUILTINS, **MORE}
# The commands that may name a file that is not in the model yet: they make it. They are neighbours in the list,
# so a rule or a guarantee can name them all as one run.
CREATES = ["append", "mv", "cp", "write", "touch"]
# command: the command's first word.
# target: where the command's paths point. none: it names no path. outside: a path leaves the open model.
#   new: every path is inside the model and at least one names no file yet. model: every path names a file or folder.
# bytes: the executable the command needs, as held in this tab, against its pinned label.
# stored: whether the reuse rule (model/rule-app, reuseAdmits) admitted a kept output for this program and input.
FIELDS = [("command", ["other"] + list(BUILTINS) + list(PROGRAMS) + list(MORE)),
          ("target", ["none", "outside", "model", "new"]),
          ("bytes", ["absent", "mismatch", "pinned"]),
          ("stored", ["no", "yes"])]
F = {n: i for i, (n, _) in enumerate(FIELDS)}
ANSWERS = ["refuse", "builtin", "run", "reuse"]
A = {n: i for i, n in enumerate(ANSWERS)}
OTHERWISE = "refuse"
LT, LE, GT, GE, EQ, NE = range(6)


def c(field, op, value):
    vals = dict(FIELDS)[field]
    v = vals.index(value) if isinstance(value, str) else value
    return (F[field], op, v)


WORDS = dict(FIELDS)["command"]
N = {w: i for i, w in enumerate(WORDS)}
assert [N[w] for w in CREATES] == list(range(N["append"], N["touch"] + 1)) and N["rm"] == len(WORDS) - 1
assert [N[w] for w in PROGRAMS] == list(range(N["check"], N["audit"] + 1))


def run_of(first, last):
    """The commands from `first` to `last` in the list, as conditions."""
    return [c("command", GE, N[first]), c("command", LE, N[last])]


# First match decides.
RULES = [([c("target", EQ, "outside")], "refuse")]
RULES += [(run_of("append", "touch") + [c("target", EQ, "new")], "builtin")]
RULES += [([c("target", EQ, "new")], "refuse")]
RULES += [(run_of("help", "kappa"), "builtin"), (run_of("echo", "rm"), "builtin")]
RULES += [([c("command", EQ, w), c("stored", EQ, "yes")], "reuse") for w in PROGRAMS]
RULES += [([c("command", EQ, w), c("bytes", EQ, "pinned")], "run") for w in PROGRAMS]
# (always?, conditions, answer). No guarantee is stated with "is not": the kernel route does not settle it.
GUARANTEES = [
    (1, [c("command", EQ, "other")], "refuse"),
    (1, [c("target", EQ, "outside")], "refuse"),
    (0, [c("bytes", EQ, "absent")], "run"),
    (0, [c("bytes", EQ, "mismatch")], "run"),
    (0, [c("stored", EQ, "no")], "reuse"),
    # A builtin starts no executable and shows no kept output; the builtins are two runs of the list.
    (0, run_of("other", "kappa"), "run"),
    (0, run_of("echo", "rm"), "run"),
    (0, run_of("other", "kappa"), "reuse"),
    (0, run_of("echo", "rm"), "reuse"),
    (0, run_of("check", "audit"), "builtin"),
    (1, run_of("check", "audit") + [c("target", EQ, "model"), c("bytes", EQ, "pinned"), c("stored", EQ, "no")], "run"),
    (1, run_of("check", "audit") + [c("target", EQ, "model"), c("stored", EQ, "yes")], "reuse"),
    # A path that names no file is refused to every command but the five that make one.
    (1, run_of("other", "cd") + [c("target", EQ, "new")], "refuse"),
    (1, [c("command", EQ, "rm"), c("target", EQ, "new")], "refuse"),
    (1, run_of("append", "touch") + [c("target", EQ, "new")], "builtin"),
    # A builtin whose paths are in the model, or that names none, is always answered.
    (1, run_of("help", "kappa") + [c("target", EQ, "none")], "builtin"),
    (1, run_of("help", "kappa") + [c("target", EQ, "model")], "builtin"),
    (1, run_of("echo", "rm") + [c("target", EQ, "none")], "builtin"),
    (1, run_of("echo", "rm") + [c("target", EQ, "model")], "builtin"),
]
EXAMPLES = [
    ("other none pinned no", "refuse"),
    ("other model pinned yes", "refuse"),
    ("help none absent no", "builtin"),
    ("clear none absent no", "builtin"),
    ("ls model absent no", "builtin"),
    ("cat model mismatch no", "builtin"),
    ("cat outside pinned no", "refuse"),          # a path outside the open model is refused, whatever the command
    ("kappa model absent no", "builtin"),
    ("check model pinned no", "run"),
    ("check model mismatch no", "refuse"),        # bytes that are not the pinned ones never run
    ("check model absent no", "refuse"),
    ("check model absent yes", "reuse"),          # a kept output needs no executable in the tab
    ("check outside pinned yes", "refuse"),
    ("snapshot model pinned no", "run"),
    ("prove none pinned no", "run"),
    ("prove model pinned yes", "reuse"),
    ("audit model mismatch no", "refuse"),
    ("audit model pinned no", "run"),
    ("echo none absent no", "builtin"),
    ("grep model absent no", "builtin"),
    ("cat new absent no", "refuse"),              # a file that is not there cannot be printed
    ("check new pinned no", "refuse"),
    ("write new absent no", "builtin"),           # the five that make a file may name one that is not there yet
    ("write model absent no", "builtin"),
    ("write outside absent no", "refuse"),        # and still never one outside the model
    ("touch new absent no", "builtin"),
    ("rm new absent no", "refuse"),
    ("rm model absent no", "builtin"),
    ("mv new absent no", "builtin"),
    ("cp outside absent no", "refuse"),
    ("save none absent no", "builtin"),
    ("other new pinned yes", "refuse"),
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


body = 'definition{name: title, parameters: [], result: String, body: "Terminal command table"}\n\n'
body += d("fields", "(List Field)", fields)
body += d("answers", "(List String)", lst([s(a) for a in ANSWERS], "String"))
body += f"definition{{name: otherwise, parameters: [], result: Nat, body: {A[OTHERWISE]}}}\n\n"
body += d("rules", "(List Rule)", rules)
body += d("guarantees", "(List Guarantee)", guar)
body += d("examples", "(List Example)", exs).rstrip("\n") + "\n\\end{semanticmodule}\n\\end{lexlean}\n"
open(path, "w", encoding="utf-8", newline="\n").write(head + body)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "commands.json")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump({"builtins": BUILTINS_ALL, "programs": PROGRAMS, "creates": CREATES}, f, indent=1)
    f.write("\n")
print("written", len(RULES), "rules", len(GUARANTEES), "guarantees", len(EXAMPLES), "examples")
