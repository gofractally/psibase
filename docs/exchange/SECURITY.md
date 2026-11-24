# Exchange security and invariant review

This review separates native-token guarantees from the exchange's matching and
credit guarantees. Its source baseline is Psibase `db601e572` (upstream main).
Implementation-specific review findings are recorded below as the service is
integrated. This document is not an independent audit of the Psibase runtime.

## Native token custody

`packages/user/Tokens/service/src/lib.rs` and `tables.rs` implement three
distinct forms of native balance:

* A primary balance belongs to an account and is spendable by that account.
* A subaccount is accounting separation under its owner's account. Its owner
  can call `fromSub`; naming a subaccount after an exchange does not lock it.
* A shared balance records creditor, debitor, token and quantity. With
  `AUTO_DEBIT` disabled it remains pending. The creditor can `uncredit`, the
  debitor can `debit` or `reject`. Either side can change it without calling
  the exchange.

Consequently, a user-to-exchange shared row is suitable for **free, revocable
exchange funding**, but cannot safely back an outstanding order, loan
collateral, committed relay liquidity, or a lending receivable. A cached
deposit ledger is insufficient: a direct native `uncredit` would otherwise
leave an unfunded exchange IOU.

The exchange derives free funding from actual native shared balances and
debits a commitment atomically before recording it. Uncommitted funding can
remain in separate creditor rows rather than all becoming the exchange's
primary balance. Every market's committed escrow is physically isolated in
native token subaccount `market-<id>` under the exchange's service authority.
No committed cash remains in the exchange's unscoped primary balance. The
exchange still controls those committed tokens. Calling this a noncustodial lock without explaining that authority
would be misleading.

Incoming credits require exchange auto-debit to remain disabled. If an
exchange action can enable auto-debit, arbitrary unsolicited credits could
change custody accounting or cause the free shared balance to vanish into
the service's primary balance. Configuration changes therefore require
service authority and a defined migration, rather than user authority.

Settlement output can be a native shared credit to the recipient. The
recipient's auto-debit configuration determines whether it remains shared or
becomes primary cash. Exchange accounting must not assume either outcome,
and cannot keep a second spendable IOU for the same credited tokens.

### Token issuer powers

Native token `recall` and `recallShared` can destroy backing in primary,
subaccount, and shared balances. `UNRECALLABLE=true` is irreversible, but
`UNTRANSFERABLE` can still be toggled by the token administrator. A future
freeze can prevent a native outgoing credit even if recall is disabled.

Guaranteed-margin admission needs immutable transferable backing at market
creation; eligibility is sticky and cannot be enabled later for an old book:

1. The token exists, is transferable and unrecallable.
2. Its administration NFT has been irreversibly burned, or an equally strong
   immutable native policy prevents later recall/freeze changes.
3. Token settings and the absence of the administration NFT are verified from
   native services, not supplied as caller assertions.

Each market/token has an `EscrowTable` expected-cash record. A withdrawal
compares that token with its native subaccount. A deposit compares both of
the book's tokens, so recalling one asset also pauses new commitments of the
other. Later deposits cannot refinance the missing backing. A solvent token
can still be withdrawn: an unfilled order cancels, a one-token claim settles,
and a spot LP can redeem only the solvent reserve. The missing reserve stays
paused. Swaps, loans, and new orders stay paused until both tokens match. A
partly filled order cancels only when both its refund and its proceeds token
match, because those claims share one share balance. Sealing that token later
does not make the old book margin-eligible. A newly funded immutable book uses
a different native subaccount, so an old phantom withdrawal cannot draw from
the new book's relay, lending cash or collateral. This isolation is required
even when two books trade identical token IDs.

NFT burn is viable for the demo: mint the intended supply, map the desired
symbol, then burn the token administrator NFT. `Nft` records burned IDs and
does not allow those NFTs to be minted again. Burning before symbol mapping
would prevent the mapping because the symbol service requires token-admin
NFT ownership. A token with a currently living administrator cannot satisfy
the perpetual no-freeze guarantee merely because its administrator promises
not to use its powers.

These checks protect repayment quantities in native tokens. They cannot
promise an external USD value, a BTC redemption peg, or immutability against
an authorized upgrade of the blockchain's token or exchange service.

### Native lookup costs

