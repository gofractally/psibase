# Peer Consensus

The blockchain forms a replicated state machine. Each block contains a cryptographic hash identifying the previous block and a bundle of transactions that can be applied to the chain state to create a new state. Block execution is strictly deterministic. Applying the same sequence of blocks to the same initial state will always result in the same final state. The process of consensus ensures that nodes agree on the sequence of blocks to apply, and thus agree on the state of the chain.

New blocks are created by block producers designated in the chain state. After a block producer creates a block, the block is distributed to all other block producers which then agree to make the block irreversible. If there are conflicts, then the consensus algorithm will resolve them. Each consensus algorithm has its own constraints on the behavior of block producers. As long as these constraints are met, the consensus algorithm guarantees safety:
- Only one fork can ever become irreversible
- If two blocks are irreversible, one must be a descendant of the other
- An irreversible block cannot be forked out

All of these formulations are equivalent.

# Consensus Algorithms

Psibase supports running the following algorithms for peer consensus:

- [CFT](cft.md) - Crash fault tolerant, ideal for non-adversarial (trusted) peers
- [BFT](bft.md) - Byzantine fault tolerant, ideal for adversarial (non-trusted) peers
- [Joint Consensus](joint-consensus.md) - An algorithm designed to allow for dynamically transitioning between consensus algorithms

> Note on special cases: 
> * Blocks with a single producer are immediately irreversible. This is a degenerate case for both algorithms and they behave identically.
> * The genesis block is immediately irreversible. There is nothing to preserve pre-genesis.
