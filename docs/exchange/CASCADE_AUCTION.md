# Implemented stop-cascade auction

This document describes the current [consensus source](../../packages/user/Exchange/service/src/stops.rs).
Build, native-test, artifact and deployment status are recorded separately in
[VERIFICATION.md](VERIFICATION.md). The augmented threshold tree discussed in
the earlier experiments remains a proposal; the implementation uses bounded
native snapshots and an atomic planner.

## Execution contract

A stop is a fully funded market instruction, aggregated by market, direction
and trigger tick. Sell stops commit base; buy stops commit quote. Each new
owner position requires at least one execution lot at its trigger; that owner
may make smaller coalesced top-ups. Owners cancel whole positions. This prevents
a second wallet leaving a one-atom pool after the principal owner cancels,
but it is not an economic Sybil-proof admission policy.

Triggering uses the protected relay product and the market's integer grid:

```
sell barrier = floor(sqrt(K * base_lot / (trigger * quote_tick)))
buy barrier  = floor(sqrt(K * trigger * quote_tick / base_lot))
```

A sell generation latches when `X >= sell barrier`; a buy generation latches
when `Y >= buy barrier`. Equality is inclusive. These native integer reserve
barriers define the contract, including their rounding; they are not an exact
comparison with an unrounded displayed price. Last trade, external prices,
TWAPs and UI polling do not decide activation. Admission rejects an already
reached or currently unrepresentable trigger and requires no pending margin.

When stops are armed, `trade`, marketable `limit`, `liquidate`, and relay LP
resizes use the stop-aware engine. Anyone can call `process(market)` for
currently due/crossed work and bounded maker lifecycle repair. It supplies no
hypothetical initiating input and cannot start an otherwise unreached cascade.
There is no persistent job, market freeze, continuation reservation or keeper
required to finish an already committed auction.

The engine first computes an actual causal path on a copy of current state:

1. Latch already reached stops and drain currently due margin cohorts, using
   the existing long-before-short tie rule, including common maturity.
2. Route the initiating order, if any. Respect its limit, actual integer output
   and seed routing budget. Latch stops at every relay/liquidation segment;
   process due margin before further ordinary relay advancement.
3. Route newly available stop input. Prefer the initiating direction, or sell
   direction without a seed, then the other direction. A generation contributes
   once only. Additional crossings can add further funded input in either
   direction, even if the price later reverses.

Stop input is never used to finance reaching its own first activation. This
causal discovery does not solve an arbitrary final-price self-consistency
formula, which can have larger, unreachable fixed points.

## Conditional margin-first replay

After discovery, the planner may try **one** replay with the selected margin
prefix executed before the initiating order. It does so only with a nonzero
seed, all selected margins in the seed's direction, and all causally activated
stops in that direction. Each margin cohort retains its certified relative
priority and its own actual recovery, debt repayment and borrower surplus.
Margin proceeds are never shared in the ordinary stop average.

The replay is accepted only if it introduces no additional prospective margin,
activates no opposite stop, executes at least the causal seed quantity, and
satisfies the initiating minimum output and per-leg limit. Otherwise the
original feasible causal plan is committed. Mixed flows and no-seed maturity
processing keep causal ordering. There is no iterative search for a clearing
configuration and no silent weakening of the initiating protection.

This is an explicit priority rule: some future same-direction margin cohorts
can close earlier than their price trigger when a funded, feasible causal seed
would have reached them. An unfunded seed cannot commit that outcome: native
funding and every later write are in the same rollback-capable transaction.
The chosen mode is recorded as `margin_first` in execution metadata.

A margin-first replay can invalidate a limit that was executable originally.
For example, with `K=10000, X=105, Y=96, base_lot=5, quote_tick=1`, a long cohort
at tick 4 has reserve barrier 111, collateral 10 and face 4. An initiating sale
of 6 at limit 4 receives 5 quote and reaches the trigger. Selling collateral
first instead moves `X` to 115, so that initiating limit executes nothing.
The implementation retains the causal plan in this case.

After all flows, a funded limit remainder is posted only if it is passive
against both the final relay boundary and opposite book. If an opposite cascade,
output cap or integer precision leaves it crossing, its unspent input is
returned. It is not posted as a crossed order or recursively replanned.

## One proportional result per direction

All stop generations activated by the chosen transaction share one batch per
direction. The initiating order keeps its own execution proceeds; each margin
cohort keeps its own recovery. For one stop batch let:

```
Q = original committed input of all included stop positions
I = input actually executed
V = actual output received
R = Q - I
```

The common realized average on executed input is `V/I` when `I>0`; it differs
from the terminal marginal price. Every original input unit receives the same
rational output rate `V/Q` and refund rate `R/Q`. For an owner position of `s`
units, the actual atom payouts are:

```
input refund = floor(s * R / Q)
output       = floor(s * V / Q)
```

These use the immutable **global batch denominator once**, without first
rounding a per-trigger allocation. Both asset totals remain constant after
claims. Claims erase the authenticated position and subtract exactly their
payouts from remaining backing. Sum of floor claims cannot exceed either total.
Atom rounding can give small differences from the common ideal rate; residual
cash stays in the batch as backed, nonwithdrawable protocol dust, including
after the last share is claimed. No owner or last claimant receives it twice.

Different transactions have different batch membership and averages. Splitting
a seed can therefore change allocation even if final relay reserves coincide.
A time-batched auction would be a different, unimplemented contract.

## Lots, exhausted makers and partial execution

Stop-aware routing touches superior ordinary book depth even with sublot input.
If it cannot execute one whole head lot, that leg terminates and returns the
unspent input through the batch refund. It does not skip the book and infer
lower relay triggers from a dust trade. A zero-output relay step also terminates
without donating the input. The old no-stop router's other lot semantics have
not been replaced by a globally continuous price curve.

