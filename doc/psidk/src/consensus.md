# Consensus Algorithms

- [CFT](#cft)
- [BFT](#bft)
- [Joint Consensus](#joint-consensus)
- [Special Cases](#special-cases)

## Overview

The blockchain forms a replicated state machine. Each block contains a cryptographic hash identifying the previous block and a bundle of transactions that can be applied to the chain state to create a new state. Block execution is strictly deterministic. Applying the same sequence of blocks to the same initial state will always result in the same final state. The process of consensus ensures that nodes agree on the sequence of blocks to apply, and thus agree on the state of the chain.

New blocks are created by block producers designated in the chain state. After a block producer creates a block, the block is distributed to all other block producers which then agree to make the block irreversible. If there are conflicts, then the consensus algorithm will resolve them. Each consensus algorithm has its own constraints on the behavior of block producers. As long as these constraints are met, the consensus algorithm guarantees safety:
- Only one fork can ever become irreversible
- If two blocks are irreversible, one must be a descendant of the other
- An irreversible block cannot be forked out

All of these formulations are equivalent.

## CFT

This consensus algorithm is based on RAFT and has the following properties:
- The network will make progress as long as more than 50% of the current producers are active.
- If any producer node generates a message that is not permitted by the protocol, the behavior is undefined.

The nodes start by electing a leader with a simple majority vote. The leader is responsible for producing blocks and tracking irreversibility. If a node does not receive new blocks after a randomly chosen timeout, it will attempt to promote itself to be the leader by starting a new term and requesting votes from other nodes. In any term, a node will vote for the first candidate that is up-to-date.

```mermaid
%%{init: {'theme': 'dark'}}%%
stateDiagram-v2
state prod <<choice>>
state lprod <<choice>>
nonvoting: Non Voting
leader: Leader
follower: Follower
candidate: Candidate
[*] --> prod
prod --> nonvoting: if not producer
prod --> follower: if producer
leader --> follower: new term seen
follower --> candidate: timeout
candidate --> candidate: timeout
candidate --> follower: new term seen
candidate --> leader: majority votes received
follower --> prod: producers changed
candidate --> prod: producers changed
nonvoting --> prod: producers changed
lprod --> leader: if producer
lprod --> nonvoting: if not producer
leader --> lprod: producers changed
```

### Irreversibility

Followers send confirmation to the leader after the block is successfully applied (Note: because this consensus algorithm assumes that all nodes are honest, the performance could be improved by sending a confirmation as soon as the block is stored durably). The leader advances irreversibility to the highest block in its own term that has been confirmed by more than half the producers (including itself).

### Messages

`BlockMessage`
`ConfirmMessage`
`RequestVoteRequest`
`RequestVoteResponse`

## BFT

BFT consensus has the following properties:
- The network will eventually make progress as long as the latency for a message sent at time t is in o(t)
- Up to f producers can fail in arbitrary ways without disrupting the network. There must be at least 3f+1 producers in the network.
- If more than f producers generate messages that are not permitted by the protocol, the behavior is undefined

### Block Production

Blocks are produced by the leader. Leader selection is round-robin.

### Irreversibility

- Blocks are ordered first by term, then by block height.
- Blocks go through two rounds of confirmation, prepare and commit. Each producer broadcasts its confirmations to all other producer nodes.
- A block is considered irreversible if it has been committed by 2f+1 nodes.

Block producers must obey these restrictions:
1. A producer shall only commit a block that has been prepared by 2f+1 producers.
2. A producer shall not prepare or commit conflicting blocks in the same term
3. A view change for view N names a block from any prior view that has been prepared by 2f+1 producers. This block must not be worse than any block that the producer has committed in any view before N.
4. The first block of a term must be a descendant of a block which is the best block referenced by 2f+1 view changes from different producers, and is referenced by the leader's best view change. The leader MAY issue more than one view change and MUST issue a second view change if its original view change refers to a block that is too old.

### View Change

Each producer maintains a view change timer to detect failure in the leader. The view change timer is restarted whenever irreversibility advances. When the view change timer expires, a producer broadcasts a `view_change_message` to all other producers and increments the current term, moving to the next leader.

- After initiating a view change, a producer will not restart the view change timer until it sees 2f+1 block producers are in the same term or later.
- Consecutive view changes during which the chain does not make progress, cause the view change timeout to increase.
- A view change will trigger immediately if the leader of the current term or at least f+1 other producers are in a later term. This view change is independent of the view change timer and may skip terms.

View change messages are broadcast network-wide. Every node retains the best view change from each active producer and broadcasts it to its peers whenever it receives a better one. When a node changes its view of active producers, it requests the current list of view change messages from all its peers.

The ordering of view change messages from a single node is defined as follows:
- A higher term is always better than a lower term
- The ordering of view changes with the same term depends on whether the node that issued the view change is the leader.
  - If the source is not the leader, a view change is better if it refers to an older block
  - If the source is the leader, a view change is better if it refers to a newer block

Note: Since the condition for activating a view requires the leader's view change to refer to a block which not older than other nodes' view changes, this ordering guarantees that as long as a valid set of view changes exist, all connected, honest nodes will converge to the same valid set.

### Safety

Let block X and block Y be two conflicting blocks which are both irreversible
- Without loss of generality, let X be better than Y
- Y has been committed by 2f+1 producers, because that is the requirement for it to be considered irreversible
- let Z be the earliest block that is an ancestor of X (inclusive of X), conflicts with Y, is better than Y, and is prepared by 2f+1 producers. Such a block is guaranteed to exist because X itself must be prepared by 2f+1 producers in order to be committed by any honest producer.

The existence of Z implies that at least f+1 producers have violated the protocol
- If Z and Y have the same term then at least f+1 producers have violated rule 2
- Y does not have a higher term than Z because Z is better than Y
- If Z is in a higher term than Y, then there is a valid view change set for the term of Z
  - Let W be the block named by the leader's view change
  - If W is worse than Y, then at least f+1 producers have violated rule 3
  - Otherwise, W is in a lower term than Z and is prepared by 2f+1 producers (by the definition of a view change) and conflicts with Y and is better than Y (otherwise X would be a descendant of Y), which contradicts the definition of Z.

### Messages

`BlockMessage`
`PrepareMessage`
`CommitMessage`
`ViewChangeMessage`

## Joint Consensus

Changes to the consensus algorithm or to the set of block producers are managed by joint consensus. Joint consensus defines a transition period during which the the old producers and the new producers cooperate to produce blocks. Joint consensus begins on the block containing the new producer schedule and ends after this block becomes irreversible. The precise behavior depends on the combination of the old and new consensus algorithms.

### CFT → CFT

The leader is selected from any of the old or new producers. Leader elections and irreversibility require majorities of both the old and the new producers.

### CFT → BFT

The leader is selected by election from the old producers. Irreversibility requires a majority of the old producers and a quorum of the new producers. Leader election requires a majority of the old producers and a quorum of the new producers. The new producers cannot advance the current term.

### BFT → CFT

The leader is selected from the old producers. The new producers commit, but do not prepare blocks. Commit require prepares by a quorum of the old producers. Irreversibility requires commits from a quorum of the old producers and a majority of the new producers.

### BFT → BFT

The leader is selected from the old producers. Activating a view, committing a block, and advancing irreversibility all require quorums of both the old and the new producers. View change auto triggers if f+1 of the old producers are ahead of the current term.

## Special Cases

- Blocks with a single producer are immediately irreversible. This is a degenerate case for both algorithms and they behave identically.
- The genesis block is immediately irreversible. There is nothing to preserve pre-genesis.