At the unmodified upstream revision, `SharedBalance::get` enumerates `UserPendingTable`
IDs for a creditor/token before locating the matching debitor. It has no
direct creditor/debitor/token index. Exchange-to-user settlement credits can
therefore inherit work proportional to the service's pending recipients,
even when the matcher itself touches one aggregate row per price.

Upstream `get_or_new` also uses eager `unwrap_or(Self::new(...))`, allocating an ID
even when a shared row already exists. `getSharedBal` is consequently not a
pure query. A read-only HTTP service should read native tables rather than
invoke that mutating action. This branch adds a native
`by_creditor_debitor_token` secondary key and lazy creation, removing that
scan and allocation for existing balances. Its index getter is
`SharedBalanceTable::get_index_by_creditor_debitor_token()`.
An actual-chain regression fixture checks tuple separation, deletion and
recreation, unrelated rows, and stable IDs on existing lookups and top-ups.

**The new native index is for the fresh demo deployment. Do not deploy this
Tokens upgrade to an existing chain without a separately implemented and
validated index migration.** Old primary records would not automatically
have secondary records. A migration must preserve IDs, quantities, creditor
and debitor identities, pending references and total supply, while rejecting
duplicate tuple rows. This change does not claim to provide that migration.
The legacy `getSharedBal` action still constructs a temporary balance when a
tuple does not exist; read-only exchange RPCs should use the direct index.

## Reserved symbols and market identity

`packages/user/Symbol/service/src/lib.rs` binds a symbol to a token through
NFT ownership. Mapping requires ownership of the token-admin NFT and the
symbol NFT, then burns the symbol NFT and creates the mapping. A market must
resolve symbols through `getMapBySym`/`getByToken`; a caller-provided text
ticker or matching token description is not identity.

`symbol.admin_create` is service-authorized. A local bootstrap may use that
authority to reserve `btc` and `usd`, but an ordinary exchange user cannot
take an existing reservation. On a deployed network its legitimate symbol
owner must authorize the mapping. The `ReservedNames` package protects
account names and confusable spellings; it is distinct from token-symbol
ownership and does not itself prove that a token is BTC or USD.

Permissionless market creation accepts verified native token IDs or verified
symbol mappings, rejects identical assets, and derives display symbols
from native mappings. Multiple independent books may use the same pair: an
initial funder cannot capture that pair permanently with an unusable lot grid.
Each book has its own committed relay and credit schedule. Seed amounts must be actual committed balances before
the market becomes live. No creator receives authority to mint either asset,
seize user balances, alter other users' orders, or withdraw someone else's
relay shares.

## Required accounting invariant

For each market/token, actual committed native escrow must equal the sum of:

```
relay reserves
+ unfilled maker outgoing escrow
+ funded maker proceeds escrow
+ lending-vault free cash
+ pledged active-loan collateral
+ liquidated-loan surplus escrow
+ armed stop input
+ closed stop-batch remaining input refunds
+ closed stop-batch remaining output proceeds.
```

Free user-to-exchange shared balances are outside this committed sum. Loan
face receivables, LP shares, maker shares, and the displayed market value of
collateral are not additional physical tokens. Counting any of them as
physical custody would duplicate the backing.

Include retired maker generations and batches with zero remaining shares.
Their funded cash can remain claimable or retained as nonwithdrawable rounding
dust. Dust is already contained in maker cash, loan surplus or batch remaining
fields; do not add scaled dust metadata as a second physical balance. Closed
stop-pool input is zero: ownership references to its batch are not new cash.

Claims consume escrow at the same time as they credit a recipient. Maker
share entry debt must prevent late deposits from collecting old proceeds.
Cancellation refunds and claims round toward the pool, with retained fractions
and final dust assigned explicitly. One wallet's last claim must not receive
another wallet's accrued proceeds. Old generation references cannot redeem
shares from a new generation at the same price.

## Required margin invariant

Displayed spot value and separately evaluated borrowers do not prove joint
solvency. If multiple loans share a relay, its depth can be consumed only
once. Ordinary orders may disappear and therefore are not guaranteed backing.

For a protected-product relay with physical oriented reserves `u,v` and
`u*v >= K`, swapping collateral `C` gives at least

```
floor(K*C / (u*(u+C)))
```

