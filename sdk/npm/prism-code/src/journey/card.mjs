/**
 * The LexLean an agent needs to write a Prism app, on one card: the forms the starters use, the rules LexLean holds
 * them to, and the one proof the kernel finds for a guarantee. LexLean's vocabulary is closed, so a guessed form is
 * refused; this card is what the Prism skill hands the agent before its first edit (skill/references/lexlean-1.2.md). Every form here is a starter's. Its
 * examples, put in the decision-app starter's two modules as written, check and are proved by prism-code check (one
 * theorem, 2026-11-20); test/card.test.mjs holds the card's rules to the starters' own text.
 */
export const LEXLEAN_CARD = `LexLean, as a Prism app uses it. Edit the starter; keep its header lines as they are.

A rule app (starter rule-app) is data, not code: edit the values of title, fields, answers, otherwise, rules, guarantees and examples in src/App.lex.tex, and keep its five structures as they are. Fields and answers are referred to by their position, from 0.
- fields: (record Field {name := "weight", least := 0, greatest := 50, values := (nil String)}) for a number from least to greatest; for a choice, least := 0, greatest := n - 1 and values := (cons "no" (cons "yes" (nil String))), whose positions are the values.
- A condition: (record Condition {field := 1, op := 4, value := 1}). op: 0 <, 1 <=, 2 >, 3 >=, 4 =, 5 not =.
- rules: the first rule whose conditions all hold answers; when none does, otherwise (an answer position) answers.
- A guarantee: (record Guarantee {always := 0, conditions := …, answer := 1}). always := 0: when the conditions hold, the answer is never that one; always := 1: it is always that one. Lean's kernel proves each for every request within the fields' bounds.
- examples: (record Example {request := "1 no", answer := "free"}), the values in field order, a choice by its word. Each is an acceptance vector, with one more the build adds: a request with one value too many answers invalid.
Any other app is written as below.

Module: \\begin{lexlean}{Name} … \\begin{semanticmodule} … \\end{semanticmodule} \\end{lexlean}. A proofs module imports the model with \\importmodule{Name} and refers to it as Name::thing.

Constant: definition{name: answerFree, parameters: [], result: Nat, body: 0}
Choices are Nat constants like this one: one per vehicle, answer or state.

Record: structure{name: Request, type_parameters: [], parameters: [], fields: [{name: hours, type: Nat}, {name: vehicle, type: Nat}]}

Function: definition{name: judge, parameters: [request : Request], result: Nat, body: (if ((project request hours) =? 0) then (answerFree) else (answerStandard))}
- A field: (project request hours). A call: (judge request), (Name::judge request) from another module.
- Comparisons give Bool: =? <? <=?   Logic: && || (not x)   Branch: (if c then a else b)
- Types: Nat, Int, Bool, Bytes, (Option Nat), (List Nat). Write Bool and Nat, never Boolean or Natural.
- Every compound expression is parenthesized. A definition uses only definitions above it.

Guarantee, in the proofs module (the model here is App): say what would break it, then prove that never happens.
definition{name: breaksFreeShort, parameters: [request : App::Request], result: Bool, body: (((project request hours) <=? 0) && (not ((App::judge request) =? (App::answerFree))))}
theorem{
  name: freeShort,
  parameters: [request : App::Request],
  statement: ((breaksFreeShort request) = false),
  proof: linear_arithmetic{definitions: [App::answerFree, App::answerStandard, App::judge, breaksFreeShort]},
  axioms: [Quot.sound, propext]
}
- definitions lists every definition the proof unfolds, the breaks definition included, without repeats, sorted as text: App::… before breaksFreeShort.
- A guarantee about every request bounds it: (((project request hours) <=? 24) && …) inside the breaks body.
- A guarantee of an app that keeps state is an invariant: one theorem that it holds in the initial state, and one per action that the action keeps it, given it held before.
- Declare axioms: [Quot.sound, propext]. A proof that needs fewer is still proved, and said.
- Lean's kernel proves linear_arithmetic, decide and reflexivity proofs here; any other proof kind is reported not proved.

After every edit: npx prism-code check --json. It returns the first problem with the exact fix, or how many theorems Lean proved.`;
