# Review tour: `bytemaster/head` against `main`

**This is a review vehicle, not a merge request.** It exists so the team has one place to read what changed, see the evidence, and comment. Please do not merge it. It will keep moving as work lands; the list at the end says what is still coming, including the migration to the new PSIO library.

`bytemaster/head` is 158 commits ahead of `main` (merge base db601e572, 18 November). The raw diff is about 930 files and 200,000 added lines, but most of that is documentation, demos and application work. The platform changes are much smaller, and a large part of the execution engine is not in this repository at all. This tour says where to look.

Status when this was last updated: head at 054a0c386.

## Why this is worth your time

The same token transfer, on the same server, runs between five and six times faster on this branch than on `main`.

Transactions per second, 16-core x86 server, 5,000 transactions in one block in the tester, three runs each:

| | Team `main` | 44c57f739 | c45c060cd | 054a0c386 (head now) | Increase |
|---|---|---|---|---|---|
| Unsigned transfer | 157 | 292–301 | 353–366 | 895–900 | 5.7× vs `main` |
| Signed P-256 transfer | 109 | 199–200 | 313–314 | 628–633 | 5.8× vs `main` |
| Signed secp256k1 transfer | — | 191–192 | 351–366 | 811–816 | 4.2× vs 44c57f739 |
| Do-nothing, unsigned | — | — | 590–661 | 1,790–1,794 | 2.8× vs c45c060cd |
| Do-nothing, secp256k1 | — | — | 592–609 | 1,490–1,499 | 2.5× vs c45c060cd |

Why that matters:

- **Per-transaction cost is what limits psibase today, not block size.** On `main` a transfer costs about 6.4 ms of execution; on this head it costs about 1.1 ms. A token transfer is the reference case other chains are compared on, so this is the number that decides how psibase compares.
- **The gain is spread across the stack, so it applies to every service, not just Tokens.** It comes from a new storage engine, a new execution engine with pooled instances, a signature check that went from about 900 µs to about 135 µs, and indexing events once per block. A transaction that does nothing at all now runs at about 1,790 per second, which is the platform's own overhead and the floor for everything built on it.
- **Signatures are no longer a tax.** With secp256k1 keys a signed transfer costs close to an unsigned one.
- **It is measured, repeatable and still moving.** The benchmark and a per-service call profile are in the tree, suite results are recorded for every commit on two machines, and each step in the table is a specific commit you can check out. More is queued: the serialization change, canonical signatures, and wide arithmetic for Rust services.

What it asks of the team is real, which is why it needs review and not just a merge: the state format changes, the consensus engine becomes a pinned fork of wasmtime, and several validity rules change. The table below lists every such change. The tour after it says where to look and what we would most like challenged.

These are tester figures, one block on one thread. Submitted over TCP to a single running node, unsigned transfers went from 108 per second on `main` to 485 on this head (4.5×); the network table and the caveats are in the Throughput section.

## Read this first: what changes consensus or formats

These are the changes the team has to agree to, as opposed to review for quality.