repayment atoms. Keep the protected `K` fixed between certified liquidity
changes, respecting the relay's integer rounding policy.

For the ordered price cohorts in one direction, compute:

```
a[1] = max(current_input_reserve, trigger[1])
a[j] = max(trigger[j], a[j-1] + collateral[j-1])
debt[j] <= floor(K*collateral[j] / (a[j]*(a[j]+collateral[j])))
```

The same certificate applies to the other direction after swapping the
reserve roles. A complete head liquidation starts no later than its planned
`a[1]`, so its actual output covers its debt. Its post-liquidation input
reserve is no greater than the previously planned end; later guarantees
therefore do not decrease. The opposite direction's input reserve decreases,
which improves its guarantee. This establishes the induction for a cascade.

Ordinary relay trading must stop at the next due trigger. Otherwise one large
trade could pass the repayment boundary before collateral is sold. A bounded
event budget may leave a safe pending liquidation; it must not allow another
ordinary relay leg to skip that pending event.

Loan origination, additional borrowing, collateral release and relay LP
withdrawal must preserve this whole-schedule certificate. Relay capital
already promised to loans cannot have an unconditional withdrawal right.
Lender redemptions are limited to actual vault cash, rather than face-value
receivables. Debt must be fixed/capped including fees, or a separately proved
interest cap must be reserved in advance. Time alone cannot create debt that
was never certified.

A liquidation closes an entire homogeneous price cohort before another
cohort is processed. Repay lenders immediately from actual output. The
remaining surplus stays escrowed and is claimed proportionally later. This
permits zero borrower-position accesses during liquidation. Partly closing
arbitrary individual borrowers ahead of the certified schedule needs a new
post-state certificate; pooled bookkeeping alone does not justify it.

## Implemented atomic stop-auction boundary

The current [stop engine](../../packages/user/Exchange/service/src/stops.rs)
loads at most 64 armed stop generations, 128 ordinary price levels and 64
credit cohorts per market, shared across both directions. Oversized legacy
books are refused first-stop admission using a bounded cap-plus-one lookup;
all new price writers preserve the stop-enabled book cap. Each new owner stop
position needs one execution lot; small coalesced top-ups are permitted and
cancellation removes the whole owner position. These are resource/admission
rules, not a claim that capacity cannot be economically occupied.

Discovery simulates an actual causal path, latching crossings in either
direction, then optionally tries one same-direction margin-first replay. The
replay needs a nonzero seed, a same-direction selected margin prefix, no
opposite activated stop, no new prospective margin, no reduced seed execution,
and unchanged limit/minimum-output protection. Mixed maturity flows and
infeasible replays use the original causal plan; there is no repeated fixed
point search or persistent frozen market. Current-due `process` has no seed and
cannot manufacture a future trigger.

For a selected early prefix, its starting reserve is no greater than the
previously certified start. The conservative recovery bound therefore still
covers every lender face. Keep actual margin recoveries and borrower surplus
separate from ordinary stop output. A uniform stop price is not authorization
to share away a senior lender's backing. Final state still passes the entire
remaining margin schedule, including after an LP resize.

Stop output and unused input are allocated directly from a common per-direction
batch using immutable original input as denominator. All arithmetic rounds
toward backed pool cash; claims consume the authenticated position and debit
the exact same native payouts. Whole-lot, zero-output, reserve and output limits
end in partial execution/refunds. Intrinsically exhausted maker generations
retire terminally while preserving their funds; permissionless bounded repair
avoids requiring the maker to cooperate. Existing stops whose thresholds move
above `MAX` after LP growth stay armed and cancellable using unclamped stop
barriers, rather than panicking or falsely firing at the reserve cap.

Barriers are computed once, ordered heads advance, and only changed aggregate
rows are committed. No matcher, trigger or liquidation operation enumerates
owners. The deterministic planner work cap is not total native CPU, gas, or the
seed's `max_events` budget; native funding, database work and final certificate
checks add cost. See [CASCADE_AUCTION.md](CASCADE_AUCTION.md) for the progress
argument and [STOP_LOSSES.md](STOP_LOSSES.md) for the exact cash identity and
preservation by each mutation/withdrawal.

## Implementation review checklist and required tests

