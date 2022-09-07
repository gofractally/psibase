# Transaction Life Cycle

Every transaction is valid for a very specific window of time after which it
becomes invalid. This window ends with the expiration time on the service
and starts with the TaPoS (Transactions as Proof of Stake) included in the
transaction header.

## TaPoS - Transactions as Proof of Stake

Every transaction must reference a block within the past 2^16 blocks (about 18 hours). It does
that by including the lowest 16 bits of the block number and 32 bits of the block hash of that
block. The transaction will be considered invalid for any blockchain that doesn't include the
referenced block.  All told, this prevents attackers from forking a chain in secret and 
migrating most of the transactions from the legitimate chain to a forked chain. This hash is
"proof" the the transactor has some stake in building on a particular state.

TaPoS data will be available via a special KV_MAP which can only be read by the transact service. This
will allow it to utilize a circular buffer optimization rather than using 65k database rows.

## Transaction Sequence Numbers

Every transaction includes numbers that allow the sender of the first action (aka the first sender)
to prevent the transaction from being replayed. 

```c++
struct SequenceData {
   uint8_t  thread;
   uint32_t prev_seq;
   uint32_t next_seq;
};

```

The most important field is the `next_seq` which must be greater than the most recent
`next_seq` of the last included transaction. This is what prevents this transaction from
being replayed. 

`prev_seq`, if not 0, can be used to make this transaction invalid until a certain sequence
number is achieved. This way, a user can sign 2 transactions  (A and B) which have `next_seq` 1
and 2 and know that B will not be applied before A which would invalidate A.  Transaction B would
set 'prev_seq' to 1.  

`thread` is used to allow a user to have multiple sequences operating in parallel which do not
invalidate eachother.  Each user can have up to 8 threads.

`next_seq` must be less than the head block time. This restriction prevents users from using up
all of the available sequence numbers in any of their threads.

`next_seq` must be greater than `prev_seq`.

This SequenceData can be stored on a record that is already being fetched and/or modified for
resource billing and/or permission purposes so will have much better performance than inserting and
deleting records for each transaction hash.

## Canceling all Pending Transactions

If you would like to attempt to cancel a transaction that hasn't expired and hasn't been included then
you can broadcast a transaction with a single action `transact_sys::cancelPending()` which will update
the sequence number on all threads to the current block time: instantly invalidating anything not already
included in the chain.

## Comparison to EOSIO

EOSIO would track the transaction hashes of all transactions that have not expired and would prevent
duplicates. This prevented replays but also prevented users from being able to cancel a pending transaction
before expiration.

## Checking to see if a transaction was included

The principle of Psibase is that "transactions" or "groups of actions" are not something that should
be user-facing. Unlike Bitcoin, where every transaction is a "transfer", a token "transfer" could be
initiated either directly or indirectly by other services and users. Therefore, the event log is what
you need to provide as evidence of transfer, not the input transcation that caused it. For example,
an exchange would be foolish to assume that all transfers are represented in transactions which
are logged in the blockchain. Proof of transfer would be provided by giving someone a link to a query
which returns the transfer event. 




