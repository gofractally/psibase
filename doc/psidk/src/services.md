# Services

A service is like a smart contract on other chains, but has these differences:

- A service may serve either static or dynamic web pages which interact with the block chain.
- A service may provide RPC queries, GraphQL queries, and even help construct transactions. These may all rely on chain state.
- A service is often paired with an [Applet](applet/applets.md), forming a bidirectional trust relationship.
- The term "service" is common in computer systems and doesn't imply a legal or business relationship.

psibase supports services written in [C++](cpp-service/basic/index.md), Rust (TODO), and AssemblyScript (TODO).
