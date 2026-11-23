# Review tour: `bytemaster/head` against `main`

**This is a review vehicle, not a merge request.** It exists so the team has one place to read what changed, see the evidence, and comment. Please do not merge it. It will keep moving as work lands; the list at the end says what is still coming, including the migration to the new PSIO library.

`bytemaster/head` is 158 commits ahead of `main` (merge base db601e572, 18 November). The raw diff is about 930 files and 200,000 added lines, but most of that is documentation, demos and application work. The platform changes are much smaller, and a large part of the execution engine is not in this repository at all. This tour says where to look.

Status when this was written: head at 054a0c386.

## Read this first: what changes consensus or formats

These are the changes the team has to agree to, as opposed to review for quality.

| Change | Where | Effect |
|---|---|---|
| Storage engine | psitri replaces triedent (fae80b3b8 deletes triedent) | On-disk state format; no migration path from a triedent database |
| Execution engine | psizam and wasmtime replace eos-vm; wasmtime is the default (d3aec135e) | Every node must produce identical results on the new engines |
| Float policy per code version | 09e1f9075, 3a0ae5d56 | A service runs under the float profile its `vmVersion` names; new deployments default to the "deterministic performance" profile (fused multiply-add) |
| Wide-arithmetic instructions | 8b09a8776 | C++ services are compiled with `-mwide-arithmetic`; every engine must accept `i64.add128`, `i64.sub128`, `i64.mul_wide_s/u` |
| Block size limit | 01c148342, bf02dd93c | A block stops filling at 4 MiB of transactions; the limit is an on-chain setting |
| Signature service | b474c3e15 | `verify-sig` is a different implementation and is stricter about key encodings (details below) |
| Default key curve | cb87219ff | New software-held keys are secp256k1; P-256 remains for hardware keys. Both verify as before |
| Canonical signatures (**not yet in the head**) | branch `claude/canonical-signatures` | Only low-S signatures (`s <= n/2`) will verify, on both curves |

## Tour by area

### 1. Execution engine (suggested reviewer: Steven)

**What changed.** eos-vm is replaced by psizam (interpreter, JIT1, JIT2, LLVM AOT) with wasmtime added as an engine and made the default. A build can carry several engines and pick one at run time. Compiled services are cached on disk and compiled in the background ahead of first use. Service instances now come from a pool of warm slots. The CPU budget is enforced from a watchdog thread.

