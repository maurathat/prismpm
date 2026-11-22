# Changelog

## [0.2.0](https://github.com/UOR-Foundation/prismpm/compare/prism-code-conformance-v0.1.0...prism-code-conformance-v0.2.0) (2026-11-22)

### Features Added

* **conformance:** the Rust runtime runs @prism-code/conformance ([#590](https://github.com/UOR-Foundation/prismpm/issues/590)) ([d9373f9](https://github.com/UOR-Foundation/prismpm/commit/d9373f952cfc5ef1524b79791346085ef60f7a9d))
* **holo:** a holo v6 is read, verified, signed, pushed and pulled (ADR-018) ([ce0b6fd](https://github.com/UOR-Foundation/prismpm/commit/ce0b6fdf4d039fd3d8e60a020cc3a222ad7d22b8))
* **holo:** format revision 2026-11-18 and the binary application profile (HO-49, HO-50) ([#728](https://github.com/UOR-Foundation/prismpm/issues/728)) ([9411067](https://github.com/UOR-Foundation/prismpm/commit/941106701450c50d8574ba1de9b5bff68d27bfe9))
* **holo:** holo v5 is a UORC archive named by κ (ADR-017) ([#663](https://github.com/UOR-Foundation/prismpm/issues/663)) ([7b48b4d](https://github.com/UOR-Foundation/prismpm/commit/7b48b4d4939a7fa42c623c4a596357384fbe1566))
* **holo:** host effect protocol for server applications, on main (slice 1 of [#216](https://github.com/UOR-Foundation/prismpm/issues/216)) ([#561](https://github.com/UOR-Foundation/prismpm/issues/561)) ([89bf574](https://github.com/UOR-Foundation/prismpm/commit/89bf5747b8c13b09121aeaa694bc9209b82110e9))
* **holo:** verify and replay a server application without its source, on main (slices 3 and 4 of [#216](https://github.com/UOR-Foundation/prismpm/issues/216)) ([31b8dbc](https://github.com/UOR-Foundation/prismpm/commit/31b8dbc33e433741d55d66c792381a9826f69c80))
* **prism-code:** canonical path, integrity fails every policy, refuse text, local by default ([#648](https://github.com/UOR-Foundation/prismpm/issues/648)) ([6b2c684](https://github.com/UOR-Foundation/prismpm/commit/6b2c6844e3df025ca6ddb25a4052695dcc75805d))
* **prism-code:** checkpoints, the hologram:guest/core-wasm@3 world (HO-47, HO-48) ([#723](https://github.com/UOR-Foundation/prismpm/issues/723)) ([f09dc05](https://github.com/UOR-Foundation/prismpm/commit/f09dc056421931b50f68ae5ea564f39d08d284e3))
* **prism-code:** sessions, the hologram:guest/core-wasm@2 world (Part of [#629](https://github.com/UOR-Foundation/prismpm/issues/629)) ([#638](https://github.com/UOR-Foundation/prismpm/issues/638)) ([9d31247](https://github.com/UOR-Foundation/prismpm/commit/9d312473d32df18d95356f6d9b48f48e6d37fb56))
* **prism-code:** the browser store keeps bytes under their BLAKE3 label ([a5d4b6e](https://github.com/UOR-Foundation/prismpm/commit/a5d4b6ec90008e76c434a1620c1ea7e136ea687b))
* **prism-code:** trust decisions in verify, signing in auth (Part of [#449](https://github.com/UOR-Foundation/prismpm/issues/449)) ([#623](https://github.com/UOR-Foundation/prismpm/issues/623)) ([c37d5a8](https://github.com/UOR-Foundation/prismpm/commit/c37d5a82f7752139b22291c18eef2620627eb162))
* **view:** Hologram design system for every Prism app, closure v2 and build provenance ([18a60a3](https://github.com/UOR-Foundation/prismpm/commit/18a60a32769fdbe8bd88b75d1e00fd5e992af672))

### Breaking Changes

* **holo:** holo v5 is a UORC archive named by κ (ADR-017) ([#663](https://github.com/UOR-Foundation/prismpm/issues/663))

### Bugs Fixed

* **ci:** pass the format gate, the prism-code size cap and the docs lint on PR 550 ([68104d7](https://github.com/UOR-Foundation/prismpm/commit/68104d7d8dfb922308c3a0b38d7f4c63262cf5f9))
* **prism-code:** load refuses an altered holo (Fixes [#583](https://github.com/UOR-Foundation/prismpm/issues/583)) ([#591](https://github.com/UOR-Foundation/prismpm/issues/591)) ([62cbf2a](https://github.com/UOR-Foundation/prismpm/commit/62cbf2a633bdac47a2a48d42a3310ad77b5b121c))

### Other Changes

* **conformance:** a holo v6 opens, gets the v5 verdict, and fails a broken BLAKE3 seal ([9024cb4](https://github.com/UOR-Foundation/prismpm/commit/9024cb42b74140319e1e9d74d401ad8703d518a5))
* **conformance:** exempt the slice 1 model document change from the format gate ([#246](https://github.com/UOR-Foundation/prismpm/issues/246)) ([c01e5bd](https://github.com/UOR-Foundation/prismpm/commit/c01e5bdfa65fde052238967f9101dd68e82e2b28))
* **conformance:** keep the slice 1 exemption true after slices 2 to 4 ([#342](https://github.com/UOR-Foundation/prismpm/issues/342)) ([20d9c82](https://github.com/UOR-Foundation/prismpm/commit/20d9c822907b54b24e91a60356759746701cb3bc))
* **conformance:** state precisely what the slice 1 exemption leaves unchanged ([#246](https://github.com/UOR-Foundation/prismpm/issues/246)) ([92fffab](https://github.com/UOR-Foundation/prismpm/commit/92fffabda0433a24aa3db8db7c07106ce7db9f39))
* **conformance:** the five replay checks, now that replay is on main ([#588](https://github.com/UOR-Foundation/prismpm/issues/588)) ([a6233ca](https://github.com/UOR-Foundation/prismpm/commit/a6233caf01476f38353a1e900ae0f1f9a3f59796))
* **prism-code:** carry the faster BLAKE3 into every copy of it ([576b17e](https://github.com/UOR-Foundation/prismpm/commit/576b17eef4d5e9ce2df204255a57b861470b739b))
* **prismpm:** Rust module cuts for contracts, canonical, advisory and reference syntax (Part of [#448](https://github.com/UOR-Foundation/prismpm/issues/448)) ([#626](https://github.com/UOR-Foundation/prismpm/issues/626)) ([089dcf1](https://github.com/UOR-Foundation/prismpm/commit/089dcf1e0c7d21d23ccc7a4ca56146276d146a2a))
