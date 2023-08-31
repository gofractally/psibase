# Psibase

![<Psibase Logo>](https://about.psibase.io/assets/logo-psibase-green.0714b8ee.svg)

For a simpler overview of Psibase and its capabilities, see the [landing page](https://about.psibase.io). This document will explore the purpose and capabilities of Psibase in technical detail.

> **Table of Contents**
> - [What is Psibase](#what-is-psibase)
> - [Web3 applications](#web3-applications)
>   - [User experience](#user-experience)
>     - [Default user-facing applications](#default-user-facing-applications)
>     - [Trusted front-ends](#trusted-front-ends)
> - [Innovation stack](#innovation-stack)
>   - [Blockchain](#blockchain)
>   - [Triedent](#triedent)
>   - [Fracpack](#fracpack)
>   - [WebAssembly](#webassembly)
>     - [Composability](#composability)
>     - [Smart signatures](#smart-signatures)
>     - [Smart authorities](#smart-authorities)
>   - [GraphQL](#graphql)
> - [Deployment types](#psibase-deployment-types)
>   - [Simple deployments](#simple-deployments)
>   - [Distributed deployments](#distributed-deployments)
>   - [Centralized deployments](#centralized-deployments)
>   - [Decentralized deployments](#decentralized-deployments)
> - [Conclusion](#conclusion)

## What is Psibase

At ƒractally, we believe that the web needs higher integrity infrastructure to facilitate the next generation of truly neutral human collaboration and governance. Psibase is open source software that can be used to deploy such infrastructure to be used for publishing full-stack Web3 applications. It allows for private, public, centralized, or decentralized deployments, and aims to improve data integrity, user privacy and security, application efficiency and composability, and user and developer experience wherever it is deployed.

## Web3 applications

Applications published on Psibase are interconnected in a way that those on a traditional web stack are not. Psibase accounts allow users to use a single account to interact with all Psibase applications. Psibase applications are able to read from and write to a shared database, as well as send and receive synchronous messages to each other both server-side *and* client-side. This infrastructure allows users to seamlessly (often invisibly) digitally sign their interactions with applications, so applications can be confident about with which users they are interacting.

### User experience

The entire Psibase technology stack is built with user experience as our foremost concern. At ƒractally, we believe that the majority of users will ultimately use the most enjoyable and functional solutions, regardless of security, privacy, and other concerns. Therefore, to reintroduce integrity into the web, we must meet or exceed the expectations of users familiar with traditional web application experiences, while also being rigorously committed to the ideals we believe are ultimately best for online human interaction and collaboration.

#### Default user-facing applications

Psibase deployments come with default full-stack applications that manage account creation, user onboarding, application browsing, and other core capabilities required by all deployments. This saves time and energy for developers who, even if they are deploying their own infrastructure, can immediately focus on their intended application, rather than the core user-management capabilities.

#### Trusted front-ends

Application front-ends may be built using traditional front-end tooling, but are stored on the same blockchain as the back-end services and their data. This architecture has very powerful implications, not yet realized in the wider distributed application space; if a user runs her own infrastructure, then she has cryptographic certainty not only of the back-end services and the blockchain state, but also of the validity of the application front-ends she uses to interact with those services. This, combined with our novel [inter-applet-communication architecture](applet/inter-applet-communication.md) allows completely secure user-interaction with distributed applications without intrusive pop-ups from authenticators ("wallets") whenever a front-end is interacting with its own back-end service. Put another way, Psibase application front-ends are an extension of their back-end service, so just as a service has implicit authority to write to its own database tables, so too does the front-end have the implicit authority to silently sign for users when they interact with its own service/state. This allows for unprecedented user immersion for web3 applications deployed on Psibase.

## Innovation stack

Psibase includes many technologies and innovations. Here are a few of them.

### Blockchain

Psibase uses a new blockchain architecture rewritten from the ground-up by many of the same veterans who originally developed the Bitshares, Hive, and Antelope blockchain architectures. This blockchain is an important component of the overall Psibase architecture that positively affects data integrity, user security, and application composability. Many of the other components of the Psibase software are built to abstract the concept of a blockchain to give both users and developers an experience that is familiar and comparable to those in a more traditional architecture. Information on scalability and other economic design tradeoffs inherent to this blockchain design is outside the scope of this particular document, but can be found elsewhere in our documentation and publications.

### Triedent

Blockchains coordinate shared state between different computers, or nodes. But on a single node, there is still an underlying database technology used to store, cache, and retrieve data. Most blockchains today use the same pre-existing state-of-the-art database technologies used for all other applications, such as LMDB or RocksDB. The ƒractally team has determined that it is possible to significantly improve the throughput of that underlying database by redesigning one with the specific constraints and specifics of the blockchain use-case in mind. The outcome of that research and development is now known as the Triedent database.

Even still in its Beta version, the Triedent database performance was [benchmarked](https://hive.blog/fractally/@dan/fractally-s-groundbreaking-new-database-outperforms-lmbdx-eos-hive-chainbase-rocksdb) against several other database technologies and was found to be superior for use in a blockchain context in many ways. Triedent enables read queries to run in parallel without significantly slowing down write performance. This significantly reduces the costs of providing API access the blockchain state because the same memory can be used by dozens of CPU cores at the same time.

### Fracpack

Another innovation of the Psibase ecosystem is to use a novel data-serialization format known as Fracpack. Designing a binary format from the ground up lets us prioritize the properties that are important for our use-case. Fracpack gives us extremely fast data packing and unpacking, and even allows users to read data without unpacking (almost zero-copy). It's a format designed for efficiency in Psibase service-to-service communication, node-to-node communication, blockchain-to-outside communication, and database storage. We believe the efficiency and usability gains from our custom binary format make the deviation from standard serialization formats (Protocol Buffers, etc.) worthwhile.

To better understand the Fracpack format, see the [Fracpack](format/fracpack.md) section in these docs.

### WebAssembly

Psibase makes heavy use of WebAssembly, both for core system capabilities and also for the execution of services (application back-ends). This allows Psibase services to be written in either C++ or Rust, with the potential to expand in the future to support any language that compiles to the Wasm binary format. Using WebAssembly allows Psibase applications to run extremely fast in a sandboxed execution context, ensuring memory safety across the system. Psibase also attempts to maximize its use of WebAssembly modules stored in blockchain state to run core chain capabilities, to minimize the complexity and collaboration required to upgrade them.

Furthermore, the WebAssembly executes in a custom virtual machine known as [EOS VM](https://github.com/eosnetworkfoundation/mandel-eos-vm). This virtual machine is already a battle-tested WebAssembly VM with several years of operation in high performance production environments, and was custom-built to meet the performance demands of blockchain applications, which are significantly higher than those of normal web browser applications. On top of the already impressive innovation of the EOS VM, Psibase modifies it to enable the use of [SIMD](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data) ("Single Instruction, Multiple Data") instructions, for greater levels of parallelism and performance.

To learn how to write your own web-services in C++ or Rust and deploy them to a local Psibase deployment, see the [services](services.md) section of these docs.

#### Composability

Our infrastructure also allows services running in one wasm execution context to synchronously communicate with those executed in a separate context. This allows for extremely powerful and composable application designs.

#### Smart signatures

Smart signatures are one of the novel contributions the Psibase architecture makes to the wider blockchain space. These allow developers to add new or custom signature types and curves. Smart signatures can be used for Inter-blockchain-communication proofs, merkle proofs, and other cryptographic algorithms that may be necessary for future innovation.

Since smart signatures are implemented entirely in WebAssembly modules synchronized by the blockchain, this ensures they can be upgraded or patched in real time without the difficult coordination challenges experienced by other platforms (contentious or non-contentious hard forks).

Smart signatures verification is also done in parallel to increase speed and the proofs are pruned to limit the data growth rate and decrease costs for infrastructure providers.

#### Smart authorities

"Smart authorities" refers to the now completely dynamic and programmable Psibase account permissions. This means that accounts could use private keys, time delays, multi-party signature schemes, or anything else future developers dream up for authenticating account actions. And of course, the authorization logic is done completely within wasm modules, enabling simple and real-time updates to authorization capabilities.

### GraphQL

Psibase infrastructure providers are also web servers that respond to various user read/write requests. For reading service state, infrastructure providers are also GraphQL servers that know how to respond to requests for paginated data from service tables. Application and service developers have complete programmatic control over responding to web requests to their applications, with custom libraries made available that make it simple to define GraphQL schemas, endpoints, and construct responses.

## Deployment types

Psibase is built to be able to be deployed in several different ways:

| Political decentralization | Architectural decentralization | Description                                           |
|----------------------------|--------------------------------|-------------------------------------------------------|
| no                         | no                             | Single entity, single node deployment                 |
| no                         | yes                            | Single entity deployment with multiple failover nodes |
| yes                        | yes                            | Multiple entity deployment                            |

## Conclusion

Psibase is more than a blockchain platform. The Psibase brand encapsulates a whole host of open-source technical innovations including a new blockchain architecture, libraries for database management and data-serialization, and a full-stack web3 application and microservices framework. Intended to be a best-in-class base-layer infrastructure that can be trusted to reliably power the next generation of humanity's online collaboration and governance tools.

All of this technology is open source and we are always looking for ways to make the process of use and deployment faster and simpler. If our technology is of interest to you or your organization, please try it out, and don't hesitate to reach out in our public [telegram channel](https://t.me/psibase_developers).
