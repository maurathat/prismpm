# What prism-code ships under `wasm/pinned/`

Eight files, each named by the BLAKE3 label of its decoded bytes and laid out as the pinned store is
(`<first two hex>/<remaining 62 hex>`). A file is used only when its bytes have the label prism-code pins, whether it is
read from here, from the machine's store or from the network. The labels are in the source: `LEXLEAN_WASM` in
`src/journey/lexlean-wasm.mjs`, `KERNEL_FILES` in `src/journey/kernel-store.mjs` and `MODEL_KERNEL_FILES` in
`src/journey/model-prove.mjs`.

## LexLean's front end

| File | Label | What it is |
| --- | --- | --- |
| `4f/302c18…74ecb` | `blake3:4f302c18e02a46b0d015c57bd389a0754b301ec876aa7a637f786c4562274ecb` | The `lexlean` executable for `wasm32-wasip1`, gzipped: 19,133,367 bytes decoded. |

Built from [UOR-Foundation/LexLean](https://github.com/UOR-Foundation/LexLean) at commit
`9ba600d071b2bfa6ca990fd38d92a4c47fa9d39c` with
`cargo build --locked --release --target wasm32-wasip1 -p lexlean --bin lexlean --no-default-features`.

Licence: LexLean is the UOR Foundation's, `MIT OR Apache-2.0`.

The module is statically linked with the Rust crates LexLean depends on. Listed from LexLean's lockfile with
`cargo tree --locked --no-default-features -e normal`, there are 61 crates, LexLean included; some are compiled only
for other targets and are not in the module. Every one is offered under MIT, Apache-2.0 or both. Those with further terms:

| Crate | Licence |
| --- | --- |
| `unicode-ident` | (MIT OR Apache-2.0) AND Unicode-3.0 |
| `linux-raw-sys`, `rustix` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `memchr`, `same-file`, `walkdir` | Unlicense OR MIT |
| `tinyvec`, `tinyvec_macros` | Zlib OR Apache-2.0 OR MIT |

The rest: `anstream`, `anstyle`, `anstyle-parse`, `anstyle-query`, `bitflags`, `block-buffer`, `camino`, `cfg-if`,
`clap`, `clap_builder`, `clap_derive`, `clap_lex`, `colorchoice`, `cpufeatures`, `crypto-common`, `digest`,
`equivalent`, `errno`, `fastrand`, `fs4`, `generic-array`, `getrandom`, `hashbrown`, `heck`, `indexmap`,
`is_terminal_polyfill`, `itoa`, `libc`, `once_cell`, `proc-macro2`, `quote`, `semver`, `serde`, `serde_core`,
`serde_derive`, `serde_json`, `serde_spanned`, `sha2`, `signal-hook`, `signal-hook-registry`, `strsim`, `syn`,
`tempfile`, `toml`, `toml_datetime`, `toml_edit`, `toml_write`, `typenum`, `unicode-normalization`, `utf8parse`,
`winnow`, `zmij`. The Rust standard library, also linked, is MIT OR Apache-2.0.

## Lean's kernel, for a rule app

Four files from UOR-Foundation/foundry at commit `7755331b8d1cba879d89a1956c0703b749868abd`: the kernel
(`21/b2c46d…`), its loader (`ac/5db408…`), the lemma library (`1d/8b899e…`) and the rule judge's holo
(`9a/264023…`). What each is, how it is built and its licences are in
[`src/journey/kernel/NOTICE.md`](../src/journey/kernel/NOTICE.md): Lean 4 and lean4export (Apache-2.0), libuv and the
Emscripten runtime support (MIT), and the lemma library, the rule judge and the build (MIT or Apache-2.0).

## Lean's kernel, for a model's own theorems

Three files from UOR-Foundation/PrismPM at commit `67ba3a17656fae808cfa9e6b7419591e35c977c6`, under
`sdk/npm/lean-prover/kernel-path/`: the loader (`ec/13d669…`), the kernel (`2f/254140…`) and the base library
(`f5/502e3d…`). As that folder's own notice, `sdk/npm/lean-prover/kernel-path/NOTICE.md`, says: the kernel is built
from Lean 4 (leanprover/lean4, Apache-2.0), with libuv (MIT) linked, and the base library is an export, by lean4export
(Apache-2.0), of declarations from Lean 4's `Init` (Apache-2.0) and from LexLean's runtime (MIT OR Apache-2.0).
