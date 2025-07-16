## Joint Consensus

Changes to the consensus algorithm or to the set of block producers are managed by joint consensus. Joint consensus defines a transition period during which the old producers and the new producers cooperate to produce blocks. Joint consensus begins on the block containing the new producer schedule and ends after this block becomes irreversible. The precise behavior depends on the combination of the old and new consensus algorithms.

### CFT → CFT

The leader is selected from any of the old or new producers. Leader elections and irreversibility require majorities of both the old and the new producers.

### CFT → BFT

The leader is selected by election from the old producers. Irreversibility requires a majority of the old producers and a quorum of the new producers. Leader election requires a majority of the old producers and a quorum of the new producers. The new producers cannot advance the current term.

### BFT → CFT

The leader is selected from the old producers. The new producers commit, but do not prepare blocks. Commit require prepares by a quorum of the old producers. Irreversibility requires commits from a quorum of the old producers and a majority of the new producers.

### BFT → BFT

The leader is selected from the old producers. Activating a view, committing a block, and advancing irreversibility all require quorums of both the old and the new producers. View change auto triggers if enough of either the old producers or the new producers have advanced to make consensus impossible in the current view.
