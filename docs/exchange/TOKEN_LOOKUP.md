# Native token shared-balance lookup and existing-chain migration

This note describes the code inspected in both the exchange checkout and the
original `~/psibase` checkout. It does not change the original dirty checkout,
upgrade a running chain, or claim to provide a completed migration.

## Why a native balance lookup was scanning users

`SharedBalanceTable` stores its primary record under an allocated
`shared_bal_id`. The caller usually knows `(creditor, debitor, token_id)`, not
that allocated ID. Upstream had no index for that tuple.

The original checkout's `packages/user/Tokens/service/src/tables.rs:441`
therefore does this:

1. Range-read every `UserPendingTable` row for `(creditor, token_id)` and collect
   all its shared-balance IDs into a vector.
2. Fetch the corresponding `SharedBalanceTable` primary records until finding
   the one with the required creditor, debitor and token.

`UserPendingTable` contains relationships in **both directions**: a user appears
there as a creditor or as a debitor. Thus P is all pending relationships
involving that account and token, not just its outgoing recipients. Retained
zero-quantity balances can also keep old relationships in this set. Because
the vector is collected first, even an early matching primary record does not
avoid scanning all P pending rows. A late match or miss also fetches up to P
shared-balance records. This is O(P) record visits and O(P) temporary memory,
in addition to the database's ordinary seek costs.

This becomes particularly expensive when the creditor is a service which has
credited many users. An exchange can aggregate its matching work by price yet
still pay this cost when the native token service settles an output credit.
The issue is the chosen index, not whether the database is native or in memory.

## The implemented fix in this checkout

`packages/user/Tokens/service/src/tables.rs:475` adds a native unique secondary
key:

```
(creditor, debitor, token_id) -> existing primary-key reference
```

`SharedBalance::get` at line 504 now uses that index directly. At the logical
record level a successful lookup needs one secondary entry and one primary
record; a miss needs only the secondary lookup. Its record count does not grow
with P. This is not a claim that a native tree/trie lookup has literally
constant CPU time at every database size.

The pending-user table remains useful for wallet listings and is retained.
The balance record's ID and serialized fields remain unchanged. Storage adds
one index key/value per shared balance rather than another copy of the whole
balance. Its tuple payload is two account-number keys and one token ID; native
key prefixes, the primary-key reference, and database node overhead add to
that size. Writes and deletes must also maintain this index. Current native
`Table::put` rewrites its secondary entries even when the tuple is unchanged,
so the added write cost should be included in CPU/storage benchmarks.

Changing the primary key to the tuple could avoid the indirection in a new
design, but existing pending records and APIs refer to allocated balance IDs.
The extra index is the smaller compatible change, preserving those IDs and
their references rather than redesigning the token ledger.

There is also a separate small fix at line 514: use
`unwrap_or_else(|| Self::new(...))` rather than eager
`unwrap_or(Self::new(...))`. Constructing a discarded `SharedBalance::new`
used to allocate an ID even when an existing balance had already been found.
The lazy fix changes no stored balance layout and needs no index backfill.

The original checkout still has the scan at lines 441–462 and the eager
constructor at line 473. Its native `Table::put` has the same relevant index
maintenance behavior as this checkout. A small targeted backport is possible;
copying the entire current token service into that older/custom branch would
also bring unrelated ABI and token-policy changes and is not recommended.

## Why the fresh-demo patch cannot be installed blindly on an existing chain

Adding a secondary-key method does **not** automatically visit previously
stored primary rows. An index-only reader would treat an unindexed old balance
as missing. A subsequent credit could then allocate another row for the same
tuple, stranding or duplicating accounting references to the old balance.

The exchange demo was booted with the indexed token service before its balances
were created. Existing chains need an explicit upgrade sequence. Applications
which read the new index directly, including this exchange's RPC, must not be
deployed against an incompletely indexed token database.

### Relevant native table semantics

The implementation is in `rust/psibase/src/table.rs`:

* Lines 90–94 call secondary-key maintenance before writing the primary record.
* Lines 126–138 select insert or replacement based on the existing primary row.
* Lines 158–180 recompute old and new keys, remove old secondary keys, and write
  **all** new keys. Therefore re-putting an unchanged old record can populate a
  newly added secondary index without changing its ID or balance.
* However, lines 169–176 check uniqueness only for *changed* computed keys.
  Under the new schema the decoded old record computes the same new tuple key
  as the replacement. A re-put alone therefore does **not** prove that another
  primary row is not already indexed under that tuple. A migration must check
  the index explicitly and reject a mapping to a different primary ID.
  That check should inspect the raw secondary-key value, not just a resolved
  `TableIndex::get`: the latter follows the stored primary-key reference and
  can return `None` for a dangling reference as well as for an absent key
  (`table.rs:328`). A corrupt or conflicting raw mapping must not be mistaken
  for free space and silently overwritten.
