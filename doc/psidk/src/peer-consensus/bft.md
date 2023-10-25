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