| Change | Where | Effect |
|---|---|---|
| Storage engine | psitri replaces triedent (fae80b3b8 deletes triedent) | On-disk state format; no migration path from a triedent database |
| Execution engine | psizam and wasmtime replace eos-vm; wasmtime is the default (d3aec135e) | Every node must produce identical results on the new engines. The wasmtime every node runs is a **fork** ([gofractally/wasmtime](https://github.com/gofractally/wasmtime): upstream 51.0.0 plus changes), pinned by revision; that revision is part of the identity of compiled code |
| Stack depth | psizam's validator, and the wasmtime shim | A byte budget (`max_stack_bytes`) charged per call frame from costs the validator computes, so every engine overflows at the same call |
| Float policy per code version | 09e1f9075, 3a0ae5d56 | A service runs under the float profile its `vmVersion` names: 0 is the strict WebAssembly deterministic profile, 1 is "deterministic performance" (fused multiply-add, as wasmtime behaves). SetCode stamps the chain default, 1, on new code. NaNs are canonical in both |
| Wide-arithmetic instructions | 8b09a8776 | C++ services are compiled with `-mwide-arithmetic`; every engine must accept `i64.add128`, `i64.sub128`, `i64.mul_wide_s/u` |
| Block size limit | 01c148342, bf02dd93c | A block stops filling at 4 MiB of transactions; the limit is an on-chain setting |
| Signature service | b474c3e15 | `verify-sig` is a different implementation and is stricter about key encodings (details below) |
| Default key curve | cb87219ff | New software-held keys are secp256k1; P-256 remains for hardware keys. Both verify as before |
| Canonical signatures (**not yet in the head**) | branch `claude/canonical-signatures` | Only low-S signatures (`s <= n/2`) will verify, on both curves |

Visible in traces but not consensus: `ActionTrace.totalTime` is now elapsed time from the monotonic clock, not thread CPU time (c3397f9c7). Billing still reads the CPU clock.

## Tour by area

### 1. Execution engine (suggested reviewer: Steven)

**What changed.** eos-vm is replaced by wasmtime as the node's engine, with psizam (interpreter, JIT1, JIT2, LLVM AOT) providing validation and the other engines. A build can carry several engines and pick one at run time, which is how they are compared against each other.

- **Compilation.** With wasmtime a service is compiled at first use, in tens of milliseconds, and the result is kept in a per-user cache on disk. Compiling stored services in the background ahead of first use applies to the LLVM AOT engine only.
- **Instance pool** (ff905f61a, bc22a3953). wasmtime's pooling allocator with 256 slots per engine; a slot stays warm for the module that last used it. An instance the pool cannot serve (no free slot, a memory16 module, an oversized table) is created by a second engine without a pool running the same compiled code, and if the pool's address space cannot be reserved the node runs without one. `PSIBASE_WASMTIME_POOL=0` turns it off; the test `t-Tokens-test-one-pool-slot` forces the fallback. Resetting a slot is wasmtime's own mechanism: a copy-on-write image and in-place zeroing on Linux, a fresh mapping on macOS, where it gains almost nothing.
- **CPU budget** (c3397f9c7). The executing thread no longer evaluates its own budget; only the watchdog thread cancels. The budget is paused only while a service is actually being loaded or compiled. The trace, the limit and billing are to share one monotonic clock; that change follows `claude/canonical-next`.
- **A budget raised mid-run** (#2217). Funding resources just in time has to work. On the native side, changing the limit and the watchdog's decision to cancel happen under one lock, and the watchdog re-reads the limit whenever it wakes, so a raise that completes before the old deadline is honoured and nothing cancels on a stale limit; a raise after the budget ran out is too late and the cancellation stands. On the service side, the billing service used to set the limit only when a transaction starts and when billing moves to a sub-account; `buy_res`, `buy_res_for`, `buy_res_sub` and `del_res_sub` now recompute it when the balance they change is the one the running transaction is billed to (branch `claude/buy-res-raises-cpu-limit`, 69322f19e, not in the head). A chain test starts an account with a small balance, buys resources in its first action and then does forty transfers; its x86 run with and without the fix is in progress.
- **Wide arithmetic** (8b09a8776). Accepted unconditionally by every engine, with no feature gate and no per-contract opt-in.
- **memory16.** An optional one-page execution profile a module opts into with a custom section. No psibase service uses it. Tag `stable-20261122-memory16` on psibase, psizam and the wasmtime fork marks that checkpoint.

**Where to look.**
- Most of it is in the separate repository [gofractally/psizam](https://github.com/gofractally/psizam) (public, `main`): the engines, the wasmtime shim (`wasmtime/shim`, Rust; its `Cargo.toml` pins the wasmtime fork by revision), the wide-arithmetic support, and the memory16 profile (`docs/memory16.md`).
- In this repository: `libraries/psibase/native/src/ExecutionContext.cpp`, `ExecutionContextWasmtime.cpp`, `VmEngine.cpp`, `PsizamPolicy.cpp`, `NativeAotCache.cpp`, and `external/psizam-core.cmake` for the pin and the engine selection options.
- Commits: f00d3507e (psizam for node and tests), 6199b528c (LLVM AOT and artifact cache), 09e1f9075 (float profile per code version), 9dea98a8d and 8768429ef (wasmtime, several engines), d3aec135e (wasmtime default), 5ccd89a8e and edfff6ed0 (shared and background compilation), 8b09a8776 (wide arithmetic), ff905f61a and bc22a3953 (instance pool), c3397f9c7 (watchdog-only CPU budget).

**Questions for the reviewer.**
- Is the wasm feature set each engine admits the right one, and is "psizam's validator admits, wasmtime only executes" a sound division?
- The consensus engine is a fork of wasmtime. Is that acceptable, and is the way it is pinned enough?
- Stack accounting under wasmtime is done by rewriting the module in the shim rather than by patching the compiler, which costs memory traffic on every wasm call (#2221). The intended direction is a deterministic depth check folded into wasmtime's own prologue. Is either acceptable as a consensus rule?
- Instance pooling and reuse: what state can survive between uses of a slot, and is that provably none?
- The fused float profile as the default for new code.
- Wide arithmetic is lowered in JIT2 and LLVM as 64-bit operations plus a carry compare, with two new high-multiply operations, and is tested against a 128-bit oracle on every engine. Is unconditional acceptance what the team wants?

**Known limits.**
- wasmtime is the engine. psizam's interpreter, JIT1 and JIT2 are kept only as a cross-check for wasmtime and for LLVM AOT, and are to be marked experimental with their failures documented. They are largely compatible, with only minor known issues, and could be revived later for something wasmtime lacks, such as debugging. LLVM AOT is paused. c45c060cd marks the psizam-engine execution context as unverified after the CPU budget change, and the suites are qualified on wasmtime only (#2228).
- psizam tests a reviewer will see fail, all predating this work: the `memory_grow_2` spec cases on every engine, `psizam_host_tail_reentry_tests` (intentionally red), and on x86 "Test call depth dynamic - jit_llvm".
- Rust services are not compiled with wide arithmetic in this head. Branch `claude/canonical-next` adds it and is next to land. It moves `cargo-psibase` to newer walrus, wasmparser and wasm-opt versions and passes `--enable-multivalue` beside `--enable-wide-arithmetic` to the optimizer. rustc calls the wide-arithmetic target feature unstable and warns that using it will become an error.

### 2. Storage: psitri replaces triedent

**What changed.** The node's database is psitri. Reads happen outside the writer, subjective state is published separately from blocks, and a write session's changes are kept aside and folded into the trees once per block.

**Where to look.** `libraries/psibase/native/src/psitriStorage.cpp` and `usePsitri.cpp`; commits 3f192a3d6, f73c16e37, 30fbd2477, 638bcf495, cf82d3cdf, d15c31811, e28f472b2, 9a532ff91, 58354e982, 63bd6c49e. Validation records are under `doc/storage/`.

**Where the engine is.** [gofractally/psitri](https://github.com/gofractally/psitri) (public, `main`). The head still fetches it with an SSH URL, so configuring needs a GitHub SSH key until that is changed to HTTPS like the other dependencies.

**Questions for the reviewer.** Crash and unclean-shutdown recovery; the reader/writer model; what "fold once per block" means for a transaction that is interrupted.

**Details worth knowing before reading the code.**
- Speculative execution never takes the store's writer gate. A database's pending changes are folded early once they pass 256 MiB.
- After an unclean shutdown the default open does not rebuild reference counts: counts may be stale and leaked space remains until a full scan. Stronger recovery modes exist but are not what the node selects.
- Durability is chosen by sync level, and the suites run with `database-sync=none`. Performance by default with persistence opt-in is a deliberate policy.
- The pinned psitri is b7b8647 on its `main`.

**Known limits.**
- On 22 November `psinode_test_crash` failed intermittently: a node aborted with "reference count exceeded limits" when reopening its database. It has not been reproduced in 21 loaded runs on the current line. The diagnosis is an earlier double release: in release builds psitri wrapped a reference count that was already zero, and the next retain threw. The root cause has not been found. The pinned psitri now aborts at the faulty release with a message instead of wrapping, so a recurrence will name the caller.
- At the pinned commit four of psitri's own tests fail. They have now been triaged; none is in code psibase runs. Fixes are on psitri branch `claude/test-triage`, not yet merged or pinned:
  - "Block allocator truncate operations": the test expected behaviour that the durability work deliberately changed. Test corrected ([psitri#3](https://github.com/gofractally/psitri/issues/3)).
  - `psitrimdbx-tests`: a test wrote 1 MB where the default backend's limit is about 0.5 MB. The limit is now reported by the library and the test respects it ([psitri#4](https://github.com/gofractally/psitri/issues/4)).
  - `sal_hybrid-va-recycle-tests`: a real defect in an experimental allocator, unbounded growth when object sizes drift. Fixed: 307 segments and rising became 49, flat. The test now measures against what that design can achieve, live data plus one segment per size class ([psitri#5](https://github.com/gofractally/psitri/issues/5)).
  - `kv-compat-test`: the legacy engine's leg fails two checks that deliberately mark features it does not implement ([psitri#2](https://github.com/gofractally/psitri/issues/2)). Unchanged.

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

**Not yet in the head.** Branch `claude/canonical-signatures` (55aabe977), queued to land as part of `claude/canonical-next`: `verify-sig` accepts only low-S signatures on both curves, and every signer normalizes: the C++ helper, psinode's software and PKCS #11 signers, the Rust library's P-256 and PKCS #11 signers, the browser signing plugin, and the test harness. It includes tests of the browser plugin's signing function and of the Rust PKCS #11 signer against a SoftHSM token.

**Not started.** The Rust library's key generation and the browser plugins still create P-256 keys (#2216).

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
- Rust services get wide arithmetic only with rustc 1.100 or newer (on `claude/canonical-next`). rustc 1.98 miscompiles 128-bit arithmetic when the feature is on, giving wrong multiply and add/subtract results on every engine, so `cargo-psibase` adds the flag only for 1.100 and later and builds without it otherwise, with a message.
- psizam, psitri and ucc are fetched at configure time and pinned; the eos-vm submodule is no longer what the node runs on.
- Building the web UIs refuses an unsupported Node version and says why (8747dc889).
- The tree builds and its suites run on macOS (Apple silicon) as well as Linux x86-64.

## Throughput

The table is at the top of this document. The three head commits in it were measured in one session on an idle server.

So the head today against `main` is about 5.7 times faster unsigned and about 5.8 times faster signed with P-256. A transaction that does nothing runs at about 1,790 per second unsigned and 1,490 signed with secp256k1 at 054a0c386.

Where the gains came from, measured in isolation on the 44c57f739 base: the psitri transaction stack alone took unsigned from 300–308 to 346–351, and adding per-block event indexing took it to 646–654. The new `verify-sig` alone took one verification from about 896 µs to about 135 µs.

**Over a network.** Transfers submitted over TCP to one running node, applied per second, 20 seconds per case, one run each, x86:

| | Team `main` | 44c57f739 | c45c060cd | 054a0c386 (head now) | Increase |
|---|---|---|---|---|---|
| Unsigned, 16 connections | 108 | 197 | 250 | 485 | 4.5× vs `main` |
| Unsigned, 64 connections | 108 | 193 | 250 | 405 | 3.7× vs `main` |
| Signed secp256k1, 16 connections | — | 165 | 224 | 306 | 1.9× vs 44c57f739 |
| Signed secp256k1, 64 connections | — | 172 | 233 | 305 | 1.8× vs 44c57f739 |

On `main`, signed P-256 over the network was 99 per second at 16 connections and 101 at 64; P-256 was not measured over the network at the later commits.

What to keep in mind:
- The tester figures are one block on one thread, not network throughput.
- The network figures are a single node with the load generator on the same machine, one run per case. There is no multi-node run at c45c060cd or 054a0c386. Signed throughput rose less than unsigned.
- Per-block event indexing means indexing time is no longer in a transaction's billed CPU, and objective pricing of events is not built.
- A note on reading the signed tester figures: the tester verified every signature twice when this was last checked, where a node verifies once, so signature cost is overstated there. This is a property of the tester, not something to fix.

The full report, with raw output, is on branch `claude/benchmark-report` under `doc/benchmarks/transfer-throughput/` and will be carried into the head.

## Test results

Suite results are recorded per commit under `tests/timing/runs/`. On wasmtime:

| Commit | Mac | x86 |
|---|---|---|
| c45c060cd | native 24/24, end-to-end 39/39, Rust 29/29 | native 20/20, end-to-end 39/39, Rust 29/29 |
| 054a0c386 (head) | full ctest 92/92 | native 20/20, end-to-end 39/39, Rust 29/29 |

## Known gaps, in one place

Open items are tracked as issues and closed as they are fixed.

- wasmtime (a pinned fork) is the only qualified engine. The interpreter, JIT1 and JIT2 are experimental cross-checks, and LLVM AOT is paused; none is verified on this head: #2228. Engine tests red on psizam main: [psizam#1](https://github.com/gofractally/psizam/issues/1), [psizam#2](https://github.com/gofractally/psizam/issues/2).
- One monotonic clock for trace time, the limit and billing: #2227.
- Deterministic stack check on wasmtime costs memory traffic on every call: #2221.
- Buying resources during a transaction does not raise that transaction's CPU limit: #2217 (fix on a branch).
- Events: one billing event per transaction and the per-block pipeline: #2218. Objective pricing for events, by size and index count: #2223.
- Network throughput drops with more connections, and signed lags unsigned: #2220.
- secp256k1 by default in the Rust library and the browser plugins: #2216.
- P-256 verification is about eight times slower than secp256k1: #2222.
- Crypto library sources are fetched from their upstream sites, not mirrored: #2224.
- The verifier's differential and Wycheproof checks are not an in-tree test: #2225.
- psitri is fetched over SSH: #2226. psitri, ucc and psio have no license file.
- psitri's own failing tests: three fixed on branch `claude/test-triage`, not yet merged; the legacy engine's compatibility leg ([psitri#2](https://github.com/gofractally/psitri/issues/2)) and an x86-only large-value compaction test ([psitri#1](https://github.com/gofractally/psitri/issues/1)) are open.
- The reference-count abort seen in `psinode_test_crash`: not reproduced on the current line, root cause not found: #2229.
- Rust services lack wide arithmetic until `claude/canonical-next` lands; rustc treats the target feature as unstable: #2230.
- Canonical signatures are not in the head.
- The benchmark report and the verifier evidence are on topic branches, not yet in the head.

## Still to come in this pull request

### Migration to gofractally/psio and PSSZ (in progress, not in this head)

Serialization is being moved from the in-tree fracpack library to the canonical [gofractally/psio](https://github.com/gofractally/psio) library. The work is on topic branch `claude/pssz` (pushed up to bc71f6bb0, with newer commits still being verified) and a parallel C++ branch that is not pushed yet. When it lands, this pull request will be updated with its own tour section so the new PSIO library and the format change can be reviewed. Status as reported by its author on 23 November:

- **Done on the branch, wire format still unchanged.** Every C++ type and service is declared with psio's `PSIO_REFLECT`; dispatch, call proxies, tables and schema generation read `psio::reflect`; every packed Rust type carries the PSIO derives beside the old ones; C++, Rust and the Python test harness share one method-name coder, which changed ten method numbers. Rust mirrors of C++ types and C++ mirrors of Rust services were cross-checked with a shared fixture (51 types; parameter names of 28 services and 265 methods) and corrected where they disagreed. The full suite passed 93/93 at each verified step.
- **In progress: the switch itself.** C++ and Rust are being converted in parallel and will be merged together. In one step it changes the binary format (fracpack to PSSZ), service schemas (to PSIO's Schema IR), JSON (to I-JSON: 64-bit integers above 2^53-1 as decimal strings, bytes as hex, variants as `{"Name": value}`, action arguments as an object keyed by parameter name), and the GraphQL engine. It then deletes `libraries/psio1` and `rust/fracpack`. Front ends and plugins are not covered by the test suite and may need updating.
- **Left for the team after the switch.** Per-type size caps (a proposal exists: 161 member bounds and 84 type caps, almost all new rules); tightening validation to "own table rows trusted, everything else validated" (an audit of 584 decode sites exists); the token-transfer `data` argument.
- **gofractally/psio changed substantially for this.** PSSZ evolution, pruning and width rules; annotations for bounds on ordinary types; method reflection with argument caps; views; keys; I-JSON; Schema IR with runtime compatibility checks; a GraphQL engine; Rust, TypeScript and Python implementations held to shared conformance fixtures. Reviewers should start with its `docs/annotations.md`, `docs/tutorial-annotations.md` and `docs/pssz-spec.md`.
- **Fixes found along the way, independent of the format** (on `claude/pssz`): a request-body decode whose result was not checked in `RTransact`; code reference counts in `SetCode`/`XAdmin` that were never persisted, so unreferenced code was never erased; a missing field in the C++ mirror of a staged-transaction response; `Decimal`/`Quantity` parsing that wrapped on overflow; several Rust mirrors that were wrong on the wire.
- A running list of questions and decisions for reviewers will be committed as `doc/team-review.md` with the migration.

### Also to come

- Canonical low-S signatures and wide arithmetic for Rust services, together on `claude/canonical-next`.
- Updated throughput numbers and the benchmark report.

## A note on how this was written

The sections on signature verification, key defaults and canonical signatures describe work done by the author of this document and were checked against the code and test runs. The other sections are summarized from the commit history and from reports by the people who did that work, and may be corrected by them.