* Deletion removes computed secondary keys as well as the primary record.
  Downgrading to an old binary which does not know the new index would stop
  maintaining those keys and could leave dangling entries. A binary downgrade
  is not automatically a safe migration rollback.

### Recommended staged online migration

1. **Preflight and checkpoint.** Take a recoverable chain checkpoint and audit
   primary records for unique tuples, valid token/account identities, correct
   pending references, and unchanged token custody totals. Duplicate tuples
   must be investigated explicitly; never silently pick, merge, or discard one.

2. **Deploy a compatible transition service.** Add the secondary key and lazy
   initializer, but keep a fallback to the old pending-table lookup when an
   indexed tuple is absent. All insert/update/delete paths use the new table
   definition, so new rows and subsequently modified old rows maintain the
   index. Preserve primary IDs and pending references. Validate that an index
   hit actually identifies the requested tuple and primary row.

   Retaining the fallback prevents both false zero balances and duplicate new
   rows while backfill runs. It also avoids a global token-service pause which
   might interfere with the chain's own token-denominated resource billing.
   Existing direct-index clients must remain disabled until completion, or
   implement the same compatible read behavior.

3. **Backfill bounded primary-ID batches.** An authorized migration action
   advances a persistent cursor through existing shared-balance primary rows.
   Before each unchanged re-put, verify that the tuple index is absent or
   points to that exact row ID. Write the row through the new `Table::put`, and
   verify the tuple resolves back to it. Commit the cursor with the batch in
   the same transaction. Abort on collisions rather than overwriting them.

   IDs are monotonically allocated and not reused. New rows created behind a
   completed scan cannot appear: all future allocations are higher IDs and
   are indexed by the transition code. Deletions and balance changes between
   batches are safe because the new writer maintains the same identity key.
   The ID counter can contain holes from prior eager getters, so completion
   must be based on primary-row traversal, not on assuming every ID exists.

4. **Verify the bijection and cash.** Every live primary row must resolve from
   its tuple to the same ID, every secondary entry must identify an existing
   matching primary record, and pending references and asset totals must be
   preserved. Verification itself can use bounded cursors. Normal mutations
   during this phase must preserve the new index invariant. Mark the schema
   ready only after verified coverage, in an atomic transaction.

5. **Activate indexed consumers and remove the fallback.** Index-only lookup
   and direct-index query services become safe once readiness is established.
   Keep the migration/version status inspectable. A failure before completion
   should leave the compatible transition code in place; do not reinstall a
   writer which silently stops maintaining the secondary index.

This sequence is a design recommendation, not implemented migration code in
this checkout. It needs actual upgrade tests in an isolated chain before use
on a chain holding existing balances. A small chain could alternatively use
an explicitly coordinated maintenance window and one atomic backfill, but its
runtime, CPU limit and resource-billing behavior must be established first.

## Required migration tests

* Start with the unindexed token implementation and create old shared rows
  in both directions for multiple accounts and tokens, including zero balances
  retained by configuration.
* Upgrade to the transition implementation; old balances must read correctly
  before backfill. A top-up must retain the existing ID rather than allocate a
  duplicate. Test debit, uncredit, rejection, recall and deletion during backfill.
* Interleave bounded batches with new credits and deletion/recreation, repeat
  a batch after rollback, and verify the cursor never skips a live old row.
  Include ID/cursor boundaries without assuming the ID counter has no holes.
* Inject a conflicting index mapping in an isolated test and ensure migration
  rejects without changing either balance. Test dangling/malformed entries too.
* Independently audit primary/secondary/pending relationships and exact token
  quantities before, during and after migration. Force a transaction failure
  halfway through a batch to verify keys, balances and cursor all roll back.
* Confirm direct-index clients are not activated until readiness, and benchmark
  small and large P for native token action costs, including the index's added
  write/storage work.

## Observed validation of the fresh-deployment fix

`packages/user/Tokens/service/src/tests.rs:58` exercises tuple separation,
unchanged IDs on repeated existing-balance lookups and top-ups, native
revocation deleting both primary/secondary entries, unrelated-row preservation,
and recreation with a new ID. The actual-chain run passed **1/1**, with six
unrelated tests filtered out, in `demo/token-index-tests.log`.

This verifies the implemented fresh-deployment index and lazy constructor.
It does not establish the unimplemented existing-chain migration above.
