# Implemented pooled stop orders and cash invariant

The [native service](../../packages/user/Exchange/service/src/lib.rs) now contains
fully funded stop-market actions, an atomic cascade planner and owner-only lazy
settlement. This describes current source, not a claim that every operator has
deployed that source. See [CASCADE_AUCTION.md](CASCADE_AUCTION.md) for the exact
execution/priority policy and [VERIFICATION.md](VERIFICATION.md) for recorded
builds and tests.

## Actions and ownership

| Action | Contract |
| --- | --- |
| `stop(market,sell_base,trigger,amount)` | Debit live native funding into this market's subaccount; arm/top up a generation and return its ID. Sell input is base, buy input is quote. |
| `cancelstop(generation)` | Refund the caller's whole armed position; for a closed position, settle its exact input/output claims. |
| `claimstop(generation)` | Settle a closed position's refund and proceeds; reject an armed or absent owner position. |
| `process(market)` | Permissionless current-due processing and bounded exhausted-maker repair, without an initiating seed. |

A new owner position needs one execution lot at the trigger: `base_lot` for a
sell, `trigger*quote_tick` for a buy. Small top-ups to the same owner's armed
position coalesce. There are at most 64 armed trigger generations across both
directions per market, and at most 128 active ordinary prices while any stop
is armed. Existing-price top-ups do not consume a bucket. A first stop cannot
silently enable an oversized legacy book. These limits bound work; tiny market
lot grids and sufficient capital can still occupy capacity.

`trade`, marketable `limit`, `liquidate` and relay LP changes run stop-aware
processing when armed stops exist. Sell/down and buy/up triggers use inclusive,
integer relay-reserve barriers. Reached generations stay latched during the
atomic plan, including maturity-induced reversals. A stop is not an oracle
instruction or a promise to execute at its trigger price.

Every action derives the owner from the authenticated sender. Cancellation and
claiming fetch one `(owner,generation)` row, never other owners. The native
query returns only the authenticated owner's stop positions, exact claimable
input/output and action flags. Closed positions have zero open principal;
refundable input is reported separately. The local wallet can settle funded
claims before another action, keeping proceeds implicit in its normal balance
flow. A bounded wallet preparation transaction is separate from the consensus
auction's resource bound.

## Native layout and generations

The existing native row layouts are unchanged. Four tables were appended:

| Index | Record/key | Role |
| ---: | --- | --- |
| 11 | `StopPool`, primary `id` | Market, direction, trigger, armed input, outstanding position shares, optional closed batch ID. |
| 12 | `StopBook`, primary `(market,sell_base,priority)` | One currently armed generation per trigger/direction. Sell priority is descending trigger, buy priority ascending. |
| 13 | `StopPosition`, primary `(owner,generation)` | One coalesced owner weight within that generation. |
| 14 | `StopBatch`, primary `id` | Immutable original input, actual executed input, actual output and refund totals; mutable remaining backing/shares; chosen replay mode and planner work. |

Armed input mints shares one-for-one and has no historical execution proceeds:
`StopPool.input = StopPool.shares = sum(own position shares)`. Activation removes
the armed book entry, zeros that pool's input and points it to the common batch
for its direction. Its outstanding shares still equal its unclaimed positions.
They decrease on claims; the batch's original denominator does not.

IDs are never reused. A later order at the same trigger opens a new generation;
old owner positions retain their old batch. There is no mutable policy ID,
expiry class, persistent work queue, or per-owner execution loop. Stop-limit,
minimum-output stop and arbitrary condition policies are not implemented.

## Exact physical-cash invariant

For each market `m` and token `t`, let `E(m,t)` be the expected-cash record and
`N(m,t)` the actual native Tokens balance of exchange subaccount `market-{m}`.
At every committed transaction boundary:

```
N(m,t) = E(m,t)
       = relay reserve of t
       + free lending-vault cash of t
       + maker outgoing and incoming cash of t, including retired generations
       + active-loan pledged collateral of t
       + closed-loan remaining surplus of t
       + armed StopPool.input of t
       + StopBatch.refund_remaining of t
       + StopBatch.output_remaining of t.
```

Each term is cash in a disjoint category. Long collateral and sell-stop input
are base; short collateral and buy-stop input are quote. A bid maker's outgoing
asset is quote and incoming asset base; an ask reverses these. Long-loan
surplus is quote, short-loan surplus base. Batch refunds use that batch's input
asset, and output uses the opposite asset.

Rounding reserves are already included in the corresponding maker cash,
closed-loan surplus or batch remaining fields. Do not add their dust metadata
again. A retired maker's unspent principal still counts. A batch's remaining
cash still counts when its remaining shares reach zero. Closed stop-pool shares
and batch ownership references are not additional cash.

Free native user-to-exchange credits and already delivered exchange-to-user
credits are outside `N`. They are read live and may be revoked/accepted through
Tokens. Receivable face, relay/lender shares, stop shares and marked collateral
value are not physical money. The service's transient primary-balance bridge
is empty after commitment; all committed book cash stays market-isolated.

