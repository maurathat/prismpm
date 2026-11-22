# Prism IDE (spike)

A browser-first IDE for Prism apps: the editor and extension host of `@codingame/monaco-vscode-api`, with every call an extension makes to the page judged by LexLean models before it runs.

This folder is a spike. It is not in the published `prism-code` package, and `prism-code init` does not install or open it.

## What decides

| Decision | Model | State |
|---|---|---|
| May this extension use this resource: deny, allow or ask | [`../model/ide-capability-gate`](../model/ide-capability-gate/README.md) | 13 guarantees accepted by Lean's kernel; the page runs the built judge |
| Is this editor command `show` or `exec` | [`../model/ide-command-table`](../model/ide-command-table/README.md) | 5 guarantees accepted by Lean's kernel; the page runs the built judge |
| Is this path or host inside a granted scope | [`../model/ide-scope`](../model/ide-scope/README.md) | 8 theorems proved by Lean; the page runs `src/scope.js`, a tested copy of the rules, not the model |

Everything else in `src/` is unproved page code: turning a call into a request (`main.js`, `method-table.json`), the Prism ID wiring and the signed, sealed grants store (`identity.js`), and the scope rules copy (`scope.js`).

## What was measured

[`BATCH.md`](BATCH.md): the 25 most-downloaded Open VSX web extensions, loaded unmodified. 18 activate with the gate on, the same 18 as with it off. [`SPIKE.md`](SPIKE.md) and [`METHOD-TABLE.md`](METHOD-TABLE.md) describe the gate's two hooks and the class of every method an extension can call.

## What is not here

- The extensions under test. `tools/fetch_batch.py` downloads them from open-vsx.org and checks each against the SHA-256 in `public/ext/batch.json`. Each has its own licence.
- The judge archive and the copy of prism-code the page loads (`public/gate/kernel.holo`, `public/gate/prism-code/`). Building either rule-table model with prism-code writes them to its `.prism/site/`.
- The Prism ID frame. `tools/prism-frame-pin.mjs` fetches it from `UOR-Foundation/template` at the commit in `public/prism-frame/PIN.json` and checks every file against that record.

## Run it

```sh
npm ci
python -I tools/fetch_batch.py           # the extensions under test
node tools/prism-frame-pin.mjs           # the Prism ID frame
# copy kernel.holo and prism-code/ from a built rule-table model's .prism/site/ into public/gate/
npx vite build
npx vite preview --port 4173 --strictPort &
npx vite preview --port 4174 --strictPort &   # the second origin the extension worker runs on
# then open http://localhost:4173/batch.html
node tools/scope-test.mjs                # the scope rules copy, 35 cases
```

## Known limits

- Which worker hosts which extension is taken from the worker's own activation notices.
- The Prism ID relay is not admitted, so the id stays on one device; linking, sync and recovery are untested here.
- Activation only: apart from one extension, no extension's actual feature was exercised.
- Nothing is stored in or fetched from a kappa-registry; only the `blake3:` label form is shared with it.

## The audit view (phase 2a)

`audit/` is a static page, with no build step, that shows one Prism app as a person can check it: what it decides, each guarantee with what backs it, its examples replayed, and its fingerprint in BLAKE3 and SHA-256. It is the first step of `docs/proposals/prism-ide-phase-2.md`.

It proves nothing itself, and it does not decide what a guarantee may be called. That is asked of the proved audit-status model ([`../model/ide-audit`](../model/ide-audit/README.md)), whose built record is `audit/audit-status.rule-app.json`.

- **A rule app** (`app.rule-app.json`). The app's own published page already checks its judge archive, runs its examples and proves every guarantee with Lean's kernel in the tab. The view loads that page in a frame and reads what it found. "Proved" means the kernel, in this tab.
- **A holo** (`app.holo`). The holo is judged in the tab by prism-code's verifier, loaded, and its examples replayed through its own guest. Lean does not run in the tab for a holo. "Proved" means the holo carries a proof statement the verifier accepted at level P2 or above, about this holo's own model. With no proof statement, the theorems the app's `app.json` claims are listed as claims.

