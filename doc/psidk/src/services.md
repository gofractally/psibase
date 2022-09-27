# Services

A service is like a smart contract on other chains, but has these differences:

- A service may serve either static or dynamic web pages which interact with the block chain.
- A service may provide RPC queries, GraphQL queries, and even help construct transactions. These may all rely on chain state.
- A service is often paired with an [Applet](applet/applets.md), forming a bidirectional trust relationship.
- Most psibase functionality comes from services instead of from native functions.
- The term "service" is common in computer systems and doesn't imply a legal or business relationship.

Psibase services are WASM. psidk supports writing services in [C++](cpp-service/basic/index.html),
[Rust](rust-service/basic/index.html), and AssemblyScript (TODO).