For one closed batch, original input `Q>0`, refund `R`, actual output `V` and
owner weight `s` give `floor(s*R/Q)` and `floor(s*V/Q)`. Summing floor claims is
at most each corresponding original total. Immutable denominators, authenticated
position erasure, checked backing decrements and exact native credits establish
both non-overpayment and one-time settlement. Residual atom dust is funded and
nonwithdrawable, rather than allocated specially to a final claimant.

## Preservation by mutation and withdrawal

All exchange and Tokens writes share native atomic rollback. Planning itself
changes no objective financial records. The following equalities describe
committed effects; temporary internal transfer bridges are not extra balances.

| Transition | Why physical cash and liabilities change equally |
| --- | --- |
| Create book / add relay liquidity | Actual committed input increases native escrow and the same relay reserves; minted shares represent rights only. |
| Arm / top up stop | Native input increases escrow and armed principal by the same quantity; new shares cannot receive earlier proceeds. |
| Cancel armed stop | Whole owned shares/principal are removed and exactly that input leaves native escrow. |
| Ordinary or stop relay sale | Input moves from seed/stop input category into a relay reserve; exactly the relay output becomes seed settlement or funded stop output. |
| Maker fill | Input becomes the maker's incoming proceeds; its outgoing cash becomes taker/stop output. Relay reserves are unchanged. |
| Activate/close stop generations | Old armed input is replaced by executed-input destinations plus batch input refund and actual output. Never count both old principal and batch cash. |
| Maker retirement | Active-index eligibility changes only. All outgoing principal and accrued proceeds remain recorded and claimable; retirement cannot reactivate. |
| Maker cancel / settle | Recorded pool cash decreases by precisely the native payout; residual dust stays in pool cash. |
| Originate loan | Actual collateral enters escrow; the actual advance leaves free vault cash. Face debt is a receivable, not a second cash balance. |
| Repay loan | Actual repayment increases free vault cash; released collateral and its liability decrease equally. Face and active collateral units shrink together. |
| Liquidate cohort | Collateral `C` becomes relay input. Actual relay output `V` is split into lender cash `D` and borrower surplus `V-D`; face debt is removed. |
| Claim closed loan / stop | The exact payout reduces its funded remaining cash and native escrow together; the owner position is consumed/debited atomically. |
| Lend / redeem lending shares | New cash enters the vault; redemptions pay only existing free vault cash, never a receivable or another escrow category. |
| Withdraw relay LP | Floor-proportional reserves and native cash decrease together; the whole remaining credit certificate must still pass. |
| Withdraw free native balance | Operates on native shared/primary rows outside committed market escrow; no cached exchange IOU is redeemed. |
| Renew empty credit epoch | Requires both debts zero and changes no cash or archived claim entitlement. |

Every financial entry checks market-native cash against its cache. An external
issuer-side recall quarantines a damaged mutable spot market; later deposits
cannot repair phantom claims by silently using another book's cash. Guaranteed
credit additionally requires immutable transferable, unrecallable tokens with
burned administration NFTs at market creation. Cancellations/withdrawals cannot
override a token freeze, missing native backing or malicious runtime upgrade.

The separate whole-schedule margin certificate prevents reusing relay depth
for several cohorts. Ordinary/stop flow respects its trigger boundaries; the
conditional one-direction early prefix uses the same conservative recovery
bound. Final `save` recertifies every remaining price cohort, including after
LP `K` changes. Stops are funded spot instructions; their shared average never
appropriates a margin cohort's lender repayment or borrower surplus.

## Guarantees, privacy and verification boundaries

This is repayment-token solvency under the specified native-token/runtime
assumptions, not an external peg, a guaranteed stop price, full execution,
borrower profit or immunity from manipulation. Input/output/reserve limits,
zero-output rounding and whole-lot constraints can produce a full or partial
input refund. A bounded transaction either commits completely or rolls back;
it leaves no locked auction waiting for another caller. Resource metering and
actual runtime remain separate from the deterministic planner work counter.

The private API is owner-scoped, including shared-cohort loan views. Public
book depth and trade prints are aggregate projections. This is not confidential
consensus: signed actions identify their senders, the public `traded` event
contains its actor, and privileged native operators can inspect state/history.
Generic HTTP SQL is native-admin restricted; the local node treats loopback as
an operator facility. The AuthAny development wallet can intentionally select
all demo identities. See [SECURITY.md](SECURITY.md) for these trust boundaries.

Actual-Rust host tests check the planner and extracted native claim arithmetic;
reference experiments check their own stated mathematical models. Neither
replaces actual-chain sender, Tokens, table, rollback and WASM tests. Current
results/artifact hashes belong in [VERIFICATION.md](VERIFICATION.md), not an
inferred claim that written fixtures have passed. The threshold-tree experiment,
TWAP/oracle triggers, guaranteed stops and asynchronous clearing remain proposals.
