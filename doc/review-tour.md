# Review tour: `bytemaster/head` against `main`

**This is a review vehicle, not a merge request.** It exists so the team has one place to read what changed, see the evidence, and comment. Please do not merge it. It will keep moving as work lands. The serialization migration to the new PSIO library, promised here earlier, is now in the head and has its own section (9).

`bytemaster/head` is 335 commits ahead of `main` (merge base db601e572, 18 November). The raw diff is about 1,600 files, 237,000 added lines and 56,000 removed. A large share of that is documentation, demos and application work, the serialization change touches most services mechanically, and a large part of the execution engine is not in this repository at all. This tour says where to look.

Status when this was last updated: head at 1d7210e7a, pinning PSIO 66abb1b, psitri d3bba0e and psizam 2e93ecd.

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
- **It is measured and repeatable.** The benchmark and a per-service call profile are in the tree, suite results are recorded for every commit on two machines, and each step in the table is a specific commit you can check out. Still queued: a faster P-256 verifier and secp256k1 keys by default in the browser.

What it asks of the team is real, which is why it needs review and not just a merge: the state format changes, the consensus engine becomes a pinned fork of wasmtime, and several validity rules change. The table below lists every such change. The tour after it says where to look and what we would most like challenged.

These are tester figures, one block on one thread, measured before the serialization change landed and not yet remeasured. Submitted over TCP to a single running node, unsigned transfers went from 108 per second on `main` to 485 on this head (4.5×); the network table and the caveats are in the Throughput section.

## Read this first: what changes consensus or formats

These are the changes the team has to agree to, as opposed to review for quality.