Reserve headroom, the per-direction aggregate output bound, or remaining maker
capacity can similarly end execution. Output-cap searches choose a bounded
representable relay input. All unspent stop principal is included in `R`.
The transaction need not execute every admitted input atom to finish safely.
Trigger activation is neither a minimum-price guarantee nor a full-fill promise.

An intrinsically exhausted maker generation is different from a small taker:
if its incoming-cash or proceeds-index capacity cannot accept one lot, the
engine seals it, removes its active book entry and continues. Its outgoing
principal and earned proceeds remain fully claimable by its owners. Inactive
maker generations are terminal: cancellation cannot reactivate one or overwrite
a newer generation at the same price. Both the legacy router and stop-aware
router implement this lifecycle; `process` can retire at most 128 exhausted
heads independently of a positive-minimum-output trade that would roll back.

An LP resize changes `K` and may move an existing stop's required reserve above
`MAX=2^40-1`. Stop thresholds retain their actual, unclamped `u64` value; such a
stop stays armed and cancellable rather than panicking or falsely activating
at `MAX`. Loan thresholds remain subject to the stricter credit certificate.

## Bounded work and its limits

The market-wide admission limits, shared across both directions, are:

| Active state | Limit |
| --- | ---: |
| Stop trigger generations | 64 |
| Ordinary book prices while any stop is armed | 128 |
| Credit price cohorts | 64 |

First stop admission detects an oversized legacy book using at most 129 index
rows and refuses admission. Ordinary trading and cancellation without stops
remain available. Every new ordinary price writer enforces the stop-enabled
cap; an existing-price top-up does not consume another bucket. Historical
closed generations and the number of owners are not scanned during auctions.

A bounded snapshot loads aggregate pools/cohorts once. All reserve barriers are
computed once and reused by discovery/replay. Directional ordered head cursors
advance through retired books, closed loans and latched stops. Only changed
maker pools, closed cohorts and activated generations are written on commit;
owner positions are untouched until that owner claims or cancels.

Each cohort closes at most once; each stop latches once and contributes to at
most one nonempty dequeue. There are at most 64 such dequeues. Within a leg,
a fill consumes input, a retirement advances a head, a relay leg reaches a new
boundary or finishes its input, and zero-progress cases return. Loan flows can
reverse direction only a bounded number of times. A conservative transition
bound is `O((B+S+C)*(S+C+1))` for admitted book/stop/credit counts. Preparation
also sorts bounded index vectors and performs at most one square root per
aggregate row. Output-cap binary searches take at most 40 iterations per search.

The checked `MAX_WORK` counter is

```
2 * (B+S+C+4) * (S+C+2) * 2 * (B+S+C+8) = 35,692,800
```

at the configured maxima. It deliberately overestimates planner inspections,
barrier preparation and bounded searches for two simulations. It is not a VM
instruction count, gas tariff or measured CPU limit. Native table operations,
funding, sorting, final credit recertification and runtime overhead must also
be measured. The seed's `max_events` does not cap all automatically required
stop/margin work. `auctionwork` supplies deterministic planner metadata;
[verification](VERIFICATION.md) records native measurements separately.

No action leaves a frozen market behind if planning, funding, minimum output,
checked arithmetic or final certification fails. A real node resource failure
rolls back; cardinality bounds and progress tests do not establish a universal
wall-time guarantee on every machine. Capacity occupation, transaction ordering,
price manipulation and who pays transaction resources remain explicit economic
limits. There is no prepaid keeper bounty or general storage-rent defense.

## Debt coverage and separate cash conservation

For each certified cohort, the existing schedule requires
`floor(K*C_i/(a_i*(a_i+C_i))) >= D_i`. In an eligible same-direction early
prefix, execution starts at `e_i = initial_reserve + prior_selected_collateral`,
which is no greater than its certified `a_i`. The conservative recovery bound
therefore improves and actual rounded relay output still covers `D_i`.
Remaining same-side planned starts do not increase, and opposite-side recovery
improves. Exact atom-rounded borrower surplus need not improve monotonically.

Causal routing continues to stop at due credit boundaries; all final states
pass the whole remaining schedule check. Lending redemptions can spend only
free vault cash, and LP withdrawal must leave the remaining certificate valid.
Fully funded stops create no new face debt. This proves repayment-token
coverage under the native token/runtime assumptions, not an external value peg
or a guaranteed stop price.

The separate exact physical-cash identity and every mutation's preservation
are specified in [STOP_LOSSES.md](STOP_LOSSES.md) and
[SECURITY.md](SECURITY.md#required-accounting-invariant).

## Evidence and unimplemented extensions

The actual Rust [host harness](../../packages/user/Exchange/test_stops.py)
extracts current planner/math source and the native claim arithmetic block.
It tests token conservation, seed protection, both directions, maturity, cap
and dust boundaries, deterministic work and targeted mutations. Its planner-only
region/branch coverage excludes test helpers. It does not exercise KV authority,
native Tokens calls, ABI, WASM metering or HTTP privacy. Actual-chain fixtures
and benchmarks cover those separate integration boundaries; consult recorded
runner results rather than treating written tests as passes.

The `(C,H)` augmented threshold tree, oracle/TWAP triggers, guaranteed-price
stops, stop-limit policies, persistent/resumable auctions, arbitrary conditional
programs and a global time-based clearing epoch are not implemented. The tree
[experiment](../../experiments/stop-cascade/README.md) proves logarithmic closure
discovery only under its fixed monotone-curve assumptions; those bounds do not
describe this bounded native planner.