* Derive the actor from the authenticated action sender. Reject another
  wallet's cancel, withdrawal, repayment position mutation, LP redemption,
  and setup/admin changes even if that wallet name appears in action data.
* Initialize once under service authority. Reinitialization cannot reset
  counters, ownership, native token flags, cash, prices or debt.
* Verify external token/NFT/symbol records. Do not accept forged asset
  settings, fake tickers, mutable admin NFTs, or duplicate pairs under
  reversed naming conventions unless those are intentional separate markets.
* Every commitment, swap, repayment, cancellation and native credit is part
  of one atomic chain action/transaction. Failed slippage, insufficient native
  funds, or a failed certificate must restore all native and exchange tables.
* Use positive quantities, checked addition/subtraction, widened products,
  nonzero denominators, bounded IDs and checked narrowing casts. Native
  quantity is `u64`; `K*C` and `D*a*(a+C)` may require 192 bits even when all
  stored quantities fit `u64`. A plain `u128` implementation requires explicit
  tighter domain limits with a proof of every intermediate bound.
* Cap input lengths, markets returned, matching work, liquidation events,
  claim references and any exceptional whole-price recertification. Never
  enumerate borrowers during matching/liquidation, including rollback code.
* Test direct native `uncredit` after a displayed deposit; a subsequent order
  cannot spend a stale exchange balance. Test alternate recipient auto-debit
  settings for outputs and unsolicited native credits.
* Test margin rejection for recallable tokens, a live token-admin NFT,
  frozen tokens, symbol spoofing, and administration changes after admission.
* Test a thin relay, joint depth exhaustion, multiple same-price borrowers,
  closely spaced cascading prices, both debt directions, partial repayments,
  liquidity removal near the solvency boundary, pending-event checkpoints,
  maturity/interest caps, zero/dust orders and price/amount extremes.
* Independently recompute physical custody, all share supplies and the full
  sequential coverage schedule in tests. The implementation's own cached
  totals are not an independent accounting oracle.
* Use actual chain tests for sender authentication, token integration,
  rollback and service-table behavior. Native arithmetic/property tests
  supplement those tests; they cannot replace them.

## Native implementation review

`packages/user/Exchange/service/src/lib.rs` was reviewed against these flows.
The implementation takes free funding from actual native shared rows, including
previous unclaimed exchange credits; it does not trust a cached deposit total.
Only committed funding moves through the service's native primary balance
into its specific market subaccount; the primary balance is empty at commit.
An expected escrow record tracks actual cash movements independently of the
individual financial liability fields and is checked against native cash.
Native transactions supply rollback across token and exchange table writes.

Creation permanently records whether both assets have irreversible no-recall
and no-freeze administration, and only such books permit lending/borrowing.
Lending and borrowing also recheck the asset properties. Loan face includes a prepaid 1% financing charge;
the common credit epoch is 30 days. The implementation checks the full
sequential certificate over at most 64 active loan PRICE cohorts rather than
implementing the prototype's cached summary tree. This is bounded price-level
work, not borrower iteration or a claim of logarithmic risk updates. Complete
head liquidation does not access `BorrowerTable`; closure immediately repays
the vault and leaves individual borrower rows to claim funded surplus later.

Native storage amounts, shares, aggregate collateral/debt, execution lots and
price-times-quote-tick are capped at `2^40-1`. The relay product is therefore
below `2^80`, and trigger/recovery/coverage products fit below `2^121` in checked
`u128` evaluation. The spot proceeds scale is `2^40`, cumulative indices are
below `2^80`, and share-times-index/entry debt fit below `2^120`. Persisted wide
integers use two native `u64` limbs because Fracpack has no primitive `u128`.
These explicit limits are part of the proof, not merely UI validation.
The native escrow total across multiple price/generation liabilities can
exceed a single component's `2^40-1` cap; it uses checked `u64`, matching the
native token quantity and actual subaccount balance. Audit sums use `u128`.

At an LP resize, this implementation sets the new protected product to the
candidate's physical `X'*Y'`, then re-certifies every active price cohort.
This differs from the prototype's scaled-product rounding rule and avoids a
160-bit `K*new_supply^2` intermediate. Between accepted LP changes the protected
product stays fixed. One genesis relay LP share is permanently assigned to
the reserved null account, preventing an empty relay. No caller can redeem
that share; a real LP may redeem all its own shares only if the remaining
credit schedule still passes. The proof only needs the candidate product, physical
product bound and successful complete certificate, so this policy preserves
the same repayment invariant.

