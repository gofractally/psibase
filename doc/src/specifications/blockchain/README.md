# Blockchain

Blockchains provide a means for decentralized data storage, rate limiting and shared resource consumption, and a mechanism for data synchronization between nodes in a distributed network. For psibase, the use of a blockchain is instrumental - it offers a convenient architecture for shared, public, state management and synchronization, and could optionally allow for the distribution of a token used for decentralized rate limiting.

## Goals

There are many goals for the psibase blockchain protocol design. Here are some of them:

1. Enable web apps to be responsive and immersive
2. Enable protocol and application upgradeability
3. Enable network participants to reach social consensus

### Responsive web apps

Psibase apps should be able to at least meet and in some cases exceed the expectations of users who are familiar with extremely fast traditional web apps.
To achieve goal #1, the psibase blockchain is designed to produce at least one block per second, and to reach block finality within three seconds. Furthermore, the protocol defines several custom high-performance data formats used by the blockchain to accelerate data reads, transfer, storage, and retrieval. It defines a custom high-performance [database](./database.md) protocol that is significantly more performant than alternative industry standard databases.

Furthermore, interactions with smart contracts on other platforms often require immersion-breaking prompts for use authorization. When the front-end of a psibase app interacts with its own blockchain service, it should not prompt for user authorization. This allows for greater immersion than other decentralized app architectures.

### Upgradeability

Maximizing protocol implementation stored in chain state allows for the chain synchronization capabilities to be used even to update itself and its own protocol (goal #3). Unlike other architectures where minor protocol updates require complicated coordination between node operators, psibase networks are able to easily upgrade the protocol to fix bugs or make improvements.

Application upgradeability is functionally always available on a network. Some networks attempt to make applications immutable by default, which simply results in convoluted upgrade techniques such as [proxy contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies). Therefore the psibase blockchain by default allows apps to upgrade. If immutability is important to a community, then developers are able to manually permanently lock their apps.

### Social consensus

Technical blockchain consensus is always downstream of social consensus. There always exist desirable features of a network (expectations, cultural norms, etc.) that are unable to be deterministically verified and are therefore unable to be deterministically enforced. This implies that networks must plan to be able to reach consensus on subjective matters in order to maintain the values that matter to them. Unspecified "off-chain" consensus is not a plan and will result in covert control and increased dependence.

The psibase blockchain protocol defines a mechanism by which a community can use psibase as a tool for measuring social consensus. This allows it to be a social consensus process, rather than a technical consensus process (as in traditional Proof of Work or Proof of Stake consensus), which provides the security guarantees for the network. This innovation in social consensus allows for even very small communities to enjoy extremely high levels of security and independence.

## Philosophy

The psibase protocol is less philosophically motivated by architectural decentralization than it is by political decentralization ([definitions](https://medium.com/@VitalikButerin/the-meaning-of-decentralization-a0c92b76a274)). Psibase attempts to maximize the independence of communities that use its infrastructure, which is why it enables hosting the full application stack, eliminating points of political centralization related to serving front-end that exist elsewhere.

Psibase is less philosophically motivated by interoperability with other networks than it is about creating its own independently flourishing ecosystem. 

## Reference implementation 

The reference implementation of this blockchain protocol, including reference implementations of the necessary WebAssembly components and associated front-end applications, can be found in the psibase repository [here](https://github.com/gofractally/psibase).
