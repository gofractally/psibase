# Native wallet integration review

Reviewed 2026-11-21 against local `codex/exchange` source. This is an internal
review, not an independent financial or platform audit. Matching and credit
accounting policies were not changed. Current-candle analytics are documented
separately in [CANDLES.md](CANDLES.md).

## Client authority and funding

The Exchange component has no arbitrary service, sender, packed action, HTTP
path or GraphQL entry point. Its financial entry points require `expectedOwner`;
Host's current user and the authenticated snapshot owner must both match. The
parameter is a guard, not an account selector. Tokens independently checks the
same expected user before every transfer, and Transact pins its initial account
through action construction and publication.

All native funding moves cross the Tokens-owned exact-transfer interface. Its
optional remembered permission covers only the selected wallet and Exchange as
counterparty. It does not grant token issuance/admin authority, AUTO_DEBIT or an
on-chain spending allowance. Transfer history is native, owner-authenticated and
bounded, with an exact counterparty filter after the native substring search.

Client preparation selects at most 32 exact own receipts and 64 native actions.
Native claims, required AUTO_DEBIT recredits and a sufficiently funded final
operation are one atomic transaction. Up to two confirmed component calls per
explicit UI submission can realize 64 receipts; unknown outcomes are not
retried. A five-minute owner/application/request-scoped plan pins exact amounts
across prompts. Native Transact seals it nontransactionally after proofs and
immediately before broadcast, so rejected or unknown submission outcomes cannot
revive stale plans; a transactional nonce also records confirmed success. The
publication hook checks its authenticated Transact caller, current user, active
app and actual signed senders. A ready withdrawal can contain only Tokens
debit/uncredit actions; ordinary execution and preparation-only calls still
require Exchange actions. The pinned request binds the withdrawal token/amount,
and Tokens separately enforces exact transfer scope. Remaining AUTO_DEBIT
proceeds go to the primary wallet, where the assets view displays them.

Eighteen host planner tests cover integer/schema compatibility, amount bounds,
exact native funding formulas, owner guards, action allowlists, receipt privacy,
funded-market eligibility, bounded progress, AUTO_DEBIT recredit caps and pending
plan expiry/consumption and prepublication sealing against rejected/unknown
submissions. Browser authorization/signing tests and native financial
WASM tests remain separate evidence.

## Live authority and production security

Read-only native GraphQL queries at 2026-11-21 10:03 UTC are recorded in
[`native-authority-review.json`](native-authority-review.json). The actual
service chain is:

| Account | Native authentication | Delegated owner |
|---|---|---|
| `exchange`, `tokens`, `exchange+1`, `sites` | `auth-delg` | `root` |
| `root` | `auth-delg` | `producers+3` |
| `producers+3` | `producers` | active producer quorum |
| `psibase`, `alice`, `bob`, `liquidity` | `auth-any` | none |

The only active producer is `psibase`. Its consensus authorization claim is
empty (`service=""`, `rawData=""`). `AuthDelegate.cpp:13-21` follows owners to
their auth service; `Producers.cpp:34-37,244-260` treats that empty producer claim
as satisfied, with the single-producer strong threshold equal to one. Thus the
demo's administrative authority is effectively unsigned even though the service
accounts themselves correctly report `auth-delg`. Saying that Exchange or Tokens
*directly* uses AuthAny would be incorrect. Securing only a test trader with
AuthSig does not secure this administrative root or consensus.

`SetCode.cpp:82-92` allows an authenticated service account to replace its own
code. Its owner therefore controls service upgrades, and the native Tokens
subaccounts containing committed market funds belong to Exchange. Free funding
remains in revocable shared rows, but the Exchange debitor can accept that
funding. Per-market subaccounts isolate accounting; they do not remove trust in
service authority or an authorized malicious upgrade. The privileged read-only
`exchange+1` RPC also relies on reviewed code and trusted upgrade authority:
`isPrivileged` is broader than a narrowly scoped read permission.

For public deployment, require real signed producer claims and secure user
account auth, independently controlled service/governance keys, an explicit
upgrade policy and audited recovery procedures. Test an unauthorized upgrade,
service-account transfer and cross-wallet transaction against that secured
configuration. No authority configuration was changed during this review.

Authenticated owner APIs provide access control, not cryptographic blockchain
confidentiality. The native public `traded` event includes its owner
(`service/src/lib.rs:1366-1367`), and transaction actions reveal their senders and
arguments to validators and chain-history observers. Private API projections
must remain owner-only, while privacy claims must acknowledge that underlying
visibility. AuthAny demo identities also cannot establish production-level
identity privacy merely by rejecting an `owner` query argument.

The remembered Tokens transfer grant is client-side, revocable and restricted
to the wallet and Exchange counterparty; it covers all native tokens and has no
per-transfer amount ceiling. It is consequently a meaningful trust decision:
a compromised trusted Exchange frontend could ask the user's auth plugin to
fund Exchange without another Tokens confirmation. It is narrower than generic
Tokens admin authority, but not a token- or amount-limited allowance. Future
spending limits, grant expiry and an account-wide grant inventory would reduce
this exposure.

## Financial review findings requiring follow-up

### Unarmed routing differs from stop-aware routing

`service/src/lib.rs:434-446` only sets the ordinary book's barrier when the
remaining taker input can fill a whole lot. If an already reached best price has
less than one input lot remaining, the unarmed route proceeds into the relay.
The stop-aware route in `service/src/stops.rs:310-324` instead stops and refunds
that input, preserving the documented whole-lot price priority.

