# Exchange

A Psibase service using native objective `Table` records, the native Tokens
service and immutable Symbol mappings. Anyone can create a book for a
token pair by funding both sides of its relay. Multiple independently funded
books can use the same pair, with distinct market IDs and isolated collateral,
relay reserves and lending vaults. A creator chooses base/quote orientation and
the integer execution lot without capturing an exclusive token-pair namespace.

`service/` contains the consensus accounting and matcher. `query-service/`
provides read-only market/catalog/snapshot endpoints. `ui/` is the browser app;
the repository's `demo/` scripts boot and seed a local development chain.

See [PAGINATION.md](PAGINATION.md) for bounded public/owner reads, exact market
and asset lookups, snapshot coverage, and explicit receipt-scan continuations.

## Token ownership and settlement

Deposits are native `tokens.credit(token, exchange, amount)` calls. Uncommitted
deposits remain user→exchange shared balances, with the user as creditor. Users
can uncredit them directly; the exchange therefore never caches an IOU for a
deposit. Settlement proceeds are native exchange→user shared credits, unless
the recipient enabled native auto-debit, in which case they reach the user's
primary wallet immediately.

Each commitment reads live native balances. It first uncredits the sender's
exchange→user proceeds, then debits any required user→exchange deposit. Orders,
armed stops, collateral, lender cash and relay reserves become committed escrow in
the native Tokens subaccount `market-{id}`. Each book has a separate native
subaccount, including books that use the same pair. An
aggressive limit order keeps its already-funded remainder inside the same
transaction while posting it; it does not refund and debit that remainder a
second time. This works with either recipient auto-debit preference.

Withdrawals use native Tokens uncredit/debit. The frontend can atomically
settle a user's maker proceeds, closed-loan surplus and funded stop claims before their next action,
without a separate claim screen. The service never accepts an arbitrary owner
parameter for spending, cancellation, repayment, LP withdrawal or claiming.

Only the Tokens service writes its tables. Exchange query code reads them
through native table indexes. A new `(creditor,debitor,token)` secondary index
avoids a pending-holder scan, and the token getter's allocation is lazy. That
index requires backfill for an existing chain; this demo creates its traded
tokens on the new schema and is not an unattended migration tool.

## Order allocation and routing

At a maker price, the service holds one outgoing escrow and one per-share
incoming-proceeds index. Wallet positions coalesce at `(owner,market,side,price)`.
A top-up receives shares proportional to remaining outgoing escrow and carries
entry debt at the current proceeds index. It cannot receive historical fills.
Cancellation burns the wallet's entire position; `settle` claims proceeds
without cancelling. Filled generations persist until their funded claims are
redeemed. Their IDs are never reused.

With Q=2^40, a maker generation satisfies

```
Q * incoming_cash = sum(shares_i * proceeds_index - entry_debt_i) + dust.
```

A fill updates the aggregate escrow/index, with no maker-position iteration.
An aggressive order consumes the relay to the next price, fills the aggregate
maker pool there, then uses the relay across the next gap. Marketable limits
perform this routing with an explicit price boundary and post a passive
remainder. A funded remainder still crossing the final relay/opposite book is
returned after a cascade or terminal execution bound, rather than posted as a
crossing order or recursively replanned. Maker fills are whole lots; unposted
odd-lot remainder is returned.
The limit price is checked against each actual relay leg's integer output.

Market trades accept a minimum output and a caller-selected seed routing budget
(maximum 256). In the legacy path a boundary checkpoint can leave a due
liquidation pending; no ordinary relay advancement proceeds past it until
bounded processing runs.
Unused market input is refunded. Any rejection reverts all native table writes,
token calls, emitted events and allocations through Psibase transaction rollback.

## Pooled stop-market auctions

`stop(market,sell_base,trigger,amount)` commits actual base/quote funding and
coalesces the owner's input at a trigger generation. `cancelstop(generation)`
cancels a whole armed owner position; `claimstop(generation)` settles closed
refund/output. New owner positions require one execution lot; small top-ups
are allowed. Triggering uses inclusive native integer relay-reserve barriers,
not an external ticker or UI request. New already-reached triggers are rejected.

With stops armed, the market admits at most 64 stop generations, 128 ordinary
price levels and 64 loan-price cohorts, across both directions. Planning and
one optional same-direction margin-first replay happen on a bounded snapshot.
An infeasible replay falls back to the original actual causal path, preserving
the initiating limit and minimum output. Mixed-direction and no-seed maturity
work remain causal. `process(market)` can run current-due work and bounded maker
repair, with no persistent auction or market lock.

