# Changelog

## [0.2.0](https://github.com/UOR-Foundation/prismpm/compare/prism-code-verify-v0.1.0...prism-code-verify-v0.2.0) (2026-11-22)


### ⚠ BREAKING CHANGES

* **holo:** holo v5 is a UORC archive named by κ (ADR-017) ([#663](https://github.com/UOR-Foundation/prismpm/issues/663))

### Features Added

* **conformance:** the Rust runtime runs @prism-code/conformance ([#590](https://github.com/UOR-Foundation/prismpm/issues/590)) ([d9373f9](https://github.com/UOR-Foundation/prismpm/commit/d9373f952cfc5ef1524b79791346085ef60f7a9d))
* **holo:** a holo v6 is read, verified, signed, pushed and pulled (ADR-018) ([ce0b6fd](https://github.com/UOR-Foundation/prismpm/commit/ce0b6fdf4d039fd3d8e60a020cc3a222ad7d22b8))
* **holo:** format revision 2026-11-18 and the binary application profile (HO-49, HO-50) ([#728](https://github.com/UOR-Foundation/prismpm/issues/728)) ([9411067](https://github.com/UOR-Foundation/prismpm/commit/941106701450c50d8574ba1de9b5bff68d27bfe9))
* **holo:** holo v5 is a UORC archive named by κ (ADR-017) ([#663](https://github.com/UOR-Foundation/prismpm/issues/663)) ([7b48b4d](https://github.com/UOR-Foundation/prismpm/commit/7b48b4d4939a7fa42c623c4a596357384fbe1566))
* **prism-code:** canonical path, integrity fails every policy, refuse text, local by default ([#648](https://github.com/UOR-Foundation/prismpm/issues/648)) ([6b2c684](https://github.com/UOR-Foundation/prismpm/commit/6b2c6844e3df025ca6ddb25a4052695dcc75805d))
* **prism-code:** checkpoints, the hologram:guest/core-wasm@3 world (HO-47, HO-48) ([#723](https://github.com/UOR-Foundation/prismpm/issues/723)) ([f09dc05](https://github.com/UOR-Foundation/prismpm/commit/f09dc056421931b50f68ae5ea564f39d08d284e3))
* **prism-code:** sessions, the hologram:guest/core-wasm@2 world (Part of [#629](https://github.com/UOR-Foundation/prismpm/issues/629)) ([#638](https://github.com/UOR-Foundation/prismpm/issues/638)) ([9d31247](https://github.com/UOR-Foundation/prismpm/commit/9d312473d32df18d95356f6d9b48f48e6d37fb56))
* **prism-code:** the browser store keeps bytes under their BLAKE3 label ([a5d4b6e](https://github.com/UOR-Foundation/prismpm/commit/a5d4b6ec90008e76c434a1620c1ea7e136ea687b))
* **verify:** read and verify a holo v6, sealed and labelled by BLAKE3 (ADR-018) ([78872eb](https://github.com/UOR-Foundation/prismpm/commit/78872eb5a60fa46d39a681cd754a70b3f3f1b065))


### Bugs Fixed

* **verify:** say plainly that a built holo does not carry its proof ([#600](https://github.com/UOR-Foundation/prismpm/issues/600)) ([46b13cc](https://github.com/UOR-Foundation/prismpm/commit/46b13cc72be35af3919a654438096adcbf0cd6bd))


### Other Changes

* **prism-code:** carry the faster BLAKE3 into every copy of it ([576b17e](https://github.com/UOR-Foundation/prismpm/commit/576b17eef4d5e9ce2df204255a57b861470b739b))
