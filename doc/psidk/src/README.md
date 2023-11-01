# Psibase

![<Psibase Logo>](./_img/logo-psibase-green.svg)

## What is Psibase

Increasingly, individuals need online applications that they can self-host in order to protect their data, guarantee the app's future availability, and eliminate censorship concerns. Communities have similar needs. Communities often want to avoid depending too heavily on any one member or third party.

Psibase is a powerful protocol that enables communities to come together to collectively self-host web applications. Psibase further enables the development of a new kind of web app that is uniquely well-suited to working alongside other community apps.

Community members opt to become infrastructure providers (IPs) for the rest of the community. All network participants get accounts and can use community-owned apps to invite others into the community. Developers can publish their apps and services to further extend the capabilities of members.

## Psibase applications

Psibase can host the full application stack. Accounts on Psibase double as domain names relative to each infrastructure provider's root domain name. For example, if an infrastructure provider is hosting their node at `my-psibase-node.com`, then an account `alice` could host content that is retrievable at `alice.my-psibase-node.com/`. If another IP on the same network is hosting at `another-node.com`, then Alice's content is also available at `alice.another-node.com`. Each IP on the network is responsible for hosting full applications and their state, and providing API/RPC access for those trying to interact with the apps on the network.

This design provides redundancy so that a community that self-hosts their applications using psibase is resilient to server unavailability and other faults. Furthermore, anyone can run their own infrastructure provider node and will effectively have all apps/services/state running on their local node, further eliminating dependency on external parties.

### App stack

A Psibase app has three parts which can each be stored in and served from a Psibase account:
1. The service - Server-side component that handles web requests and defines the actions users can take to update their own app data.
2. The interface - Client-side component that wraps requests and complex interactions with apps and services into a concise and user-friendly API for consumption by user-interfaces.
3. The user interface - The typical client-side component that is presented to the user in the browser.

Psibase networks provide some default applications that manage account creation, user onboarding, application browsing, and other core capabilities required by all deployments. This saves time and energy for communities; deploy psibase and skip straight to developing the applications that fulfill your mission.

To read more about the default applications, see [here](default-apps/).

## Innovation stack

Psibase includes many technologies and innovations. Here are a few of them.

### Blockchain

Blockchains provide a means for decentralized rate limiting and shared resource consumption, and a method to synchronize the state between a set of distributed nodes in a network. Block production is therefore one of the services provided by the psibase IPs.

The novel blockchain architecture defined by psibase minimizes the complexity of the code that runs natively on the infrastructure provider in favor of defining functionality in discrete WebAssembly modules that are synchronized across nodes by the blockchain itself. This maximizes the flexibility of the infrastructure providers, enabling communities to reach consensus on and implement changes to the blockchain protocol itself.

Furthermore, the psibase blockchain architecture is designed to interface directly with HTTP/RPC queries, allowing it to store and serve application front-ends. This design choice addresses a common failure mode of decentralized applications: the front end is rarely decentralized. With the psibase blockchain architecture, everything from the back-end to the front-end, as well as the API provision are all equally decentralized. This helps to maximize the independence of the community leveraging psibase. This also allows the core blockchain protocol to serve graphical user interfaces for simpler understanding and configuring of the core protocol itself.

The reference implementation of this blockchain protocol, including reference implementations of the necessary WebAssembly components and associated front-end applications, can be found in the psibase repository [here](https://github.com/gofractally/psibase).

Further reading on the default applications can be found [here](default-apps/).

### Application interfaces

In addition to storing and serving user interfaces, the psibase protocol also introduces the concept of app interfaces, which wrap interactions with applications into convenient client-side helper functions. These interfaces are intended to facilitate most interactions between users and applications.

More about application interfaces can be read about [here](development/interfaces/).

### Triedent

Blockchains coordinate shared state between different nodes. Within a single node, there is still an underlying database technology used to store, cache, and retrieve data from the device storage disk and/or RAM. Psibase also specifies the design and characteristics of this underlying database technology in order to maximize its throughput by working with the unique constraints of a blockchain use case. For example, read queries to this database must run in parallel without significantly affecting write performance. This characteristic minimizes the costs of running infrastructure providers because the blockchain state can be accessed in parallel by many CPU cores.

This novel database design is called Triedent, and a reference implementation can be found [here](https://github.com/gofractally/psibase/tree/main/libraries/triedent).

### Fracpack

Psibase also specifies a novel data-serialization format built for extremely fast data packing and unpacking, and even reading without unpacking. This binary format is used when passing data between psibase services within a node, between nodes, and between nodes and user browsers. This is also the binary format of the objects stored in the database on any particular IP node.

This novel binary format is called Fracpack. Learn more about the design of the format [here](development/format/fracpack.md), and a reference implementation can be found [here](https://github.com/gofractally/psibase/blob/main/libraries/psio/include/psio/fracpack.hpp).

### Custom WebAssembly runtime

All WebAssembly modules must execute in a highly performant and fully deterministic WebAssembly virtual machine. The WebAssembly specification has made some [non-deterministic design choices](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md), because of which the default runtimes are insufficient for a blockchain use-case.

Psibase therefore defines a custom WebAssembly run-time based on a battle-tested and deterministic runtime called [EOS VM](https://github.com/eosnetworkfoundation/mandel-eos-vm). The psibase VM makes some further changes to the VM specification, unlocking more modern features from the WebAssembly specification such as [SIMD](https://github.com/WebAssembly/simd) which can be used to accelerate certain kinds of computation such as cryptographic operations.

The reference implementation for the custom Psibase WebAssembly runtime can be found [here](https://github.com/gofractally/eos-vm).

### Smart signatures

Psibase signature verification happens within wasm modules, and the cryptographic verification service for a particular transaction signature can be specified by the transaction, allowing developers to add new or custom signature types and curves. This system lays the groundwork for future innovations related to proving statements between networks, signature aggregation, and more.

Smart signature verification is also done in parallel to increase speed and the proofs are pruned to limit the data growth rate and decrease costs for infrastructure providers.

A reference signature verification service implementation can be found [here](https://github.com/gofractally/psibase/blob/main/services/system/VerifySys/src/VerifySys.cpp).

### Smart authorization

What is the best way for a user to generate proof that authorizes their account to perform some action? Many solutions and combinations of solutions may be ideal for any given scenario. The psibase protocol gives accounts complete programmatic control over how their account should be authorized. This could include simple signature verification, time locks, zero-knowledge password proofs, multi-user authentication, or anything else that developers can create. Psibase is unopinionated on exactly how to authorize an account and is only opinionated on the general transaction structure that enables the dynamic specification of such logic.

A reference implementation of a service that allows users to specify a simple cryptographic signature public key can be found [here](https://github.com/gofractally/psibase/blob/main/services/system/AuthSys/src/AuthSys.cpp).

## Conclusion

The psibase protocol encapsulates a host of open-source technical innovations including a new blockchain architecture, libraries for database management and data-serialization, and a full-stack web application and microservices framework. Intended to be a best-in-class base-layer infrastructure that can be trusted to facilitate better human collaboration and reliably power the next generation of community-hosted web apps.
