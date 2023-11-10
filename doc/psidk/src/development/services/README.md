# Services

## What is a service

A service is like a smart contract on other chains, but has these differences:

- A service may serve either static or dynamic web pages which interact with the block chain.
- A service may provide RPC queries, GraphQL queries, and even help construct transactions. These may all rely on chain state.
- A service is often paired with an applet, forming a bidirectional trust relationship.
- A service may emit [events](../../specifications/app-architecture/events.md), which are like structured and prunable logs that can be queried by clients.
- Most psibase functionality comes from services instead of from native functions.
- The term "service" is common in computer systems and doesn't imply a legal or business relationship.

psidk supports writing services in [C++](cpp-service/basic/) and [Rust](rust-service/basic/).

## WebAssembly

All services are implemented as [WebAssembly](https://webassembly.org/) modules.

### Features

The following features are available, in addition to [WebAssembly MVP](https://github.com/WebAssembly/design/blob/main/MVP.md):

- [Import/Export of Mutable Globals](https://github.com/WebAssembly/mutable-global/blob/master/proposals/mutable-global/Overview.md)
- [Fixed-width SIMD](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)

### Implementation Limits

A WebAssembly module must obey several constraints, which are defined by a `VMOptions` object, which is loaded at the start of the transaction from the `transactionWasmConfigTable` or `proofWasmConfigTable` depending on the context in which it is being run. These constraints serve to limit the temporary memory required to run the transaction.

#### Max stack bytes

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

#### Max pages

`memory.grow` fails and returns -1 if it is asked to increase the number of 64 KiB pages past the configured limit. If a module's initial memory exceeds the limit, the module will fail to load.

#### Max table elements

If the initial size of the table is greater than the limit, the module will fail to load.

#### Max mutable global bytes

If the total size of all mutable globals is greater than the limit, the module will fail to load.

#### Module size

A module must fit in a database row, which means that it cannot be larger than 8 MiB in toto.