**Where to look.**
- Most of it is in the separate repository [gofractally/psizam](https://github.com/gofractally/psizam) (public, `main`): the engines, the wasmtime shim (`wasmtime/shim`, Rust, wasmtime pinned to an exact version), the wide-arithmetic support, and an optional one-page `memory16` execution profile (`docs/memory16.md`).
- In this repository: `libraries/psibase/native/src/ExecutionContext.cpp`, `ExecutionContextWasmtime.cpp`, `VmEngine.cpp`, `PsizamPolicy.cpp`, `NativeAotCache.cpp`, and `external/psizam-core.cmake` for the pin and the engine selection options.
- Commits: f00d3507e (psizam for node and tests), 6199b528c (LLVM AOT and artifact cache), 09e1f9075 (float profile per code version), 9dea98a8d and 8768429ef (wasmtime, several engines), d3aec135e (wasmtime default), 5ccd89a8e and edfff6ed0 (shared and background compilation), 8b09a8776 (wide arithmetic), ff905f61a and bc22a3953 (instance pool), c3397f9c7 (watchdog-only CPU budget).

**Questions for the reviewer.**
- Is the wasm feature set each engine admits the right one, and is "psizam's validator admits, wasmtime only executes" a sound division?
- Stack accounting under wasmtime is done by rewriting the module in the shim rather than by patching the compiler. Is that acceptable as a consensus rule?
- Instance pooling and reuse: what state can survive between uses of a slot, and is that provably none?
- The fused float profile as the default for new code.

**Known limits.** Work on JIT2 and LLVM AOT is paused; c45c060cd marks the psizam-engine execution context as unverified after the CPU budget change. The suites are qualified on wasmtime only. Rust services are not yet compiled with wide arithmetic.

### 2. Storage: psitri replaces triedent

**What changed.** The node's database is psitri. Reads happen outside the writer, subjective state is published separately from blocks, and a write session's changes are kept aside and folded into the trees once per block.

**Where to look.** `libraries/psibase/native/src/psitriStorage.cpp` and `usePsitri.cpp`; commits 3f192a3d6, f73c16e37, 30fbd2477, 638bcf495, cf82d3cdf, d15c31811, e28f472b2, 9a532ff91, 58354e982, 63bd6c49e. Validation records are under `doc/storage/`.

**Access.** The [gofractally/psitri](https://github.com/gofractally/psitri) repository is **private**. Reviewers need access to it to read the engine or to build this branch at all.

**Questions for the reviewer.** Crash and unclean-shutdown recovery; the reader/writer model; what "fold once per block" means for a transaction that is interrupted.

**Known limits.** On 22 November an intermittent failure was reported in `psinode_test_crash`: a node aborted with "reference count exceeded limits" when reopening its database after a shutdown that the test harness cut short. The author of this document does not know whether it has been resolved.

### 3. Signature verification (suggested reviewer: Steven, who wrote the Botan-based service)

**What changed.** `verify-sig` no longer links Botan. It uses libsecp256k1 for secp256k1 and BearSSL's P-256, each pinned and built by its own build system. The service went from 936 KB and twelve pages of memory, with a build-time `wasm-ctor-eval` step, to 122 KB and one page with no init step. Botan is still built for AuthSig, XKeys and XBasic.

**Where to look.** b474c3e15: `packages/system/VerifySig/src/VerifySig.cpp` (about 220 lines), the two `ExternalProject` blocks in the root `CMakeLists.txt`, and `packages/psibase_tests/test/test_verify_sig_keys.cpp`.

**Evidence.**
- x86 server, idle, before 44c57f739 and after b474c3e15: one `verify-sig` call about 896 µs before and 135 µs after; signature time per signed transfer on a validating node 1.012 ms before and 0.169 ms after.
- 45,514 cases run through the new service and the Botan service side by side, including the 514 Wycheproof ECDSA vectors for the two curves: the new service gave the expected answer every time and never accepted an input Botan rejected. The harness and results are on branch `claude/verify-sig-evidence` under `doc/verify-sig/`.

**Behaviour differences to check.**
- Keys must be exactly the DER SubjectPublicKeyInfo for the curve, with a compressed or uncompressed point. Botan also accepted a trailing byte, non-zero unused bits, a non-minimal curve identifier and hybrid-form points.
- Compressed P-256 points are expanded in the service, using BearSSL's internal `br_i31_*` routines, because BearSSL only takes uncompressed points. BearSSL still validates the expanded point.
- The build now downloads libsecp256k1 from GitHub and BearSSL from bearssl.org at configure time. Mirroring them next to the Botan tarball is undecided.

**Known limits.** P-256 verification is still roughly eight times slower than secp256k1 (about 210 µs against 25 µs in an isolated measurement). The differential check is not yet an in-tree test.

### 4. Key curve default and canonical signatures

**In the head.** cb87219ff: keys generated by the C++ key helper, by psinode's software signer and by the psinode test harness are secp256k1. PKCS #11 keys stay P-256.

**Not yet in the head.** Branch `claude/canonical-signatures` (55aabe977): `verify-sig` accepts only low-S signatures on both curves, and every signer normalizes: the C++ helper, psinode's software and PKCS #11 signers, the Rust library's P-256 and PKCS #11 signers, the browser signing plugin, and the test harness. It includes tests of the browser plugin's signing function and of the Rust PKCS #11 signer against a SoftHSM token.

**Not started.** The Rust library's key generation and the browser plugins still create P-256 keys.

**Questions for the reviewer.** Whether any existing wallet or tool signs without normalizing; whether to accept one key encoding instead of two.

### 5. Chain rules and services

- Block size limit: 01c148342, bf02dd93c, cd9626e7a.
- SetCode stamps the chain's default VM version: 3a0ae5d56, 137ea8c16.
- Events are indexed once per block instead of twice per transaction: ed78237de.

### 6. Benchmark and profiling tools

`packages/user/Tokens/test/src/TransferBench.cpp` (d19c610bf, f69220f65, 718e3c07b), an optional per-service call profile (78571d2c5), and a log line showing where block validation time goes.

### 7. Application work carried on the branch

The first commits (a4e5c0a0e through 0a93ef490) add Exchange, Favor, Signing and the BTC/ETH bridge work, with demos and their documents under `docs/exchange/`. They account for a large share of the line count and are not part of the platform review unless you want them to be.

### 8. Build and toolchain

- binaryen 133 or newer must be first on `PATH`; older versions cannot read wide-arithmetic code and the configure step now says so.
- psizam, psitri and ucc are fetched at configure time and pinned; the eos-vm submodule is no longer what the node runs on.
- Building the web UIs refuses an unsupported Node version and says why (8747dc889).
- The tree builds and its suites run on macOS (Apple silicon) as well as Linux x86-64.

## Throughput

Token transfers per second, 16-core x86 cloud server, one block of 5,000 transfers in the tester.

| | Unsigned | Signed, P-256 | Signed, secp256k1 |
|---|---|---|---|
| `main` (eos-vm, triedent) | 157 | 109 | not measured |
| Head before the signature change (44c57f739) | 301 | 198 | 192 |
| Head with the new `verify-sig` (b474c3e15) | 309 | 274 | 308 |

Over a network, where each signature is checked once and off the producing thread, the signature change is worth about 10% on signed transfers, and unsigned throughput (about 190 to 200 per second) is the ceiling. The tester verifies every signature twice, so it overstates signature cost; that is unfixed.

The numbers above do not include the commits after b474c3e15 (instance pool, event indexing, the psitri transaction stack). The benchmark report is not in the repository yet.

## Test results

Suite results are recorded per commit under `tests/timing/runs/`. The latest head was reported green on wasmtime on both machines: Mac native 24/24, end-to-end 39/39, Rust 29/29; x86 native 20/20, end-to-end 39/39, Rust 29/29 (figures reported for c45c060cd).

## Known gaps, in one place

- JIT2 and LLVM AOT paused and marked unverified; wasmtime is the only qualified engine.
- psitri is a private repository.
- The `psinode_test_crash` reopen failure, status unknown to the author.
- Rust services lack wide arithmetic.
- P-256 verification speed.
- The tester verifies each signature twice.
- Crypto library sources are fetched from their upstream sites, not mirrored.
- Canonical signatures and the browser/Rust key default are not in the head.
- The benchmark report and the verifier differential test are not in the tree.

## Still to come in this pull request

- **Migration to the new PSIO library.** Serialization is being moved from the in-tree fracpack library to the canonical [gofractally/psio](https://github.com/gofractally/psio) library and its PSSZ format, for services, the SDK and clients. That work is in progress on a separate branch and is not in this head. When it lands, this pull request will be updated with its own tour section so the new PSIO library and the wire-format change can be reviewed.
- Canonical low-S signatures.
- Wide arithmetic for Rust services.
- Updated throughput numbers and the benchmark report.

## A note on how this was written

The sections on signature verification, key defaults and canonical signatures describe work done by the author of this document and were checked against the code and test runs. The other sections are summarized from the commit history and from reports by the people who did that work, and may be corrected by them.
