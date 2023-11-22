# Services

## What is a service

A service is like a smart contract on other chains, but has these differences:

- A service may serve either static or dynamic web pages which interact with the block chain.
- A service may provide RPC queries, GraphQL queries, and even help construct transactions. These may all rely on chain state.
- A service is often paired with a UI and plugin, forming a bidirectional trust relationship.
- A service may emit [events](../../specifications/app-architecture/events.md), which are like structured and prunable logs that can be queried by clients.
- Most psibase functionality comes from services instead of from native functions.
- The term "service" is common in computer systems and doesn't imply a legal or business relationship.

psidk supports writing services in [C++](cpp-service/basic/) and [Rust](rust-service/basic/).

## WebAssembly

All services are implemented as [WebAssembly](https://webassembly.org/) modules. For low level details on WebAssembly support, see the [WebAssembly docs](./webassembly.md).