All stops activated in one transaction share actual output and unspent input
proportionally in one batch per direction. Claims use the immutable global
input denominator once; remaining rounding cash is nonwithdrawable reserve.
The initiating order and senior margin recoveries keep separate proceeds.
Stops do not guarantee their trigger price or a complete fill. Lots, zero output,
reserve/output bounds or other representability limits return unspent input.
An intrinsically exhausted maker generation retires without losing its funds;
old cancellation cannot reactivate it. An LP resize making a stop unreachable
above the reserve cap leaves that stop armed and cancellable.

No trigger or auction visits stop owners or borrowers. Execution cost depends
on aggregate active prices and path transitions. The seed routing budget is
not a hard total CPU limit for automatic cascades; deterministic `auctionwork`
metadata and actual native benchmarks describe different costs. See
[the auction contract](../../../docs/exchange/CASCADE_AUCTION.md) and
[cash preservation](../../../docs/exchange/STOP_LOSSES.md) for exact rules.

## Relay and fixed-face margin

The relay stores physical reserves X,Y and a protected product K<=XY. Between
LP changes K is fixed. Input C into oriented reserve u returns

```
V = v - ceil(K/(u+C)) >= floor(K*C/(u*(u+C))).
```

Base-selling uses u=X,v=Y; quote-selling reverses them. Every swap leaves the
physical product >=K. LP minting takes ceil-proportional reserves and burns pay
floor-proportional reserves. Each LP change rebases K to the resulting actual
X·Y, then re-certifies the whole loan schedule before it can commit. One LP
share is permanently locked at the zero account at market creation; actual LPs
can redeem all their owned shares subject to credit commitments. At least one
reserve atom remains and a positive relay is maintained.

Loans are isolated, fixed-face obligations with a common 30-day maturity. The
face includes the entire 1% financing charge; there is no uncapped interest
accrual. With base lot L, quote tick T and trigger price p:

| Direction | Per-unit collateral | Per-unit face |
|---|---:|---:|
| Long base, borrow quote | 2L base | pT quote |
| Short base, borrow base | 2pT quote | L base |

The advance per unit is `face-ceil(face/100)`; a zero advance is rejected.
Identical-price borrowers hold units in one generation. Loans originate before
their trigger and can be repaid with actual repayment tokens. Only the owner's
repaid units release collateral. Full price cohorts, never individual borrowers,
are liquidated. The lender receives actual repayment immediately; only the
borrower's funded surplus distribution is lazy.

Both tokens must be unrecallable, currently transferable, and have burned token
administration NFTs before lending/margin is enabled. Otherwise an issuer could
recall collateral or freeze future liquidation transfers. Symbol mapping and
intended token issuance happen before the admin NFT is burned. Spot books are
generic over transferable token IDs; immutable Symbol mapping supplies display
names and never substitutes for a token's numeric identity.

Margin eligibility is recorded at market creation, rather than reclassified
later. A mutable-token spot book stays ineligible even if its issuer later
burns administration. Otherwise an issuer could first recall its reserves,
then make the token immutable and reuse phantom old claims against newly
deposited guaranteed funds. A new immutable book receives its own funded
subaccount. A cached native-escrow total per book/token is compared with the
actual subaccount before every input/output transfer; external balance changes
pause that asset's commitments and withdrawals instead of recapitalizing stale
claims with unsuspecting new deposits. Legacy books without this isolation
marker are disabled pending explicit migration.

Lending LP NAV in its repayment token is `free_cash + active_face`. A redemption
can spend only free cash. An active loan cannot be extended by changing its
epoch. Once both directional debts are zero, anyone may `renew(market)` to start
a new 30-day epoch; archived funded claims remain redeemable.

## Solvency invariant

For each direction sort price cohorts in liquidation priority: highest trigger
price first for longs, lowest first for shorts. Let

```
h_long(p)  = floor(sqrt(K*L/(p*T)))
h_short(p) = floor(sqrt(K*p*T/L))
a_1       = max(current_oriented_reserve, h_1)
a_j       = max(h_j, a_(j-1)+C_(j-1)).
```

The service requires, for every active cohort,

```
floor(K*C_j / (a_j*(a_j+C_j))) >= D_j.
```

Thus later buckets cannot reuse depth already reserved for earlier ones. This
reference deliberately scans at most **64 active credit prices per market** to
certify a change. Its cost depends on price buckets, not borrower count. It
does not claim a logarithmic risk index; the composable tree certificate in
the prior prototype can replace this bounded scan without changing the proof.

The cash invariant is separate from the face-value accounting:

```
native balance in this book's subaccount, by token
 = relay reserves + free lending cash + active pledged collateral
 + maker outgoing/incoming escrow + closed-loan surplus escrow
 + armed stop input + closed batch remaining refunds/output.
```

User→exchange deposits and exchange→user settled credits are outside that
subaccount identity. They are actual native shared balances, never another
exchange receivable. Loan face and LP shares are not physical cash. Retired
maker cash and residual batch dust still count; scaled dust metadata and closed
stop shares must not be added as duplicate cash.

