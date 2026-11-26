# WebAssembly support

## Features

The following features are available, in addition to [WebAssembly MVP](https://github.com/WebAssembly/design/blob/main/MVP.md):

- [Import/Export of Mutable Globals](https://github.com/WebAssembly/mutable-global/blob/master/proposals/mutable-global/Overview.md)
- [Fixed-width SIMD](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)
- [Non-trapping float-to-int conversions](https://github.com/WebAssembly/nontrapping-float-to-int-conversions/blob/main/proposals/nontrapping-float-to-int-conversion/Overview.md)
- [Sign-extension operators](https://github.com/WebAssembly/sign-extension-ops/blob/master/proposals/sign-extension-ops/Overview.md)
- [Bulk memory operations](https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md)

## Implementation Limits

A WebAssembly module must obey several constraints, which are defined by a `VMOptions` object, which is loaded at the start of the transaction from the `transactionWasmConfigTable` or `proofWasmConfigTable` depending on the context in which it is being run. These constraints serve to limit the temporary memory required to run the transaction.

### Max stack bytes

Every function is assigned a cost which is calculated as the total size of all local variables, all stack items, and the call frame. Function parameters are counted in the caller, not the callee. Since the stack varies throughout the function, we use the maximum size of the stack at any point in the function.

| Type   | Size |
|--------|------|
| `i32`  | 4    |
| `f32`  | 4    |
| `i64`  | 8    |
| `f64`  | 8    |
| `v128` | 16   |
| frame  | 16   |

`call` has a cost of 4096. All other host functions have a cost of 0.

If the total cost of all functions on the stack ever exceeds the configured limit, the transaction will terminate with an error. In addition, if any function has a cost greater than 128 MiB, the module will fail to validate (No reasonable module can exceed this limit, because it requires having unused locals).

### Max pages

`memory.grow` fails and returns -1 if it is asked to increase the number of 64 KiB pages past the configured limit. If a module's initial memory exceeds the limit, the module will fail to load.

### Max table elements

If the initial size of the table is greater than the limit, the module will fail to load.

### Max mutable global bytes

If the total size of all mutable globals is greater than the limit, the module will fail to load.

### Max branch-local pairs (per function and per module)

`max_branch_local_pairs` and `max_module_branch_local_pairs` limit the memory a compiler needs for a module. Without them a module of a few kilobytes can need gigabytes: a compiler that works in SSA form gives a local variable a block parameter wherever control merges with different values of it, and every edge into the merge passes one argument per parameter, so its memory grows with (edges into a merge) × (locals merged there). A function with 2,047 locals and one `br_table` of 4,096 targets is 24 KB and took 1.4 GiB to compile; 1,000 nested `if`s around a write of every local are 23 KB and took 3.5 GiB.

The limited quantity is computed from the module alone, so every node gets the same number whatever engine it runs. A *region* is a `block`, a `loop` or an `if`, from its opening instruction to its `end`. For each region of a function:

- *edges* = the branches that name its label (one for each `br` and `br_if`, one for each entry of a `br_table` and one for its default), plus 1 for a `block` or a `loop`, plus 2 for an `if`
- *values* = the distinct locals that a `local.set` or `local.tee` inside the region names (parameters are locals), plus the operands a branch to its label carries (the results of a `block` or `if`, the parameters of a `loop`)

The measure of a function is the sum of *edges* × *values* over its regions, plus (branches to the function's own label + 1) × the number of its results. A function above `max_branch_local_pairs` fails to validate, and so does a module whose functions add up to more than `max_module_branch_local_pairs`. The error names the limit and the function.

It is an upper bound on the block-parameter arguments, not their number: a local that is written in a region and never read afterwards is counted, though it costs nothing. Code that only reads its many locals, or branches a lot without writing them, is not affected.

What the numbers mean in compiler memory, measured on wasmtime 51 (Cranelift 0.138, regalloc2 0.15.3): 150 to 170 bytes a pair when many edges enter one merge, and 680 to 970 bytes a pair when each merge has two edges and makes a new value of every local (the worst shape found). Use 1 KiB a pair to plan:

| | Pairs | Memory at most (1 KiB a pair) | At 170 bytes a pair | Largest in the services built here |
|---|---|---|---|---|
| Function, default | 524,288 | 0.5 GiB | 85 MiB | 105,151 |
| Function, ceiling | 4,194,304 | 4 GiB | 0.7 GiB | |
| Module, default | 4,194,304 | 4 GiB | 0.7 GiB | 1,060,186 |
| Module, ceiling | 16,777,216 | 16 GiB | 2.7 GiB | |

Functions are compiled in parallel, and only the ones being compiled hold this memory, so a module needs at most min(module limit, compile threads × function limit) × 1 KiB. The ceilings are the largest values a chain's configuration may set.

These limits do not bound compile time. With a register allocator that is linear in its input, time is 0.3 to 1.4 microseconds a pair (0.6 s for a function at the default); with regalloc2 0.15.3 a function at the default limit took 58 CPU seconds. A node protects itself from long compiles separately, before it includes a transaction.

The full definition, the reasoning and how to measure again are in the comment at `vmOptionCeilings` in `libraries/psibase/native/include/psibase/PsizamPolicy.hpp`; `libraries/psibase/native/tests/branch_local_pairs.py` computes the measure of any module.

### Module size

A module must fit in a database row, which means that it cannot be larger than 8 MiB in toto.
