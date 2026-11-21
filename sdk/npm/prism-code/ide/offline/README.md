# Offline, by content (phase 2d, first step)

The published site has a service worker that serves every file by its content. It is the first step of phase 2d of `docs/proposals/prism-ide-phase-2.md`.

`tools/build-offline-site.mjs` runs last when the site is assembled and writes two files at the site's root:

- `offline.json`: every published file with its BLAKE3 label and size.
- `sw.js`: prism-code's own `src/blake3.mjs`, then `sw-body.js`. One classic script, since not every browser starts a worker written as a module. The label a page checks and the label the worker checks are the same code.

Each page registers the worker. From then on:

- A file the listing names is answered from the browser's store when its bytes still derive to its label. Otherwise it is fetched, checked against the label, kept, and answered.
- Bytes that are not what the listing names are refused. The page gets an error that names both labels, never the bytes.
- Anything the listing does not name goes to the network untouched.
- If the worker itself faults, the request goes to the network: a fault here must not take the site down.

So a page that has been opened once opens again with the network off, and one changed byte in a stored or fetched file is not served.

## A new deployment

On each page load the worker asks for the newest listing, for at most 2.5 s, under an address no cache has seen. When it differs from the one held, stored files that no listing names are dropped. A file that fails its check is tried a second time past any cache in between, and then against the newest listing, before it is refused: a file is not refused for being newer than the listing the worker happened to hold.

## Tested

`tools/offline-test.mjs`, in the IDE kernels workflow, runs the worker exactly as it is published against a network and a store held in memory:

- a listed file is fetched, checked and kept, and the next request asks the network for nothing;
- with the network off, everything fetched once still opens, and a file never fetched is reported as not kept;
- planted defect: the site serves bytes the listing does not name; they are refused, not kept, and other files are still served;
- planted defect: a kept file altered by one byte is not served from the store;
- a new deployment is taken up, and files nothing names are dropped;
- unlisted paths, the listing and the worker itself are left to the network.

The Pages workflow checks that the worker parses and that every listed file is the bytes its label names.

## Tried in a real browser

`tools/offline-trial.mjs` drives a headless Edge over the DevTools protocol. On one Windows machine, the site assembled as Pages serves it (under `/prismpm/`, no dot-files):

| Step | Shown |
|---|---|
| First visit to the workbench page | 13 of 13 guarantees proved; the worker took over and kept the 72 files the page had loaded |
| Second visit | the same; the site was asked for 3 files, the rest came from the store |
| The site switched off, third visit | the workbench opens with its Explorer and proves 13 of 13; no request failed |
| The site back on, one byte of `edit/app-match.mjs` changed, the listing left alone | that file: HTTP 502, "the bytes received are blake3:c19b2c26…, not the … this site's listing names"; another file: served |

## Limits

- **The listing is the site's own.** The worker checks files against a listing the same origin serves, so this guards against a damaged or half-published site and gives offline use. It is not a guard against the origin itself.
- **Each page works offline after it has been opened once.** Opening the workbench does not keep the audit page, and the other way round. In the trial, the plain edit page and the audit page, never opened, did not open offline.
- **An app's own files are not kept.** The audit of a published app, and a model opened by `?project=`, come from the app's host and need the network.
- **Every file is hashed on every load.** That is what "one changed byte is refused" costs. The time it adds was not measured.
- **Not tried on GitHub Pages itself**, and in one browser only. The built-in browser pane used for the other pages' trials cannot register a service worker at all.
- **No way to switch it off from the page.** Clearing the site's data in the browser removes the worker and its store.
- The kappa-registry client and moving `kappa-opfs` to BLAKE3, the rest of phase 2d, are not started.
