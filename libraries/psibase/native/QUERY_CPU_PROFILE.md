# Native query CPU diagnostics

This optional probe is supported only by a native build with
`PSIBASE_VM_BACKEND=WASMTIME`. Setting `PSIBASE_QUERY_CPU_PROFILE=1` enables it.
It rejects other backends and simultaneous `PSIBASE_CALL_PROFILE` use. With the
environment variable absent, scopes skip clocks, counters and checkpoint work.
The probe changes no service API, database record, billed CPU field, or action
trace. Its execution overhead can still affect elapsed execution budgets.

The node prints `QUERY_CPU_PROFILE_ENABLED` with its PID, operating-system
process start time in Unix seconds, and the checkpoint signal `SIGUSR1`.
Verify that identity against the target process before sending a signal.
`SIGUSR2` remains reserved for the Darwin CPU clock and must never be used for
this probe. The handler sets only a lock-free atomic flag. A later outer scope
boundary performs the checkpoint outside the handler. An entirely idle node
does not have a guaranteed checkpoint latency.

Each `QUERY_CPU_PROFILE` line is cumulative JSON. Compare two snapshots from
the same PID and process start identity, with increasing `snapshot_seq`.
`CLOCK_THREAD_CPUTIME_ID` charges each thread's closed intervals to exactly one
bucket. Entering a nested scope closes the parent interval; leaving it restores
the parent bucket, including exceptions and reentrant service calls.
Each thread writes its own 128-byte-aligned atomic counter record. Nested scopes
perform no shared atomic updates. Only outermost scopes update the global
active-root count and generation. A thread registers once; records remain after
thread exit so cumulative totals include completed workers.

- `wasm_cpu_ns` covers actual guest-entry calls: module/service startup and
  action/function invocation. It includes the call/dispatch trampolines around
  those entries, while excluding native instantiation, VM setup and the
  instrumented host/DB calls.
- `host_native_cpu_ns` covers native VM execution setup and host-function entry
  regions, excluding nested guest execution and raw database calls. Instance
  creation, interrupter setup and stack plumbing belong here.
- `db_cpu_ns` covers the seven instrumented raw KV operations in `usePsitri.cpp`,
  including lookup setup, change tracking, buffer work and storage primitives.
  It is not a claim about pure trie instructions or physical disk latency.
- `process_cpu_ns` is process user plus system CPU from `getrusage(RUSAGE_SELF)`.
  `native_residual_cpu_ns` is that total minus the three measured buckets. It
  includes HTTP/JSON work, other native setup, background threads, owner-thread
  work outside those KV regions, and profiling work outside the scopes.

Checkpoints require zero active outermost scopes and an unchanged root-entry generation
around the counter reads and process CPU sample. A busy or changing sample is
deferred without blocking runtime work. Published snapshots have
`active_scopes=0`; any nonzero `clock_errors` invalidates CPU attribution.
The process CPU clock has the microsecond precision of `getrusage`; thread
intervals use nanoseconds. This is whole-process attribution for the measured
window, including unrelated/background work in that process.

Run primary capacity measurements with the original uninstrumented binary.
Run the same workloads separately with profiling enabled, and report the
CPU/latency overhead relative to that baseline. Clock reads, atomics and probe
instructions partly land in their surrounding buckets, so profiled CPU shares
include probe overhead. If a warm-read nudge is required to produce a checkpoint,
include or independently measure that extra request rather than hiding it.

`QueryCpuProfileTests` checks deterministic exclusive accounting, real thread
CPU with nesting and exceptions, disabled behavior, signal conflicts, deferred
active snapshots, rejection of unsupported backends, and per-thread partitioning
across worker exit and replacement. Run:

```sh
cmake --build BUILD --target QueryCpuProfileTests QueryCpuProfileUnsupportedTests
ctest --test-dir BUILD -R '^QueryCpuProfile_' --output-on-failure
```