The review found and coordinated fixes for these concrete issues:

* A shared service primary balance would let an issuer recall an old mutable
  spot book's cash, later seal the token, and create a new immutable book whose
  fresh backing could be drained by the old book's phantom withdrawal. Every
  book now has a native subaccount from birth, expected-cash checks, and sticky
  creation-time margin eligibility. The regression deliberately creates that
  historical deficit and proves it cannot affect a new guaranteed book.
* Native shared-balance lookup scanned pending recipients, and eager creation
  consumed IDs on existing-row reads. The tuple index/lazy fix is described
  above and has a dedicated actual-chain regression fixture.
* The first snapshot endpoint exposed another user's wallet/shared balances
  with an unauthenticated owner parameter and wildcard CORS. The shipped
  query entry requires the native HTTP server, its authenticated user, and a
  matching owner; private replies are `no-store`. The snapshot action also
  requires owner equal to the authenticated action sender. `/markets` projects
  only public aggregates, and `/tokens` provides bounded cursor pagination.
* Native `u64` wallet balances can exceed JavaScript's exact integer range.
  Snapshot values above `2^53-1` are decimal strings; the sum of both shared
  directions is evaluated in `u128` before encoding. Tests cover `u64::MAX`
  and a sum larger than `u64::MAX`.
* A marketable limit originally refunded the unspent input before placing its
  passive remainder, which demanded a second shared-balance debit when the
  recipient auto-debited the refund to its primary wallet. The implemented fix
  retains that already-funded remainder within the same action and spends it
  directly on the resting pool. An exactly-funded, auto-debit-on regression
  fixture guards the flow and checks the execution price bound.
* The development wallet originally assumed all native claim outputs remained
  pending. With recipient auto-debit enabled they arrive in the primary wallet.
  It now credits those auto-accepted claims back into revocable shared funding
  before a subsequent trade/order/repayment. For a withdrawal it counts the
  already-delivered primary claim once and returns excess/other-token claims
  to shared funding. These owner-authorized actions execute atomically.

The development adapter binds only to loopback, validates Host to block DNS
rebinding, checks browser Origin and JSON content type, bounds request size,
and limits actor identities and action names. It deliberately uses local
AuthAny test identities rather than a production wallet. Never expose this
adapter or AuthAny accounts as a public exchange deployment. A real deployment
must replace the adapter with authenticated native wallet/plugin signing.
Native sender authorization and all financial checks remain in the on-chain
exchange service; the adapter contains no alternative matching ledger.

The original spot/credit actual-chain fixtures independently recompute native escrow, maker share
and proceeds liabilities, borrower unit supply, LP/lending share supply, and
the sequential two-sided liquidation certificate. They cover native revocation,
actor isolation, failed-action rollback, late joins and rounding, pooled
liquidation, unsafe liquidity withdrawal, long/short cascades, mutable token
administration, output auto-debit settings, private HTTP access, and marketable
limit funding, independently funded same-pair books, and historical issuer
recall isolation. These tests supplement,
rather than replace, the algebra.

Stop-specific native fixtures extend that audit to armed principal, common
batch refunds/output and owner share supplies. The actual-Rust host harness
executes extracted current planner/math source and native claim arithmetic,
including targeted Rust mutations and planner-only region/branch coverage.
These host results do not exercise native authorization, Tokens, KV, ABI or
WASM metering. Reference-model Python tests are another separate evidence
category, not an alternate proof of deployed behavior.

Runner results, expected WASM panic-test skips, package fingerprints and
measured native performance belong in [VERIFICATION.md](VERIFICATION.md).
Earlier spot-only frozen-package results do not establish that a later
stop-capable package passed. `demo/check_live.py` separately
checks live native snapshots for relay products, the full active credit
schedule, debt totals, claim arithmetic and free shared-balance sums without
mutating economic state. It is not a substitute for the actual-chain tests'
full native subaccount escrow audit.

### Native read permissions

