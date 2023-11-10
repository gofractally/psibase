# Blockchain

Blockchains provide a means for decentralized data storage, rate limiting and shared resource consumption, and a mechanism for data synchronization between nodes in a distributed network.

Psibase defines its own blockchain architecture that is intended to minimize the complexity of the code that runs natively in the OS of the host node, in favor of defining functionality in discrete WebAssembly modules that can be synchronized across nodes by the blockchain itself. This has multiple benefits:
1. It allows for the functionality to be effectively sandboxed into separate WebAssembly execution contexts, improving security
2. It maximizes the flexibility of the infrastructure providers, enabling communities to reach consensus on and implement changes to the blockchain protocol itself

Furthermore, psibase nodes handle HTTP requests and can forward them into wasm modules stored in the blockchain. This allows it to store and serve application front-ends. This design choice eliminates front-end provision as a point of centralization in otherwise distributed infrastructure. With the psibase blockchain architecture, everything from the back-end to the front-end, as well as the API provision are all decentralized. This helps to maximize the independence of the community leveraging psibase. This also allows the blockchain to provide graphical user interfaces for simpler configuration of the core protocol itself.

The reference implementation of this blockchain protocol, including reference implementations of the necessary WebAssembly components and associated front-end applications, can be found in the psibase repository [here](https://github.com/gofractally/psibase).