| Change | Where | Effect |
|---|---|---|
| Storage engine | psitri replaces triedent (fae80b3b8 deletes triedent) | On-disk state format; no migration path from a triedent database |
| Serialization | fracpack replaced by PSSZ on the [gofractally/psio](https://github.com/gofractally/psio) library; the in-tree library is deleted | Every wire and stored format changes: actions, results, table rows and keys, events, blocks, transactions, service schemas, JSON and GraphQL. Earlier chains and databases are not readable. Ten method numbers changed |
| Execution engine | psizam and wasmtime replace eos-vm; wasmtime is the default (d3aec135e) | Every node must produce identical results on the new engines. The wasmtime every node runs is a **fork** ([gofractally/wasmtime](https://github.com/gofractally/wasmtime): upstream 51.0.0 plus changes), pinned by revision; that revision is part of the identity of compiled code |
| Stack depth | psizam's validator, and the wasmtime shim | A byte budget (`max_stack_bytes`) charged per call frame from costs the validator computes, so every engine overflows at the same call |
| Float policy per code version | 09e1f9075, 3a0ae5d56 | A service runs under the float profile its `vmVersion` names: 0 is the strict WebAssembly deterministic profile, 1 is "deterministic performance" (fused multiply-add, as wasmtime behaves). SetCode stamps the chain default, 1, on new code. NaNs are canonical in both |
| Code admission when stored | `admitNativeWasm` (`PsizamPolicy.cpp`), run by the native write of a code row (#2256) | A transaction that stores service code the chain policy does not admit (`setCode`, `stageCode`, genesis) fails with the reason. The policy includes the imports: each must be a host function of the one list every engine registers (`NativeHostFunctions.hpp`), with its signature (#2259), and the entry points: an export named `start`, `called`, `serve` or `processTransaction` must be a function of that entry point's fixed signature, and `start` and `called` must be exported (#2261; `serve` and `processTransaction` are optional). Before, it succeeded and the service failed when first called |
| When service code is compiled | `TransactionContext::prepareCode`, `WasmCache` (`VmEngine.cpp`), `BlockContext::deferUncompiledCode`, `RTransact::onSpecTrx` (#2256) | A pushed transaction is offered to a block only after its speculative run has passed (before: once its signatures were checked). The speculative run compiles what it stores or executes, on a compile thread, waits at most 5 s (`PSIBASE_SPECULATIVE_COMPILE_MS`) outside its one-second limit, and is refused if 4 compiles are already in flight. A compile that reaches that bound is stopped in the compiler (wasmtime; #2267) and leaves nothing: no module, no stored artifact and no record of a refusal, so the same code is compiled again when it is next asked for, by a later run under the same bound or by a block to completion. Until its thread has left the compiler it still counts as in flight. What a block needs is never stopped: a speculative run's compile that a block comes to need loses its bound, or is run again if it was stopped already. A producer running a transaction from its queue never compiles or waits for a compile: the transaction is deferred to a later block with no result. A node applying a block compiles in the background and only the first execution waits. Boot blocks, the tester, callbacks and queries compile where they need the module, as before |
| Wide-arithmetic instructions | 8b09a8776 | C++ services are compiled with `-mwide-arithmetic`; every engine must accept `i64.add128`, `i64.sub128`, `i64.mul_wide_s/u` |
| Block size limit | 01c148342, bf02dd93c | A block stops filling at 4 MiB of transactions; the limit is an on-chain setting |
| Signature service | b474c3e15 | `verify-sig` is a different implementation and is stricter about key encodings (details below) |
| Default key curve | cb87219ff | New software-held keys are secp256k1; P-256 remains for hardware keys. Both verify as before |
| Canonical signatures | `packages/system/VerifySig`, and every signer | Only low-S signatures (`s <= n/2`) verify, on both curves. A signer that does not normalize has about half its signatures rejected |

Visible in traces but not consensus: action trace time, the transaction limit and billing all read one monotonic clock that measures elapsed time (e272625fc). Thread CPU time is no longer used for any of them.

## Tour by area

### 1. Execution engine (suggested reviewer: Steven)

**What changed.** eos-vm is replaced by wasmtime as the node's engine, with psizam (interpreter, JIT1, JIT2, LLVM AOT) providing validation and the other engines. A build can carry several engines and pick one at run time, which is how they are compared against each other.

- **Compilation.** With wasmtime a service is compiled at first use, in tens of milliseconds, and the result is kept in a per-user cache on disk. Compiling stored services in the background ahead of first use applies to the LLVM AOT engine only.
- **Instance pool** (ff905f61a, bc22a3953). wasmtime's pooling allocator with 256 slots per engine; a slot stays warm for the module that last used it. An instance the pool cannot serve (no free slot, a memory16 module, an oversized table) is created by a second engine without a pool running the same compiled code, and if the pool's address space cannot be reserved the node runs without one. `PSIBASE_WASMTIME_POOL=0` turns it off; the test `t-Tokens-test-one-pool-slot` forces the fallback. Resetting a slot is wasmtime's own mechanism: a copy-on-write image and in-place zeroing on Linux, a fresh mapping on macOS, where it gains almost nothing.
- **CPU budget** (c3397f9c7, e272625fc). The executing thread no longer evaluates its own budget; only the watchdog thread cancels. The budget is paused only while a service is actually being loaded or compiled. Trace time, the limit and billing share one monotonic clock; the thread-CPU-clock path and the cross-thread sampling it needed on macOS are gone.
- **A budget raised mid-run** (34fced88e). Funding resources just in time has to work. On the native side, changing the limit and the watchdog's decision to cancel happen under one lock, and the watchdog re-reads the limit whenever it wakes, so a raise that completes before the old deadline is honoured and nothing cancels on a stale limit; a raise after the budget ran out is too late and the cancellation stands. On the service side, `buy_res`, `buy_res_for`, `buy_res_sub` and `del_res_sub` recompute the limit when the balance they change is the one the running transaction is billed to. Tests cover a limit raised mid-run.
- **Wide arithmetic** (8b09a8776). Accepted unconditionally by every engine, with no feature gate and no per-contract opt-in. C++ services use it; Rust services use it when built with rustc 1.100 or newer.
- **memory16.** An optional one-page execution profile a module opts into with a custom section. No psibase service uses it. Tag `stable-20261122-memory16` on psibase, psizam and the wasmtime fork marks that checkpoint.

**Where to look.**
- Most of it is in the separate repository [gofractally/psizam](https://github.com/gofractally/psizam) (public, `main`): the engines, the wasmtime shim (`wasmtime/shim`, Rust; its `Cargo.toml` pins the wasmtime fork by revision), the wide-arithmetic support, and the memory16 profile (`docs/memory16.md`).
- In this repository: `libraries/psibase/native/src/ExecutionContext.cpp`, `ExecutionContextWasmtime.cpp`, `VmEngine.cpp`, `PsizamPolicy.cpp` (the chain policy and `admitNativeWasm`, the admission rule run when code is stored), the compiled-module cache (`NativeAotCache.hpp`: the verified front `NativeArtifactCache.cpp`, the directory store `NativeAotCache.cpp` the tools share, and `NativeAotDatabase.cpp`, the records a node keeps under a root of its own database that is no part of the chain: `storage::cache_root` in `storage.hpp` and `psitriStorage.cpp`, engine root 2), and `external/psizam-core.cmake` for the pin and the engine selection options.
- Commits: f00d3507e (psizam for node and tests), 6199b528c (LLVM AOT and artifact cache), 09e1f9075 (float profile per code version), 9dea98a8d and 8768429ef (wasmtime, several engines), d3aec135e (wasmtime default), 5ccd89a8e and edfff6ed0 (shared and background compilation), 8b09a8776 (wide arithmetic), ff905f61a and bc22a3953 (instance pool), c3397f9c7 (watchdog-only CPU budget).

**Questions for the reviewer.**
- Is the wasm feature set each engine admits the right one, and is "psizam's validator admits, wasmtime only executes" a sound division?
- The consensus engine is a fork of wasmtime. Is that acceptable, and is the way it is pinned enough?
- Stack accounting under wasmtime is done by rewriting the module in the shim rather than by patching the compiler, which costs memory traffic on every wasm call (#2221). The intended direction is a deterministic depth check folded into wasmtime's own prologue. Is either acceptable as a consensus rule?
- Instance pooling and reuse: what state can survive between uses of a slot, and is that provably none?
- The fused float profile as the default for new code.
- Wide arithmetic is lowered in JIT2 and LLVM as 64-bit operations plus a carry compare, with two new high-multiply operations, and is tested against a 128-bit oracle on every engine. Is unconditional acceptance what the team wants?

**Known limits.**
- wasmtime is the engine, and every landing is qualified on it on x86. psizam's interpreter, JIT1 and JIT2 are kept only as a cross-check for wasmtime and for LLVM AOT, and are experimental with their known problems documented. They are largely compatible, with only minor known issues, and could be revived later for something wasmtime lacks, such as debugging.
- LLVM AOT is the second engine: robust, but slow to compile, and faster than wasmtime at run time for some modules, so engines may later be chosen per application. It is re-verified on x86-64 Linux, most recently with the serialization change in (e93c2e64d): native 20/20, including the consensus test that compares LLVM AOT and saved AOT artifacts with JIT1 bit for bit, and end-to-end 39/39. The Rust suite has not been run under it and macOS has not been run. Getting there needed two fixes: the LLVM AOT build had never linked on Linux, and the consensus test leaves JIT2 out on x86-64, where JIT2 keeps NaN payloads through SIMD float operations.
- The status of each engine and the known problems of the experimental ones are in psizam's [KNOWN_ISSUES.md](https://github.com/gofractally/psizam/blob/main/KNOWN_ISSUES.md). #2228 stays open for LLVM AOT on macOS and for the experimental engines.
- `psitest` runs the test module on wasmtime, like the services it drives, in every build configuration; no experimental engine is on the path of the suites (#2231). A test module is not chain code: no admission limits, stack budget or CPU limit apply to it (`programs/psitest/main.cpp`, `test_module`).
- psizam tests a reviewer will see fail, all predating this work: the `memory_grow_2` spec cases on every engine, `psizam_host_tail_reentry_tests` (intentionally red), and on x86 "Test call depth dynamic - jit_llvm".
- Rust services use wide arithmetic only when built with rustc 1.100 or newer; rustc calls the target feature unstable and warns that using it will become an error (#2230). A test in the Rust suite checks 128-bit arithmetic in a service against a 32-bit-limb reference, so a compiler that gets it wrong fails the suite.

### 2. Storage: psitri replaces triedent

**What changed.** The node's database is psitri. Reads happen outside the writer, subjective state is published separately from blocks, and a write session's changes are kept aside and folded into the trees once per block.

**Where to look.** `libraries/psibase/native/src/psitriStorage.cpp` and `usePsitri.cpp`; commits 3f192a3d6, f73c16e37, 30fbd2477, 638bcf495, cf82d3cdf, d15c31811, e28f472b2, 9a532ff91, 58354e982, 63bd6c49e. Validation records are under `doc/storage/`.

**Where the engine is.** [gofractally/psitri](https://github.com/gofractally/psitri) (public, `main`). The head still fetches it with an SSH URL, so configuring needs a GitHub SSH key until that is changed to HTTPS like the other dependencies.

**Questions for the reviewer.** Crash and unclean-shutdown recovery; the reader/writer model; what "fold once per block" means for a transaction that is interrupted.

**Details worth knowing before reading the code.**
- Speculative execution never takes the store's writer gate. A database's pending changes are folded early once they pass 256 MiB.
- After an unclean shutdown the default open does not rebuild reference counts: counts may be stale and leaked space remains until a full scan. Stronger recovery modes exist but are not what the node selects.
- Durability is chosen by sync level, and the suites run with `database-sync=none`. Performance by default with persistence opt-in is a deliberate policy.
- The pinned psitri is d3bba0e on its `main`. Beyond the test fixes it carries a fix for a race in the block allocator: part of its address-space reservation could be left unmapped.

**Known limits.**
- On 22 November `psinode_test_crash` failed intermittently: a node aborted with "reference count exceeded limits" when reopening its database. It has not been reproduced in 21 loaded runs on the current line. The diagnosis is an earlier double release: in release builds psitri wrapped a reference count that was already zero, and the next retain threw. The root cause has not been found. The pinned psitri now aborts at the faulty release with a message instead of wrapping, so a recurrence will name the caller.
- psitri's own suite: every test passes on its `main` (94fa328) except `kv-compat-test`, where the legacy engine's leg fails two checks that deliberately mark features it does not implement ([psitri#2](https://github.com/gofractally/psitri/issues/2)); psibase does not use that engine.
- Pinned and unpinned segments are compacted separately, and each needs a whole segment of freed space before the compactor acts, so up to a segment of freed space per pool can stay uncompacted ([psitri#7](https://github.com/gofractally/psitri/issues/7)).

### 3. Signature verification (suggested reviewer: Steven, who wrote the Botan-based service)

**What changed.** `verify-sig` no longer links Botan. It uses libsecp256k1 for secp256k1 and BearSSL's P-256, each pinned and built by its own build system. The service went from 936 KB and twelve pages of memory, with a build-time `wasm-ctor-eval` step, to 122 KB and one page with no init step. Botan is still built for AuthSig, XKeys and XBasic.

**Where to look.** b474c3e15: `packages/system/VerifySig/src/VerifySig.cpp` (about 220 lines), the two `ExternalProject` blocks in the root `CMakeLists.txt`, and `packages/psibase_tests/test/test_verify_sig_keys.cpp`.

**Evidence.**
- x86 server, idle, before 44c57f739 and after b474c3e15: one `verify-sig` call about 896 µs before and 135 µs after; signature time per signed transfer on a validating node 1.012 ms before and 0.169 ms after.
- 45,514 cases run through the new service and the Botan service side by side, including the 514 Wycheproof ECDSA vectors for the two curves: the new service gave the expected answer every time and never accepted an input Botan rejected. The harness and results are in `doc/verify-sig/`.

**Behaviour differences to check.**
- Keys must be exactly the DER SubjectPublicKeyInfo for the curve, with a compressed or uncompressed point. Botan also accepted a trailing byte, non-zero unused bits, a non-minimal curve identifier and hybrid-form points.
- Compressed P-256 points are expanded in the service, using BearSSL's internal `br_i31_*` routines, because BearSSL only takes uncompressed points. BearSSL still validates the expanded point.
- The build now downloads libsecp256k1 from GitHub and BearSSL from bearssl.org at configure time. Mirroring them next to the Botan tarball is undecided.

**Known limits.** P-256 verification is still roughly eight times slower than secp256k1 (about 210 µs against 25 µs in an isolated measurement). The differential check is not yet an in-tree test.

### 4. Key curve default and canonical signatures

**In the head.** cb87219ff: keys generated by the C++ key helper, by psinode's software signer and by the psinode test harness are secp256k1. PKCS #11 keys stay P-256.

**Canonical signatures, in the head.** `verify-sig` accepts only low-S signatures on both curves, and every signer normalizes: the C++ helper, psinode's software and PKCS #11 signers (one shared helper, `normalizeSignature`), the Rust library's P-256 and PKCS #11 signers, the browser signing plugin, and the test harness. Two tests cover the paths the suites did not exercise: the browser plugin's signing function (`plugin-web-crypto-tests`) and the Rust PKCS #11 signer against a SoftHSM token holding one key on each curve, which also shows that the token itself returns high-S.

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

- **The team's Ubuntu 22.04 CI check fails on this pull request at configure**, before any code is built: the head requires CMake 3.28 or newer and the builder image has an older one (#2238). The other checks pass. A change that removes the CMake 3.28 requirement is being prepared; binaryen 133 and rustc 1.100 will still be needed on the image.
- CMake 3.28 or newer.
- binaryen 133 or newer must be first on `PATH`; older versions cannot read wide-arithmetic code and the configure step now says so.
- Rust services get wide arithmetic only with rustc 1.100 or newer. rustc 1.98 miscompiles 128-bit arithmetic when the feature is on, giving wrong multiply and add/subtract results on every engine, so `cargo-psibase` adds the flag only for 1.100 and later and builds without it otherwise, with a message.
- psizam, psitri and ucc are fetched at configure time over HTTPS and pinned; the eos-vm submodule is no longer what the node runs on.
- Building the web UIs refuses an unsupported Node version and says why (8747dc889).
- The tree builds and its suites run on macOS (Apple silicon) as well as Linux x86-64.

### 9. Serialization: fracpack to PSSZ on the official PSIO library

This section was written by the author of the migration.

**What changed.** The in-tree `libraries/psio` (the old psio with fracpack), `rust/fracpack` and the Python fracpack codec are deleted. Every C++ and Rust type, action, table row, event, schema, JSON and GraphQL path uses [gofractally/psio](https://github.com/gofractally/psio), pinned. There is one library and no compatibility layer; chains and databases from before are not readable.

**Wire formats.**
- Actions, results, table values, events, blocks and transactions: PSSZ. The offset width is 1, 2 or 4 bytes, chosen per type from its declared cap or inferred bound; records are extensible by trailing optionals; maps and sets are strictly ordered.
- Table keys: the PSIO key format.
- HTTP and JSON: I-JSON. 64-bit integers are bare below 2^53, bytes are upper-case hex.
- Service schemas: PSIO Schema IR, as I-JSON in files and PSSZ in `setSchema`.
- Account names keep psibase's own coding; method names use PSIO's coder.

**Where to look.**
- `doc/migrations/2026-11-fracpack-to-pssz/team-review.md`: everything the team must decide or confirm. Start with sections 12 and 13.
- `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md`: the mapping from each old call to the new one (sections 3 and 6.6), the merge handover and classes of failure (section 7).
- `doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md`: the rules that keep C++ and Rust twins of a type identical. `doc/migrations/2026-11-fracpack-to-pssz/merge-checklist.md`.
- Code: `libraries/psibase/common/include/psibase/{Table,Rpc,Actor,schema}.hpp`, `libraries/psibase/native/src/{BlockContext,TransactionContext}.cpp`, `rust/psibase`, `rust/psibase_macros`, `packages/system/Transact`.
- The library itself: start with its `docs/annotations.md`, `docs/tutorial-annotations.md` and `docs/pssz-spec.md`.

**Evidence.**
- macOS, wasmtime: full ctest 88/88 (the count fell because the old library's own tests were deleted with it).
- x86-64 Linux at e93c2e64d: wasmtime native 19/19, end-to-end 39/39, Rust 29/29, plugins 1/1; LLVM AOT native 20/20 and end-to-end 39/39.
- A fixture that C++ and Rust both encode is byte-identical for types, JSON, service schemas, leaf types and wrappers, and every Rust workspace type-checks.
- End to end by hand: boot, account creation, GraphQL on a C++ and on a Rust service, the schema endpoint, pushing a transaction, and stopping and restarting a node that continues. Commands and output are in `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md` section 7.
- PSIO's own suites: C++ 424/424 in both JSON-parser configurations, Rust 1,141, JavaScript 252, Python 90.

**Questions for reviewers.**
1. Size caps. Only `Memo` (UTF-8, 80 bytes) and two callbacks are capped. Proposed caps for everything else are estimates awaiting review, and a cap is permanent for a type.
2. Trust. Rows a service reads from its own tables are decoded with validation today. The intended rule is trusted reads of own rows and validated action and cross-service data.
3. Naming. The implementing language is the authority for a name; a blanket camelCase rename is held for team discussion.
4. Members that exist in a struct but are absent from reflection, listed as questions of intent.
5. JSON and GraphQL behaviour that clients will notice (`doc/migrations/2026-11-fracpack-to-pssz/team-review.md` sections 8 and 12).

**Closed since the migration merged.**
- Transaction size: the guest's strict check now walks the transaction in place, and Transact accepts one up to its 32 MiB of memory (31.6 MiB measured). A test pins 1, 4.5, 8 and 16 MiB and passes on both machines and both engines.
- Method results: schemas carry the declared result type, and callers in C++ and Rust decode through it (#2235).
- Variant labels follow one rule in every language, so C++ and Rust service schemas compare with no special case.
- The fracpack-named calls and helpers are renamed or deleted.

**Known gaps.** The living list is `doc/migrations/2026-11-fracpack-to-pssz/team-review.md`, sections 12 and 13.
1. Large transactions over HTTP (#2233, partly fixed). Up to 1.6 MiB the client gets the whole trace; above that, a 200 with the outcome only; above 5 MiB, a 413 naming the limit; from 8 MiB a service ahead of `r-transact` traps and the client gets a 500. The two limits are new constants chosen by measurement and need the team's confirmation. Receiving from a peer has no size limit of its own.
2. Names and pages still describing the old format (#2234): a `block.frac` file name in the consensus replay test, and the documentation pages `fracpack.md`, `schema.md`, `js-libraries.md` and the end of `rust-service/tables.md`. `demo/` has not been built.
3. Not exercised by anyone (#2236): front ends and plugins in a browser, the snapshot tools at run time and validation on snapshot import, `demo/`, and a service that reads a multi-megabyte argument. `psibase boot` returns before the boot transactions are applied, which needs confirming as intended.
4. Size caps and trust, as in the questions above, and the token-transfer `data` argument is not implemented.
5. In the PSIO library: strict validation and trusted views in Rust, JavaScript and Python lag C++; the schema format has no canonical byte form; and several smaller items are open there (psio issues 3 to 9).
6. For Rust code outside the tree: `Caller::call` gained a bound tying arguments to the declared result. Serialized service schemas changed at the current PSIO pin, so packages built before it must be rebuilt.
7. Throughput has not been remeasured since the serialization change.

## Throughput

The table is at the top of this document. The three head commits in it were measured in one session on an idle server. **All of these figures predate the serialization change** (they stop at 054a0c386); throughput has not been remeasured since.

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

The full report, with raw output, is in `doc/benchmarks/transfer-throughput/`.

## Test results

Suite results are recorded per commit under `tests/timing/runs/`. On wasmtime unless a row says otherwise:

| Commit | Mac | x86 |
|---|---|---|
| c45c060cd | native 24/24, end-to-end 39/39, Rust 29/29 | native 20/20, end-to-end 39/39, Rust 29/29 |
| 054a0c386 | full ctest 92/92 | native 20/20, end-to-end 39/39, Rust 29/29 |
| 04efaefe4 | not run at this commit | native 20/20, end-to-end 39/39, Rust 29/29, browser-plugin signing test 1/1 |
| 733be8cde (psitri 94fa328) | not run at this commit | native 20/20, end-to-end 39/39, Rust 29/29, browser-plugin signing test 1/1 |
| e272625fc (one clock) | not run | native 20/20, end-to-end 39/39, Rust 29/29, plugins 1/1 |
| 34fced88e (budget raised mid-run) | not run | native 20/20, end-to-end 39/39, Rust 29/29, plugins 1/1 |
| 7fe3cda05, built for LLVM AOT | not run | native 21/21, end-to-end 39/39; Rust suite not run |
| a217d99bb (serialization migration) | full ctest 88/88 | not run at this commit |
| e93c2e64d (PSIO 66abb1b, psitri d3bba0e) | not reported | wasmtime: native 19/19, end-to-end 39/39, Rust 29/29, plugins 1/1. LLVM AOT: native 20/20, end-to-end 39/39 |

## Known gaps, in one place

Open items are tracked as issues and closed as they are fixed.

- LLVM AOT is re-verified on x86 only (native and end-to-end); not on macOS, and not the Rust suite. The interpreter, JIT1 and JIT2 are experimental and unverified on this head: #2228.
- Deterministic stack check on wasmtime costs memory traffic on every call: #2221.
- Admission does not cover what only an engine's compiler refuses: such code is stored and fails at its first call. wasmtime refuses modules the chain policy admits (a function with more than 50,000 locals or 1,000 parameters, a name over 100,000 bytes, a function body over 7,654,321 bytes), which a psizam engine would run: #2256.
- Events: one billing event per transaction and the per-block pipeline: #2218. Objective pricing for events, by size and index count: #2223.
- Network throughput drops with more connections, and signed lags unsigned: #2220.
- secp256k1 by default in the Rust library and the browser plugins: #2216.
- P-256 verification is about eight times slower than secp256k1: #2222.
- Crypto library sources are fetched from their upstream sites, not mirrored: #2224.
- The verifier's differential and Wycheproof checks are not an in-tree test: #2225.
- The team's CI image cannot configure the head (CMake 3.28, binaryen 133): #2238.
- psitri, ucc and psio have no license file.
- Serialization: large transactions over HTTP (#2233), names and pages still describing the old format (#2234), and what nobody has exercised yet, including front ends and plugins in a browser (#2236). The rest is in section 9 and `doc/migrations/2026-11-fracpack-to-pssz/team-review.md`.
- Throughput has not been remeasured since the serialization change.
- `doc/verify-sig/` records measurements taken before the serialization change; its harness and case generator use the old library's calls and will not build against this head as written.
- psitri: the legacy engine's compatibility leg ([psitri#2](https://github.com/gofractally/psitri/issues/2)); freed space that can stay uncompacted ([psitri#7](https://github.com/gofractally/psitri/issues/7)); a debug mode that aborts on a partly filled segment ([psitri#6](https://github.com/gofractally/psitri/issues/6)).
- The reference-count abort seen in `psinode_test_crash`: not reproduced on the current line, root cause not found: #2229.
- rustc treats the wide-arithmetic target feature as unstable: #2230.

## Still to come in this pull request

- LLVM AOT on macOS and under the Rust suite (#2228).
- Throughput figures for the current head. The table at the top stops at 054a0c386, before the serialization change.

## A note on how this was written

The sections on signature verification, key defaults and canonical signatures describe work done by the author of this document and were checked against the code and test runs. The serialization section was written by the author of that migration. The other sections are summarized from the commit history and from reports by the people who did that work, and may be corrected by them.
