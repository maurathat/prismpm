# Changelog

## [0.1.2](https://github.com/UOR-Foundation/prismpm/compare/prism-code-lean-prover-v0.1.1...prism-code-lean-prover-v0.1.2) (2026-11-22)


### Features Added

* **prism-code:** the browser store keeps bytes under their BLAKE3 label ([a5d4b6e](https://github.com/UOR-Foundation/prismpm/commit/a5d4b6ec90008e76c434a1620c1ea7e136ea687b))


### Bugs Fixed

* **lean-prover:** one refused LexLean-produced proof no longer sinks a project; prism-code proves from LexLean's declarations ([#762](https://github.com/UOR-Foundation/prismpm/issues/762)) ([5ae88fa](https://github.com/UOR-Foundation/prismpm/commit/5ae88facb207f654b182b061efcfb99478635b2a))


### Other Changes

* **main:** release prism-code 0.10.3 ([#755](https://github.com/UOR-Foundation/prismpm/issues/755)) ([7e3bfa6](https://github.com/UOR-Foundation/prismpm/commit/7e3bfa64c5577b4e27fe982d2c220048916742bd))
* **prism-code:** carry the faster BLAKE3 into every copy of it ([576b17e](https://github.com/UOR-Foundation/prismpm/commit/576b17eef4d5e9ce2df204255a57b861470b739b))

## [0.1.1](https://github.com/UOR-Foundation/prismpm/compare/prism-code-lean-prover-v0.1.0...prism-code-lean-prover-v0.1.1) (2026-11-20)

### Features Added

* **lean-prover:** a sealed browser prover, and the kernel path, judged by Lean 4.32.2 ([e90a4d0](https://github.com/UOR-Foundation/prismpm/commit/e90a4d0ef57c19b1e0d173e94f13b846c625d8ce))
* **lean-prover:** a sealed browser prover, hashed by Hologram's BLAKE3, that remembers verdicts by label ([c4fb8a9](https://github.com/UOR-Foundation/prismpm/commit/c4fb8a93f94c68b22594ec97e2bbf74de5b36e8a))
* **lean-prover:** any browser completes a proof, and the kernel path proves Prism guarantees ([d18ff06](https://github.com/UOR-Foundation/prismpm/commit/d18ff061c0bf8f827279fdb524d52ec90376eb62))
* **lean-prover:** case analysis on an equation hypothesis ([64bb62a](https://github.com/UOR-Foundation/prismpm/commit/64bb62ad7c0203ae062066168565f2e5aef51ced))
* **lean-prover:** case analysis on an equation hypothesis ([4370034](https://github.com/UOR-Foundation/prismpm/commit/43700342135040b28623a73c40c5c7c0ccf7ca58))
* **lean-prover:** CI keeps the engine, the library and a browser corpus as artifacts ([f5c7029](https://github.com/UOR-Foundation/prismpm/commit/f5c70296861564459b1fa9fed940c229e01f6f7b))
* **lean-prover:** judge axioms by LexLean's per-module policy table (CL-28) ([a7d2e9a](https://github.com/UOR-Foundation/prismpm/commit/a7d2e9a28957ce5818bfe6524a5c9cafd1852d06))
* **lean-prover:** kernel declarations from LexLean, and proofs for every proof kind ([f9eb098](https://github.com/UOR-Foundation/prismpm/commit/f9eb098a8be8149371221ea73050c5501f4546bc))
* **lean-prover:** one kernel-path prover serves every build and every tab of the origin ([009bcb8](https://github.com/UOR-Foundation/prismpm/commit/009bcb821e09eedb4a334fa66172f1cefbefe8a6))
* **lean-prover:** prove a whole LexLean project in a browser tab, and match entrypoints by module name ([f7373ae](https://github.com/UOR-Foundation/prismpm/commit/f7373ae77d8678f8ef63c138e6ec453e1593b8c4))
* **lean-prover:** prove every Prism app with Lean's kernel, in the tab and in prism-code ([5c6b4fa](https://github.com/UOR-Foundation/prismpm/commit/5c6b4faed715a4fa65d291d691a8f6a08aef048c))
* **lean-prover:** prove projects from LexLean's own kernel declarations ([8e2792e](https://github.com/UOR-Foundation/prismpm/commit/8e2792eb3037758779db05af971e166720efa329))
* **lean-prover:** prove projects from LexLean's own kernel declarations ([67ba3a1](https://github.com/UOR-Foundation/prismpm/commit/67ba3a17656fae808cfa9e6b7419591e35c977c6))
* **lean-prover:** register LP-01 to LP-11 and the 12 lean-prover diagnostics ([9d94e9d](https://github.com/UOR-Foundation/prismpm/commit/9d94e9d68a2bb74459ad46e6a4ddfc95a0be43fd))
* **lean-prover:** shards carry each blob gzip-encoded; shardsFor for hosts that fetch tarballs; fetch-tools makes its work folder ([07ab3ff](https://github.com/UOR-Foundation/prismpm/commit/07ab3ff365a1352cef24e0a0f097965aede554cd))
* **lean-prover:** the engine and library as npm packages named by BLAKE3 label ([14165bb](https://github.com/UOR-Foundation/prismpm/commit/14165bbd99c638dafa619fdf0066838050e57c19))
* **lean-prover:** the gate's fixed corpus and speed record ([90b411d](https://github.com/UOR-Foundation/prismpm/commit/90b411db1404e24cb470ae81466ed89156e91206))
* **lean-prover:** the kernel path fetches the kernel and the library only when a kernel starts ([0c903c7](https://github.com/UOR-Foundation/prismpm/commit/0c903c74ab730a91f173e0c7529ffa028996a4ef))
* **lean-prover:** the kernel path proves a Prism app's Boolean guarantees with no elaborator ([d09fc16](https://github.com/UOR-Foundation/prismpm/commit/d09fc16e7e8aa71dff007d5f1477406a7b6c07ed))
* **lean-prover:** the kernel path proves rfl and decide checks, record fields and natural subtraction ([052a697](https://github.com/UOR-Foundation/prismpm/commit/052a697169f37e888ef9a42e9959faa49a21fed2))
* **lean-prover:** the kernel path, proofs judged by Lean's kernel alone ([4e4ab4c](https://github.com/UOR-Foundation/prismpm/commit/4e4ab4c7b7da2c3bf99cd2186bf323e41858ce38))
* **lean-prover:** the kernel path's library is exported from the build LexLean verified ([7031168](https://github.com/UOR-Foundation/prismpm/commit/7031168ff6c8181736f49efafb11db1d0f6e351b))
* **lean-prover:** the sealed browser prover runs the kernel path, with no Lean elaborator ([7db3903](https://github.com/UOR-Foundation/prismpm/commit/7db39034f8f0b982f298f97b29a8c93966485959))
* **lean-prover:** the sealed prover re-proves only what an edit changed, and restarts Lean to bound its memory ([6466c01](https://github.com/UOR-Foundation/prismpm/commit/6466c016555dec55431da1ae17716bb13e29c995))
* **lean-prover:** the WASM Lean prover in sdk/npm/lean-prover ([15e2964](https://github.com/UOR-Foundation/prismpm/commit/15e2964bf1cc35acec82073982106a5a5af48147))
* **lean-prover:** the WASM Lean prover, ported from the foundry prototype ([512e385](https://github.com/UOR-Foundation/prismpm/commit/512e38598dbef1066564d21e6055f94394bfc924))

### Breaking Changes

None.

### Bugs Fixed

* **lean-prover:** a sealed judge resumes from an image larger than a fresh kernel's memory ([de5f352](https://github.com/UOR-Foundation/prismpm/commit/de5f3525dc4f8ccd38d6491ab51c3afdae0ba3b5))
* **lean-prover:** a sealed judge resumes from an image larger than a fresh kernel's memory ([20f8d4c](https://github.com/UOR-Foundation/prismpm/commit/20f8d4c8a05a694153d31340878477ae5e0003a5))
* **lean-prover:** Leap's two bound theorems declare the axioms Lean observes ([16b3192](https://github.com/UOR-Foundation/prismpm/commit/16b31929bf857cbb8f8572bc82adaa4c03e77022))
* **lean-prover:** return JavaScript heap pointers at full width in the 64-bit engine ([1c942d1](https://github.com/UOR-Foundation/prismpm/commit/1c942d1333ee44d41e12ae9421e186c1dbef40f7))
* **lean-prover:** the 4 GiB-capped gate run is under Node 24, since Node 22 cannot instantiate the engine ([810d846](https://github.com/UOR-Foundation/prismpm/commit/810d846668ac52241b6993a95be8c4a1033b4158))
* **lean-prover:** the gate restarts the engine inside a project, before its memory reaches the ceiling ([cafc247](https://github.com/UOR-Foundation/prismpm/commit/cafc2479ce8c59cd2aaa9951803800ade89a43a4))
* **lean-prover:** the gate's run under a 4 GiB cap restarts the engine at 1.5 GiB ([aab6712](https://github.com/UOR-Foundation/prismpm/commit/aab671284feb0f9da97fa33511fbae5987e623a3))
* **lean-prover:** the kernel path proves statements that use || ([ed543db](https://github.com/UOR-Foundation/prismpm/commit/ed543dbb923e470be16523ca2b283de98eedd667))
* **lean-prover:** the kernel path proves statements that use || ([4933abd](https://github.com/UOR-Foundation/prismpm/commit/4933abd3aeada0726e5be0828145629416d3c437))
* **lean-prover:** the sealed prover works in every browser when Lean's recursion is deep ([472c7d0](https://github.com/UOR-Foundation/prismpm/commit/472c7d0c6a9e9ec2c008943473d63bc060b47f8f))
* **lean-prover:** two planted defects were not planted ([6a7c56a](https://github.com/UOR-Foundation/prismpm/commit/6a7c56a864fa61ef48f46169b77c18642488dfbb))
* **lean-prover:** under the 4 GiB cap the gate restarts the engine before every module ([0c022f2](https://github.com/UOR-Foundation/prismpm/commit/0c022f2b50e6ff3f3488f57b8edc2564db8c3c94))

### Other Changes

* **lean-prover:** content-addressed, parallel kernel judging in the sealed prover ([3511a67](https://github.com/UOR-Foundation/prismpm/commit/3511a671628b3c544bf137460dc650507a0fd811))
* **lean-prover:** the model check reads the one base library ([8e94949](https://github.com/UOR-Foundation/prismpm/commit/8e949491b3b1ddaf771179f534bce87a41f89c8a))
* **lean-prover:** the Node 22 run inside a 4 GiB memory cap; shard package.json lists its blobs ([953ec49](https://github.com/UOR-Foundation/prismpm/commit/953ec492e7bc4f56d01698936d33aaecf46c40d5))
* **prism-code:** every proof on a machine makes the next one cheaper ([4ab4dd5](https://github.com/UOR-Foundation/prismpm/commit/4ab4dd50f522dad357456ab7f43fb3a3fea7224b))
