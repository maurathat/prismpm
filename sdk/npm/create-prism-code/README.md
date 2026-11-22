# create-prism-code

Scaffold a Prism SDK project (issue [#281](https://github.com/UOR-Foundation/PrismPM/issues/281)).

```
npm create prism-code calculator
```

This is `npx prism-code@latest init` under the name `npm create` looks for; both write the same files:
`prism.toml`, a starter LexLean model to edit, and the Prism skill for an agent, all inside the folder.
Options are those of `prism-code init --help`; pass them after `--`, as in
`npm create prism-code calculator -- --template decision-app`.

`create-prism` on npm is an unrelated package; this one is `create-prism-code`.
