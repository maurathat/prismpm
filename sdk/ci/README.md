# SDK CI: passive README classifier (candidate)

**Status: unreleased experimental SDK tooling. It is not a merge-qualification gate or a released SDK artifact.** Tracked by [PrismPM #794](https://github.com/UOR-Foundation/prismpm/issues/794), [Template #103](https://github.com/UOR-Foundation/template/issues/103), and conformance ID `RP-13`.

## Intended user-facing interface

```sh
python3 sdk/ci/passive_readme_scope.py --repo /path/to/checked-out-pr-head \\
  --base 40-character-trusted-base-commit \\
  --head 40-character-trusted-pr-head
```

The command emits exactly one JSON object: a `PASSIVE_README` receipt with base, head, merge base, complete changed path list, approved PNG Git blob identity and checked link/anchor counts; or `FULL_REQUIRED` and a refusal reason. The latter exits 2. The tool never merges, pushes, approves, modifies working files, executes product code, provisions credentials or reports product/release acceptance. **Only a future trusted qualification workflow may decide which required checks are run.** Do not advertise this command as an accepted bypass.

## Immutable trust boundary

The publisher must release a reviewed tool with pinned SHA-256/committed Git revision and provenance. Consumers must select that tool from a **trusted base workflow** and validate its exact digest before execution; never download or execute the classifier, its tests or rule descriptions from a pull-request head. Base/head full identifiers must derive from a trusted GitHub event, be fully fetched, and correspond to the exact checked-out PR head. Unknown history and missing objects refuse. This CLI's `--base` and `--head` arguments are trust inputs, not self-authenticating identities.

Current proposed eligible paths are `README.md` and `assets/readme-banner-PLACEHOLDER.png`, with the provisional image's immutable Git object `29273d499d3891ccc728f10eef601776884e639d`. Only changed regular files, intact recognized generated regions, verified local links/anchors and no other file changes can qualify. Future formats need new negative fixtures before broadening the allowlist.

## Development proof

```sh
python3 -m unittest discover -s sdk/ci -p 'test_passive_readme_scope.py' -v
cargo test --locked -p repo-conformance --test conformance conformance_rp_13 -- --exact
```

`RP-13` checks the complete currently pinned **41-case** fixture inventory and refuses skipped/omitted cases. Additional repository conformance, model generation, Windows runner tests, reference-style Markdown links, HTML link interpretation, duplicate heading slugs, Unicode, symlink changes and trust-root forgery remain production-admission review targets. A green fixture run is *algorithm evidence*, not an independently released tool.

## Integration and release gates

1. Land upstream model/contract and executable conformance only after full PrismPM CI, independent adversarial review and generated `CONFORMANCE.md` parity.
2. Produce a small portable independently runnable SDK CI release with immutable digest and attestation; verify it works without Docker or Lean on a docs-only runner.
3. Rewrite Template #111 to invoke the **base-pinned SDK artifact**, remove three handwritten non-Prism files, and regenerate its modeled conformance outputs without breaking the `audit-prism` ratchet.
4. Keep full source/model/lock/generated workflows, main, merge-group, release and publication acceptance. The new stable required check must witness all selected jobs and cannot be trivially green.
5. Run a real docs-only PR and a mixed-source PR as positive/negative deployments, verify effective branch-protection contexts, then and only then merge MNIST #24 and Calculator Example #31.
