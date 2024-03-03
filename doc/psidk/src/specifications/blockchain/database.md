# Database

Blockchains coordinate shared state between different nodes. But within a single node, there is still an underlying database technology used to store, cache, and retrieve data from the device storage disk and/or RAM. Psibase also specifies the design and characteristics of this underlying database technology in order to maximize its utility under the unique constraints of a blockchain use case. 

## Goals

The goals of the database specification are to ensure that the database is fast and capable enough to serve as the underlying backend for servicing the expected queries for psibase networks.

1. Read queries must run in parallel without significantly affecting write performance, allowing multi-core utilization for servicing read-only state access
2. Collocate data based on access patterns rather than key values, reducing cache misses & paging
3. The data structure should be branchable, such that divergent state branches only require head pointers and the storage of deltas


## Data branching

A blockchain can be thought of as a shared data layer accessible by its deployed apps. Historically, there hasn't been much focus on the underlying database technology used to back each blockchain node. However, building apps on a blockchain introduces unique constraints that can be uniquely addressed if the underlying database is developed specifically for this use-case.

On psibase, the database must allow the blockchain state to branch in real time. State branches do not require state duplication, they only require tracking the data that is different between branches, similar to a `git` branch.

### Development dependencies

It is often the case that blockchain apps require access to third-party apps and their state in order to function. Having a shared data layer between apps is what allows this modularity. However, traditional web app tooling does not expect and therefore does not cater to this shared data, which complicates app development. If an app is developed that makes synchronous calls to an external smart contract, then testing the app requires also redeploying the external smart contract in the app's test environment. This challenge is compounded on psibase networks where modularity exists not only on the backend but also on the client side with the introduction of app [plugins](../app-architecture/plugins.md).

On psibase, data branching allows infrastructure providers to export a consistent view of the database without shutting it down. Developers could be provided a test network that includes all apps, state, and plugins with which they could expect to integrate on the production network.

### Speculative writes

It is sometimes the case that a service must perform some modification to its app state to know whether or not the state change is permitted.

In psibase services, developers may speculatively execute modifications to state and view the resulting state delta, after which the write can either be committed or rolled back. This is trivially possible due to data branching because it allows a temporary branch to be created for the speculative execution of the write.

### Contentious hard forks

It is sometimes the case that some combination of factors leads to the desire of one subset of infrastructure providers to fork away from the company of the other infrastructure providers. This is known as a contentious hard fork. 

In psibase, the ability to execute a contentious hard fork resulting in two separate networks with a shared history would be trivially possible. It would simply require the forking infrastructure providers to construct a data branch at a particular block height and recognize it as the new main branch.

The creation of such forks divides a network and so should not be common, but rapid branching could serve as the foundation of the tooling used to facilitate such a process if it is required. The ability to hard fork out of a network is the basis of legitimate consent and is therefore imperative to the core psibase blockchain [philosophy](./README.md#philosophy).

### Microfork support

For blockchain node operators, it is often the case that multiple competing blocks are proposed which each build off of the previous block. This is usually just a momentary fork (microfork) that will be resolved when either of the forks is confirmed by the subsequent block producer. 

In a psibase database, microforks should be nothing more than alternative state branches. This eliminates the need to store some kind of separate undo-state that must be applied if a block producer builds on a branch that is eventually microforked out.

### Snapshot generation

A common requirement for blockchain databases is that operators must generate snapshots from which new operators could bootstrap the data in their node's database. For psibase blockchains, snapshot generation is trivial and should only require that a new data branch is created at a particular block height. Such efficient snapshot generation could allow a network infrastructure providers to standardize on generating snapshots at a regular interval.

# Conforming database implementation

An initial implementation of a low-level database technology that conforms to the psibase expectations is called Triedent and can be found [here](https://github.com/gofractally/psibase/tree/main/libraries/triedent).