A deterministic arithmetic example is `x=10,000`, `y=1,000,000`, `K=10^10`,
`base_lot=100`, `quote_tick=100`, with a resting bid at price 100 and 10,000 quote
atoms. Selling 99 base atoms through the unarmed path consumes them, receives
9,802 quote atoms and moves `x` to 10,099 while the superior bid remains. The
existing stop-aware `strict_book_lots_refund_and_do_not_skip_price_priority`
fixture for those parameters uses zero and preserves the original reserves.
The actual-chain `review_reproduction_unrelated_stop_changes_sublot_routing`
fixture now confirms both outcomes on forks of the same funded book. The added
stop is at price 50 and never triggers; its presence selects the other route.

`service/src/lib.rs:463-488` also accepts a relay step with zero output, unlike
`service/src/stops.rs:410-412`. A legal tiny relay `x=y=2`, `K=4`, lot=tick=1,
receives a one-atom sell with `min_output=0`: the unarmed path consumes one atom
and returns zero (`ceil(4/3)=2`). This is an input donation, not a conservation
failure or unauthorized theft. Both behaviors should be unified before
production. The actual-chain `review_reproduction_unarmed_zero_output_consumes_input`
fixture confirms the one-atom escrow increase and zero payout. Both routing
reproductions pass the independent physical escrow/share audit; they demonstrate
execution defects without alleging a quantity-solvency failure.

### Global snapshots silently truncate markets and orders

`service/src/snapshot.rs:262-267` selects the first 100 markets and first 1,000
book rows globally, without a continuation cursor. Permissionless creation of
small books can occupy those slots. A funded 101st market remains valid on chain
but is absent from both public and private snapshots; the current component
cannot derive its funded action inputs and reports an unknown market. A large
early book can hide later markets' depth even when those markets are visible.

Owner maker, borrower, lender and LP rows also truncate at 1,000
(`snapshot.rs:268-307`), unlike the paged stop receipts. Those positions and
claims remain owned and native direct actions can recover them, but the regular
UI cannot discover all of them. Production needs bounded per-market point/book
queries, paged market discovery/search and paged owner positions. Raising a
single global cap would increase every user's polling cost and retain the same
failure mode.

The actual-chain `review_reproduction_funded_101st_market_missing_from_snapshot`
fixture creates 101 funded books, verifies native escrow on the last one, and
confirms that both public and owner-authorized snapshots contain only 100 and
omit that last book. All three review reproductions passed together; fixture
startup/funding and full audits took 176.96 seconds total. That total is not a
per-transaction CPU measurement. See `demo/review-native-tests.json`.

### Admission capacity can be occupied economically

The bounds are valuable CPU defenses, not admission-fairness policies. A wallet
can reserve all 64 armed trigger prices with one execution lot at each valid
price (`service/src/lib.rs:1155-1169`); while stops are armed, 128 active ordinary
prices also exhaust new-price admission (`service/src/stops.rs:53-58`). Another
user cannot evict those orders. Trading and cancellation remain live, so this is
new-order admission denial, not an unbounded matching loop. Storage charges,
minimum economic commitments, expiry or another explicit capacity policy need
adversarial calibration. Historic generation/batch records also need a retention
or resource-payment policy.

## Solvency limits and remaining production work

No new violation of the native quantity-solvency certificate was found in this
focused review. `lib.rs:166-207` considers the entire price-ordered liquidation
schedule for both sides, using only committed relay depth. Cancellable public
orders are not needed as guaranteed backing. Liquidity changes and trades must
revalidate the certificate; mismatches between cached and actual native escrow
quarantine the market. Native token immutability is checked before lending, and
margin eligibility cannot be retroactively enabled on an old mutable book.

The guarantee depends on native atomic rollback and correct Tokens/Nft/Exchange
and consensus rules, sufficient transaction inclusion and the immutable-asset
admission condition. It protects repayment *quantities*, using conservative
integer liquidation proceeds from committed relay reserves. It does not rely on
cancellable maker orders. A user cannot withdraw LP liquidity which would break
the certified schedule, so solvency may require rejecting a withdrawal or trade;
it does not promise unrestricted liquidity or execution during chain outages.
The runtime checks enforce the liquidation schedule and escrow correspondence;
the independent native test audit additionally sums all internal cash/claims.
That test evidence is not an independently machine-checked proof of every code
path, and forced-liquidation profitability/manipulation deserves separate review.

This does not prove redemption value against external BTC/USD prices, eliminate
an authorized service-upgrade risk or provide a recovery policy after an issuer
recall/freeze. An escrow deficit quarantines the entire affected market,
including otherwise backed positions; this isolates other books but has no
defined wind-down mechanism. A token freeze is different: without a reserve
mutation it does not fail the escrow comparison, but native outgoing credits
can fail (`Tokens/service/src/tables.rs:527-529`). The general market admission
path does not independently check current token transfer flags before accepting
an unaffected asset's passive order (`Exchange/service/src/lib.rs:46-59`). A
production market-status policy should distinguish frozen and underfunded books,
pause new risk and define safe asset-specific claims rather than relying on
failed transfers as the user experience. Margin admission avoids the issuer's
future freeze power by requiring burned token administration NFTs.

The three production gates from this review are:

1. **Secure authority and operations.** Replace unsigned demo user/producer
   roots, define independent upgrade controls and account recovery, and audit the
   privileged RPC and client permission/signing stack.
2. **Validate economic execution and failure recovery.** Unify strict-lot and
   zero-output behavior, independently review the quantity certificate and
   adversarial market manipulation, and implement a documented quarantine
   wind-down. The accounting invariant does not by itself establish fair
   execution, external redemption value or timely liquidation under outages.
3. **Make the service complete at real scale.** Supply paged, market-scoped and
   owner-scoped discovery, durable order/fill audit records and calibrated
   resource/admission economics; test cold historical databases and sustained
   concurrent load. Bounded matching is only one part of that work.

Actual backing and redemption of a token called BTC or USD must be established
separately from its reserved native symbol.
