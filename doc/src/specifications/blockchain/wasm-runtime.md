# Custom wasm runtime

All WebAssembly modules must execute in a highly performant and fully deterministic WebAssembly virtual machine. The WebAssembly specification has made some [non-deterministic design choices](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md), because of which the default runtimes are insufficient for a blockchain use-case.

Psibase uses the native execution core of [psizam](https://github.com/gofractally/psizam) for node and test execution. Browser plugins use the browser WebAssembly runtime. The node applies an explicit policy to the low-level psizam backend rather than inheriting the general runtime facade defaults.

# Goals

- Support [bulk memory operations](https://github.com/WebAssembly/spec/blob/main/proposals/bulk-memory-operations/Overview.md)
- Support [sign extension operators](https://github.com/WebAssembly/spec/blob/main/proposals/sign-extension-ops/Overview.md)
- Better generated code optimization
- Add [non-trapping float-to-int conversions](https://github.com/WebAssembly/spec/blob/main/proposals/nontrapping-float-to-int-conversion/Overview.md)
- Support [128-bit SIMD instructions](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md) to accelerate some wasm computation such as cryptographic operations
- Support using the latest WASI SDK (Currently [wasi-sdk-20](https://github.com/WebAssembly/wasi-sdk/releases))
- Maintain full determinism developed for EOS VM

# Reference implementation

The pinned source is the `external/psizam` submodule at the canonical [native runtime checkpoint](https://github.com/gofractally/psizam/tree/checkpoint/native-runtime-2026-11-21), commit `4da50574dfeecece12bfc75e0f204031835d9db8`. Native node, tester and schema execution use `jit_profile` on x86-64 and AArch64, guarded memory and deterministic software floating point. The existing transaction CPU watchdog remains authoritative; psizam gas metering is disabled for this policy. The default proof-admission CPU budget remains 200 ms.

`NativeVMOptions` forwards every serialized chain `VMOptions` field: mutable global bytes, memory pages, table elements and stack bytes. The adapter rejects shared memory, memory64, imported resources, multiple memories or tables, exception tags, and tables other than funcref. It caps table growth before code generation using the same configured limit as the initial table, so the generated table layout agrees with initialization. Invalid policies fail explicitly.

Cached backends have exclusive transaction ownership and reset linear memory, mutable globals and table state before reuse. The watchdog disables executable code for both primary and alternative RPC/callback contexts on expiry. The transaction unregisters its watchdog and waits for any callback before clearing either context map and returning backends to the shared cache. Timed-out transaction contexts cannot be reused. Native host spans and unaligned pointer proxies preserve their WASM32 ABI and validate access inside guarded memory.

The native target links the engine core and standalone debugger only. The psizam component/runtime facade, which imports the new psio serialization headers, is excluded from the legacy-wire node during this checkpoint. This boundary allows the runtime and serialization migrations to be validated independently.

The tagged library passed standalone and native adapter qualification on macOS ARM64 and Vultr Linux x86-64. Independent [hosted Linux and macOS CI](https://github.com/gofractally/psizam/actions/runs/44941323233) passed at the exact tagged commit. These results qualify this runtime input; full application, admission-budget and release qualification remain separate gates.

`PsizamTests` checks the actual registered host ABI, chain resource policy, nested execution, deterministic floating point, traps and live backtraces, watchdog cancellation, transaction cleanup and cache reuse. `WatchdogTests` remains a separate CPU-accounting gate. The complete migration also requires Linux execution and the fresh application/relay regression suite; passing these focused runtime tests alone does not qualify the full migration.