```sh
node tools/serve-audit.mjs <a rule app's .prism/site folder, or a folder holding app.holo>
# then open http://localhost:4180/audit/
```

Published: `.github/workflows/ide-audit-pages.yml` assembles the page with `tools/build-audit-site.mjs` (the page, prism-code's `src` as the page imports it, the rule judge archive, and `site.json` naming every file with its SHA-256 and the commit) and deploys it to this repository's GitHub Pages on each change on `main`, at `https://uor-foundation.github.io/prismpm/audit/`. Opened with no app, the page asks for an address; `?app=https://owner.github.io/app/` opens that app.

The server also gives the page this checkout's prism-code and the rule judge archive (`test/fixtures/kernel/kernel.holo`), so the page does not rely on the app's copies.

Tried by hand in one browser:

| App | Shown |
|---|---|
| `model/ide-capability-gate` as a rule app, as built | 13 of 13 guarantees proved, in about 2 s; 6 rules and the fallback in words; 19 of 19 examples the same |
| The same, one rule changed, old proof kept | 0 proved, 13 refused: the app refuses itself; the changed rule reads "granted is no → allow" |
| The same, one rule changed, proof removed | 0 proved, 13 refused: an example gives a different answer than recorded |
| `fixtures/Calculator.holo` | level P0; 1 row, tested: "the holo carries no proof statement"; 22 of 22 examples the same |
| The same holo, one byte flipped | refused: "the footer is not the BLAKE3 of the body"; examples not replayed |
| Two published apps, their `app.holo` and `app.json` fetched from GitHub Pages on 2026-11-20 (a leap-year app, 1 claimed theorem; a tax-filing app, 6) | level P0; each claimed theorem listed with the app's own account of how it was proved, marked tested: "claimed by the app, not checked here: the holo carries no proof statement"; 12 of 12 and 62 of 62 examples the same |
| `test/fixtures/signed/Calculator.signed.holo`, with the key that signed it (`signer.pub.pem`) given to the page | **level P2; its 5 theorems proved**: "this tab checked the statement and its signature against the signer, not the proof itself"; both statements' signatures verify; 22 of 22 examples the same |
| The same holo, no key given | level P0; 5 theorems tested: "no signer was named, and an unchecked signature is no evidence" |
| The same holo, another key given | level P0; 5 theorems tested: "the signature does not verify against the key given" |
| `test/fixtures/signed/PaymentApproval.mismatch.holo`, right key | level P1; 5 theorems tested: "the proof statement is about another model" |

### Every kind of app the SDK builds

Run on 2026-11-20 with prism-code 0.10.0 from this checkout.

**Rule apps**, built here by the SDK's rule-app build and served beside the page:

| App | Shown |
|---|---|
| The SDK's own rule-app starter (`templates/starters/rule-app`) | 3 of 3 proved; 4 rules and the fallback; 2 of 2 examples |
| `model/ide-capability-gate` | 13 of 13 proved; 19 of 19 examples |
| `model/ide-command-table` | 5 of 5 proved; 5 of 5 examples |
| `model/ide-audit` | 14 of 14 proved; 12 of 12 examples |

**Holo apps**, all 13 that were found published on GitHub Pages under the two accounts looked at, each audited from its live address with `?app=https://<owner>.github.io/<app>/` and no change to the app:

| Result | Apps |
|---|---|
| Level P0; every claimed theorem listed and marked tested; every example the same (from 12 of 12 up to 181 of 181) | 12 |
| Refused: `core.exports: guest exports ["__stack_high","__stack_low","holo_alloc","holo_run","memory"], expected ["holo_alloc","holo_run","memory"]` | 1 |

The one refusal is the SDK's own judgement, not the page's: `prism-code vectors` on that holo exits 2 with the same message, and `prism-code check` reports `world.contract`. That app ships prism-code 0.9.1, which loads it.

What this does not cover: a holo app is reached by its address, so the page has to be opened with that address; no app links to it. A rule app is audited only when served from the page's own origin, so the published page audits holo apps only.

What the published apps showed: none of the 13 holos in this repository and neither published holo carries a proof statement, so every one is at level P0. For the two published apps GitHub holds signed build provenance (`gh attestation verify` passes, predicate `https://slsa.dev/provenance/v1`), which says which workflow built the bytes. The statement that Lean proved a named theorem exists only as text in the app's `app.json`. The audit view therefore shows those theorems as claimed and tested, never proved. Marking them proved needs the build to put its proof statement in the holo (`prism-code attest --statement`), which is outside this folder.

Limits:

- **A holo is shown as proved only for a key the auditor gives the page.** `audit/signature.mjs` checks a statement's signature with WebCrypto: a Sigstore bundle v0.3 with a DSSE envelope, signed by ECDSA P-256 with SHA-256. prism-code's verifier is then told which statements verified and gives the level, as `check --key` does in Node. `tools/signature-test.mjs` holds this to the five verdicts `test/fixtures/signed` pins for `check`.
- **Keyless signatures: the check exists, the page does not use it, and GitHub's attestations do not pass it.** `audit/keyless.mjs` checks a certificate-signed statement in three parts: the certificate names the identity and issuer the auditor expects, the DSSE signature verifies with the certificate's key, and the certificate chain and log entry pass prism-code's `verifyTransparency` against a trusted root the auditor pins. `tools/keyless-test.mjs` runs it on the Sigstore conformance bundles this repository keeps: the valid statement bundle is accepted, the two invalid ones refused, and the valid one refused again for another identity, another issuer, one changed payload byte, no pinned root and nobody named.
- **On a real GitHub attestation** (the 8 bundles GitHub holds for one published app's holo, checked against Sigstore's public trusted root fetched from `sigstore/root-signing` on 2026-11-20, SHA-256 `6494e21e…bc0b66`): the certificate names the app's `pages.yml` workflow and GitHub's issuer, and the signature verifies; a wrong repository, a wrong issuer and a changed payload are each refused. The last part fails for all 8: `certificate.chain: The signing certificate cannot be placed in time without a verified timestamp`. Those bundles are Rekor v1 entries with a signed entry timestamp and no RFC 3161 timestamp, and `verifyTransparency` does not use the signed entry timestamp (`sdk/npm/verify/README.md`). So no GitHub attestation for a public repository is accepted today. Accepting them means that verifier learning to take its time from the signed entry timestamp, which is its maintainers' change, not this folder's.
- **The audit page does not call the keyless check.** No holo carries a keyless statement to try it on, and the real bundles do not pass. A statement signed with a certificate is still reported as not counted.
- Neither the real bundles nor the public trusted root is committed. A trusted root belongs in the repository only by the maintainers' choice and through Sigstore's update framework, not a file fetched once.
- **This is a second place that tells the verifier a signature verified.** `src/verify.mjs` keeps that entry (`verifyWithStatements`) out of the package on purpose, "check's alone". The page calls the vendored verifier's `verify` with `statements` directly. It needs a maintainer's decision before anything ships.
- **The key is trusted because the auditor supplied it.** A page that took the key from the app would prove nothing.
- A rule app must be served from the audit page's origin, because its own page does the proving. A holo app may be anywhere that lets its files be fetched, which GitHub Pages does.
- Files are fetched by path. Fetching by content label is phase 2d.
- An app that refuses itself is reported to the audit-status model as failing its examples. The model has no word for "the app did not admit its own record"; that is the conservative choice among the words it has, and a reason to give it one.
- For a holo, the examples are replayed as a whole. The view shows the count, not each request.
- No automated test runs the page. The table above is from manual runs.