**Preservation argument.** A permitted ordinary relay leg stops at the head's
trigger, so its own planned liquidation starts are unchanged; the opposite
direction's input reserve decreases, improving its recovery. Book-only fills
leave both relay reserves unchanged. A head liquidation begins no later than
its planned start, so the lower bound above pays its full D. It finishes no
later than the previous planned end, improving every later cohort's bound;
the opposite direction improves too. Its collateral moves into the relay,
repayment into lender cash, and surplus into funded escrow. There is no new
money and no borrower loop.

Repayment reduces C and D in the same proportion. Recovery per collateral unit
is K/[a(a+C)], which increases as C shrinks; subsequent planned starts weakly
decrease. New borrowing and changes of K explicitly re-test the whole
certificate. Lending redemptions use only free cash. Native free withdrawals
cannot touch pledged escrow. Maker and closed-loan claims move funded cash
once. These transitions preserve both the cash identity and constructive
repayment capacity. At maturity, closing a cohort before its price trigger is
also covered by the same lower bound.

Stops move fully funded principal into actual relay/book input and backed batch
refund/output. Owner claims reduce exactly those amounts and physical native
cash together. Conditional same-direction early margin execution improves the
conservative recovery bound; its proceeds are never included in stop sharing.

This is repayment-token solvency under the stated contract and token rules,
not a guarantee of an external dollar peg, borrower profit, or immunity from
price manipulation. Relay capital must remain committed while it backs credit.
If no one processes a due boundary, ordinary trading can pause safely; any
participant can resume processing with `liquidate`. Initiators pay native gas;
no unpaid keeper bounty is subtracted from certified lender repayment.

## Integer limits and verification

Each order-pool amount, relay reserve, vault amount, aggregate collateral/face
and share supply is <=2^40-1. Aggregate native escrow across all price pools
uses checked u64 addition and must equal its native subaccount balance.
Prices are positive 32-bit ticks; per-unit price/lot products also
obey the amount limit. K<2^80, K·C<2^120 and coverage cross products fit within
121 bits. Checked u128 scratch is sufficient under those explicit bounds.
Fracpack has no primitive u128, so persisted wide values use two native u64
limbs. Spot indices are additionally bounded below 2^80, keeping share/index
and entry-debt arithmetic inside u128. No financial calculation uses a float.

`service/src/math.rs` exhaustively checks small integer recovery bounds and
shared-depth counterexamples. `service/src/tests.rs` runs actual Psibase chains,
audits native escrow independently, tests share/loan supplies, rollback,
ownership isolation, coalescing, both-direction cascades, unsafe LP redemption,
immutable-asset admission and exactly-funded marketable limits. Snapshot tests
cover large integer serialization and private/public query boundaries.

Use the current repository-built `cargo-psibase` and `psitest`:

```sh
cd packages/user
python3 Exchange/test_math.py
python3 Exchange/test_stops.py --mutations --coverage
../../rust/target/release/cargo-psibase psibase \
  --psitest=../../build/psitest -p exchange-pkg package
../../rust/target/release/cargo-psibase psibase \
  --psitest=../../build/psitest -p exchange test
```

The host runners also execute panic-boundary tests that the aborting WASM test
harness intentionally skips. They compile the same function/test source, with a
host adapter for platform-dependent wide storage. The stop harness extracts the
actual planner and native claim arithmetic; it does not replace native KV,
custody, sender, rollback or WASM testing. Optional `--branch-coverage` uses
experimental host-only Rust branch instrumentation; its report separates
planner coverage from test helpers and assigns no probability of correctness.

The local demo's package overlay supplies current token and account interfaces;
released pre-version packages need the explicit compatibility preparation in
`demo/prepare_packages.py`. The demo is not a production deployment or a
completed external audit. See `docs/exchange/SECURITY.md` for the independent
implementation review, assumptions and remaining deployment work.

## Native execution candles

Candles support 5 seconds, 15 seconds, 1 minute, 1 hour and 1 UTC day. The service
keeps one current nonempty candle for each market and interval; completed candles
are public native history events and may be pruned. It never stores historical
candles in objective tables or synthesizes bars for empty intervals. Coverage
starts when this version is deployed; old execution events are not presented as
a completed historical candle backfill.

Prices are stored as exact base/quote atom ratios. The public chart DTO uses
`quoteAtoms * 10^18 / baseAtoms` integer prices with page-level `price_precision =
quotePrecision + 18 - basePrecision`, preserving positive prices even for native
assets whose whole-token price is below one quote atom. Display conversion floors
only this high-precision DTO; stored OHLC ratios remain exact. Volume uses real
base-token atoms. See [candle storage and API](../../../docs/exchange/CANDLES.md).
