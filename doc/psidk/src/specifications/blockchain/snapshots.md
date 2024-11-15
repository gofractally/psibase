# Snapshots

After a block becomes irreversible, the block producers may sign a checksum of the state. This state that is signed will be preserved. On-chain services control when the state is signed. The `transact` service provides the action `transact::setSnapTime` to set the interval between snapshots. When a state is signed all nodes in the network will verify that their state matches.

The command [`psibase create-snapshot <DATABASE> <FILE>`](../../run-infrastructure/cli/psibase-create-snapshot.md) will write the most recent signed snapshot to a file. It can be loaded into another node with the command [`psibase load-snapshot <DATABASE> <FILE>`](../../run-infrastructure/cli/psibase-load-snapshot.md).

A snapshot file contains:
- The complete contents of the `service` and `native` databases.
- A subset of block headers sufficient to validate all changes to producers. If this does not start at genesis, the snapshot can only be loaded on a node that already has the block at which it starts.
- Signatures by the block producers. The snapshot cannot be loaded if it does not have enough signatures.
- (optional) Additional signatures.
- (optional, not implemented) The block and event logs. Both may be truncated. If they are not complete, queries for historical data may fail.

## Security notes

- For an incorrect snapshot to be loaded, at least one quorum of block producers between the last known state of the node and the snapshot block must violate the protocol. Nodes that are kept up-to-date are not vulnerable to failures by previous producers. However, extra care should be taken when initializing a new node. This applies regardless of whether the node is initialized with a snapshot or by replay from genesis.
- New blocks will not validate unless the set of producers that signed the snapshot is correct. This will detect most failures caused by historical producers, provided the node is able to connect to a good node.