Current Psibase `Db.open` deliberately rejects another service's private
prefix, including from a query service. `Table::with_service(tokens)` does
not grant permission merely because a query is read-only. Accordingly, only
`exchange+1` (the RPC service) has the native `isPrivileged` flag. Its fixed
foreign-table helper opens `KvHandle::open_direct` with **Read mode only** for
the specific token/symbol tables needed by these endpoints. All private HTTP
requests still require the native HTTP server and its authenticated owner;
forged direct `serveSys` calls are rejected before any database access.
No generic database path, caller-supplied table number, arbitrary action, or
write operation is exposed by this RPC code.

The wallet's automatic claim prefix skips externally underfunded or unsupported
legacy books. Their owed proceeds are not counted as available cash. One
issuer-damaged spot book therefore cannot make every unrelated healthy-market
trade or native free-balance withdrawal fail merely because the wallet tried
to settle all positions first. The native shared funding remains independently
withdrawable; a regression test covers this separation.

The financial `exchange` service is not privileged. Its owner-authorized
`snapshot` action reads only its own financial tables and intentionally returns
no native wallet balances or token catalog. The local wallet obtains the full
state through authenticated native HTTP; it retries authentication once rather
than silently substituting this incomplete financial-only snapshot.

Native `isPrivileged` is broader than a read-only prefix grant: the read-only
restriction here is enforced by the reviewed code's handles and by the runtime
RPC context, not a narrower flag with that name. The RPC's code and upgrade
authority are therefore trusted. A production alternative can compose the
authorized native token plugin's reads in the client, or introduce narrowly
scoped native read grants, rather than granting this broad flag. No collateral
guarantee is asserted against malicious privileged code upgrades.

## Native UI hosting and public execution history

The UI is stored by native Sites under the exchange account. Unknown static
paths fall through the read-only query handler to HttpServer's normal Sites
fallback. The temporary wallet adapter remains loopback-only. Its browser
allowlist now includes exactly `http://exchange.psibase.localhost:8089`, with
explicit JSON preflight and origin-specific CORS; other account subdomains
receive no access. Host checks, request bounds, action allowlists and native
owner authorization remain in force. The local content-policy exception for
`http://127.0.0.1:8090` is applied by the demo publishing script, not the
production package metadata. These AuthAny demo identities remain unsuitable
for public deployment.

Public trades contain actual native execution events, including `stoptraded`
for executed stop input/output, excluding refunds and claims. No second mutable
trade ledger is required. The query opens read-only handles to
the pinned native Events ready-index metadata and market/event-ID index,
selects at most `limit+1` IDs for each of `traded`, `liquidated` and `stoptraded`, and fetches only
those exact history ROWIDs. The maximum page is 100. This prevents a limited
output query from secretly sorting an unbounded history. An incomplete native
index produces an unavailable response rather than an inaccurate empty tape.
Changes to native Events table layouts require review of these explicit
read-only handles and their integration tests.

The background liquidity fixture spends only its dedicated accounts' funded
native tokens. WebSocket prices select trades; they do not set reserves,
overwrite balances, or enter the browser. Native limits, execution bounds,
collateral checks and escrow accounting still decide whether each transaction
succeeds. The large demo correction from $100,000 to the live ~$57,000 range
was a funded marketable limit and cancellation, including normal liquidation
of the earlier $80,000 loan cohort. Subsequent live checks found covered debt
and matching actual/expected token escrow.

The owner projection now also handles shared credit cohorts: it computes the
requesting borrower's own units and exact floor-rounded surplus, instead of
returning the shared cohort's total units or surplus. The native integration
fixture uses two owners in the same cohort to distinguish those cases. Public
market reserves, vault totals and debt totals remain aggregate health data;
individual maker, borrower, lender and liquidity-provider positions are scoped
to the authenticated owner. Live unauthenticated and cross-owner snapshot
requests returned 403, including the account-query alias.

This is service-API privacy, not confidential consensus state. The existing
public `traded` event contains an actor, and blockchain transactions identify
their senders. Native administrative SQL can inspect that history. On this
local demo, XAdmin treats the direct loopback socket as administrative, so an
unauthenticated local SQL request can read public event actors. Remote SQL
administration is separately authenticated in the native implementation.
Likewise, the development wallet intentionally controls all four AuthAny demo
accounts; its account selector is not proof of separate user authentication.
Do not describe any of these local operator facilities as protecting balances
from the machine's operator or as cryptographic on-chain privacy.
