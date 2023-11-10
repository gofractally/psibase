# Transactions as Proof of Stake

# Goals

* Protect the blockchain against long-range reorganization attacks
* Provide confidence for a community that a chain cannot be independently reorganized by the infrastructure providers
* Allow for [offline transaction signing](#offline-signing)

# Design overview

Every transaction submitted to a psibase network must include a small amount of data from a recent block ID. Any reorganization would imply a change to the block IDs, and therefore would invalidate all transactions whose TaPoS references are no longer valid. This therefore allows users to distinguish between legitimate and illegitimate blockchain forks.

The data that must be submitted with the transaction is:
* One byte to specify a reference block
* A checksum equal to the block ID of the reference block

However, the additional data that TaPos requires to be stored with the transaction is only the reference block. Therefore TaPoS only adds the cost of a single byte per transaction.

# Offline signing

Historical implementations of TaPoS have required a recent reference block, resulting in the additional requirement that signing a transaction needed an up-to-date view of the blockchain. This specification updates TaPoS such that it enables signing transactions with a view of the blockchain that is up to 6 days old.

# Details

## The reference block

TaPoS can reference any of the past 127 blocks or 1 out of every 4096 blocks in the past 6 days.

If the TaPoS reference is `R`, where `R <= 127`, and the current block height is `H`, then the referenced block number would be \\( H - R \\).
 
If `R > 127`, then the referenced block number would be:
 
\\[ \left( \left( \frac{H}{4096} \right) - \left( R - 127 \right) \right) \times 4096 \\]

If 1 block is produced per second, then in 6 days the total number of blocks would be 518,400. If only 1 out of every 4096 blocks can be referenced, then that's 126 possible reference blocks. Since there are 253 total possible reference blocks, the reference field requires only one byte.

This design enables more flexibility for offline signing while still allowing easy reference to any of the recent blocks.

## The checksum

The intention of the checksum is to ensure that if a fork block is proposed, any transactions that used a TaPoS reference to the block at that height (or subsequent blocks) will no longer be valid.

To accomplish this, the reference block ID is included as part of the transaction data in the TaPoS field during signing. Because the block ID is used during signing, it can be pruned before storing the transaction. Anyone verifying transactions can derive the block ID of the reference block from the chain state, and therefore transactions applied that reference a fork block will fail signature verification.

Using the entire block ID as the checksum for signing prevents any possiblity of brute forcing the construction of blocks which modify transactions but change their contents. Therefore, even if an attacker managed to control over $ \frac{2}{3} $ of the block producer set, creating a fork block to double-spend would result in dropping all transactions that reference the block(s) they are rewriting. This design ensures there is no economic interest in such a hypothetical fork, and therefore long-range attacks of this nature are virtually impossible.

# Conclusion

The cost of TaPoS is small (1 byte per transaction) and it provides everyone involved a meaningful degree of protection against even the most centralized set of block producers. With psibase TaPoS, even a single node could be responsible for producing blocks and would still be unable to double spend as long as there is decentralized block validation. For communities running their own infrastructure, TaPoS allows you to provide a cryptographic commitment to the past without relying on the security of an external public blockchain and without giving up control over the future.
