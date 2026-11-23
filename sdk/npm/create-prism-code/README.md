# create-prism-code

Every Prism app starts with one command:

```
npx prism-code@latest init calculator
```

This package is that same command under the name `npm create` looks for (`npm create prism-code calculator`,
issue [#281](https://github.com/UOR-Foundation/PrismPM/issues/281)); both write the same files:
the canonical template, `UOR-Foundation/template`, with its LexLean model to edit in `app/src/`,
`prism.toml` naming the app, and the Prism skill for an agent, all inside the folder, fetching nothing.
Options are those of `prism-code init --help`; pass them after `--`, as in
`npm create prism-code calculator -- --name fee-tier`.

`create-prism` on npm is an unrelated package; this one is `create-prism-code`.
