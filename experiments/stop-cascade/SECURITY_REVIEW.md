# Independent stop-auction review and confidence boundaries

This document separates an independent mathematical/reference-model review
from tests of the actual native service. Passing Python models is not evidence
that a deployed WASM module implements those models. No percentage probability
of financial correctness is assigned.

## Chosen implementation contract

The implementation under review uses one atomic transaction, not a persistent
job. With stops armed, it admits at most 64 stop trigger buckets, 128 ordinary
book prices, and the existing 64 credit price cohorts per market. These are
market-wide limits, shared across both directions. Multiple wallets at the same
trigger coalesce into the same funded pool; per-wallet limits would be Sybil
controls rather than resource bounds.

The planner first discovers one causal path, latching actual trigger crossings.
A margin-first replay is eligible only when there is a positive initiating seed
request and every selected margin cohort and activated stop has the seed's
direction. The replay retains the certified price order of margin cohorts. It
is accepted only if it introduces no additional margin calls or opposite-side
stops, executes at least the original seed quantity, and preserves the seed's
minimum output and price limit. Otherwise the original valid causal plan is
retained. Mixed-direction and no-seed processing use the causal plan. There is
no iterative reordering search. A user's minimum output can reject the entire
transaction; that is an explicit protection rather than a committed/frozen job.

All selected stops of one direction share that auction's total actual output
and unspent input proportionally to original committed input. Partial execution
and refunded input are explicit outcomes. Market stops do not guarantee their
trigger price or a full fill. Different transactions are separate auctions;
this does not remove transaction-splitting or inter-transaction priority effects.

The planner must finish or reject before native financial writes. Native atomic
rollback remains necessary for failures during token transfers or applying the
validated plan. No market remains locked after either result. Consequently
LP/cancel/borrow/repay interleavings between auction chunks do not exist in this
contract. Those operations run before or after the auction against fresh state.

Three additional lifecycle rules prevent valid terminal conditions from
becoming a permanent trading obstruction:

* A maker generation that cannot receive one native input lot because its
  incoming balance or proceeds index is exhausted is retired and removed from
  the active book. Its owners retain their funded principal and proceeds for
  lazy claims. Retirement is sticky: a later settlement or cancellation that
  restores capacity cannot reactivate that generation. Normal routing and
  permissionless `process` repair also retire exhausted heads without stops.
* An LP resize may move an existing stop's reserve threshold above `MAX`.
  Internal stop barriers retain that actual threshold, making the stop
  unreachable in the current reserve domain. They neither panic under the
  strict loan-trigger check nor clamp to `MAX` and falsely activate. The stop
  stays funded and cancellable. Loan certificates remain strict and are checked
  against the resized relay.
* If a funded limit remainder becomes marketable again after queued stop flow,
  or still crosses an opposite book price, the service refunds that remainder
  instead of posting crossed passive depth or starting another auction. Every
  already executed seed leg retains the original limit protection. This bounded
  partial/refund rule also covers an integer remainder that cannot execute at
  its limit despite a continuous-price comparison suggesting a cross.

## Threats and required defenses

| Adversarial action | Required property and evidence |
| --- | --- |
| Thousands of wallets at one trigger | Planning/execution reads aggregate pool quantities, not owner positions. Claim/cancel reads one authenticated owner position. Model checks identical work for one contribution and 5,000 contributions with the same total. Native source review and owner-scaling timing are separate evidence. |
| Many distinct dust trigger prices | Market-wide bucket cap; all writers preserve admission bounds. Reaching the legal cap with a one-atom seed must finish safely, rather than require a smaller nonexistent seed. Native fixture constructs 64 prices with the same integer boundary. |
| Legacy book already above the price cap | Bounded `cap+1` snapshot detection rejects stop admission. Ordinary trading/cancellation without stops remains usable. Never silently truncate a financial snapshot. |
| Late liquidity/order top-up | Recompute from the current native snapshot. Existing-price top-ups do not create new price buckets; new-generation writers must enforce the same cap. |
| Requested seed becomes invalid after senior calls | Keep the original feasible causal plan. Do not repeatedly try fixed points, remove price protection, or leave a frozen reservation. Native limit and minimum-output fallback fixtures are separate cases. |
| `process` without any trade | Activate only currently reached triggers or currently due credit cohorts. Hypothetical future input cannot finance its own trigger. |
| Stops forced across `MAX` reserve or output limits | Cap executable input/output before arithmetic overflow; refund the remainder proportionally. Check both aggregate directions, not only each pool. Output can exceed an input bound because prices differ and many maker pools contribute. |
| Historical maker index/incoming nearly exhausted | Retire intrinsically exhausted generations and skip their active heads, retaining funded owner claims. Sticky inactivity prevents later cancellations from resurrecting retired depth. Do not retire a healthy pool merely because this seed is sublot or its output budget is exhausted. |
| LP resize makes an armed threshold unreachable | Preserve the raw stop threshold above `MAX`; trading and `process` remain usable and the owner can cancel. Do not clamp into a false activation or apply strict loan-only range checks to an existing stop. |
| Opposing flow makes a funded limit remainder marketable again | Preserve executed limit checks and refund the unused input before passive posting; no recursive replanning or rollback of an otherwise valid cascade. |
| Zero output, sublot remainder, or exact boundary | A terminal partial/refund result, with no loop that retries unchanged state. Lot handling must not skip superior native book depth to infer a misleading trigger. |
| Opposing liquidations at maturity | Bounded deterministic processing; latch crossings in both directions, even when the price reverses. One-direction final-price fixed-point reasoning alone is insufficient. |
| Claim twice or claim another owner | Caller from native sender authority; position erased/debited atomically, immutable denominator and batch totals, checked remaining backing. Old generation IDs cannot address a new pool. |
| Split one position across wallets | Floor-rounded claims never sum above pooled backing. Splitting cannot increase aggregate ideal entitlement. Any remaining atom dust stays funded and has an explicit non-user disposition. |
| Recall/freeze from mutable issuer | Existing isolated-market cache checks quarantine damaged books. Never borrow against mutable-token collateral or let a damaged old spot book drain a newly immutable book. |
| Revoke uncommitted shared funding | Stop admission must actually debit native funding into that market's isolated subaccount. No cached free balance or revocable credit backs an armed stop. |
| Huge own receipt list in the adapter | Preparation is bounded and token-directed; existing free cash is usable without realizing unrelated claims. Never retry an unknown final order submission. This is separate from the native consensus resource bound. |

## Cash and ownership invariants

For each isolated market and native token, the sum of disjoint accounting
categories must equal both the exchange's cache and the actual native token
subaccount balance. The additional categories are:

* Armed stop input, counted once while no batch is attached.
* Sealed batch unclaimed input refunds.
* Sealed batch unclaimed output proceeds.

Sealed pool shares are ownership references, not additional cash. Do not count
both the old pool principal and the sealed batch refund/output. The equality
must include protocol rounding dust still held in a batch with no shares.
Each owner position's input units contribute once to a generation and once to
the immutable batch denominator after activation.

For a batch with original input `S`, output `H`, and refund `R`, an owner with
input units `s` receives `floor(s*H/S)` output and `floor(s*R/S)` input. Claims
must decrease physical cash, batch remaining backing, and owner position shares
consistently. Denominators and original totals cannot shrink after earlier
claims. Sum of all floor claims is at most each original asset total, regardless
of claim order. Owner aggregation at one trigger does not increase the number
of financial execution steps.

Margin faces are senior obligations. Liquidation credits actual recovered face
cash to the lender vault and leaves actual surplus funded for borrowers. Do not
redistribute those recoveries into the ordinary stop VWAP. Before applying the
plan, all remaining cohorts must retain the existing credit certificate.

## Progress argument to verify in native code

Within a simulation, every credit cohort closes at most once and every armed
stop generation latches at most once. A nonempty stop dequeue therefore needs
newly latched funded input; there are at most 64 such generations. Within a
route leg, a successful fill consumes positive input, retires an ordinary pool,
reaches a new finite barrier, or handles a newly due cohort. A leg encountering
zero executable input/output or an exhausted bound must terminate with a
refund. No branch may continue with identical reserve, remaining input, pool,
trigger and loan state.

This argument bounds transitions under the admitted state caps. A concrete
`MAX_WORK` counter must count record inspections as well as relay/fill events,
cached barrier preparation, and bounded output-cap binary searches. The
two-plan replay limit is essential. A counter assertion by itself is not a
liveness proof: legal maximal states must be shown to remain below it.
`MAX_WORK` is a deliberately conservative internal work counter, not native
billable CPU units, a runtime upper-bound proof, or a guarantee of transaction
inclusion. Source progress arguments, measured maximal native fixtures, and
metering evidence must be assessed separately. Safe completion with a refund
also does not promise that every submitted atom trades or that price advances.

The implementation caches square-root barriers once per bounded snapshot and
writes only changed ordinary pools. Those choices remove repeated expensive
arithmetic and full-book rewrites from a tiny trade's path, but do not turn the
abstract work counter into a portable CPU measurement.
Timing must separately report measured wall duration, native watchdog duration,
work counter and native inner-action count. Watchdog time is monotonic elapsed
on macOS and thread CPU on Linux; it is not portable pure CPU time.

## Current independent evidence

The exact-production-source Rust host runner is
[test_stops.py](../../packages/user/Exchange/test_stops.py). The observed
[host report](../../demo/stop-host-tests.json) and
[log](../../demo/stop-host-tests.log) record **25 passed, 0 failed** and four
detected targeted mutations: ignored seed minimum output, missed exact trigger
boundary, incorrect common claim denominator, and omitted refund-backing debit.
The report records source SHA-256 hashes; all six recorded source/test hashes
matched the current files when this review was updated.

Its LLVM branch-instrumented coverage for the extracted production planner is:

| Metric | Covered / total | Coverage |
| --- | --- | --- |
| Regions | 670 / 675 | 99.26% |
| Branches | 133 / 138 | 96.38% |

These percentages cover the extracted planner source, excluding test helpers and
storage adapters. The host runner also compiles the exact math functions,
record fields, and native stop-claim arithmetic block, with a host replacement
for the wire-format `Wide` adapter. It does **not** execute native KV reads or
writes, action authorization, token custody/transfers, ABI encoding, WASM
metering, HTTP privacy, or the whole financial service. These are not native
full-service coverage percentages and are not probabilities of correctness.

The standalone reference suite is:

```
python3 experiments/stop-cascade/test_reference_model.py
```

At review time it passes 17 deterministic tests, including 2,000 seeded
relay-only closure/escrow cases, 3,000 seeded causal/replay/escrow cases, and
1,000 seeded rounding/splitting cases. These tests check exact native-style
integer relay division, original-denominator input/output claims, pre-write
errors, causal fallback, zero-output termination, no-seed processing, permutation
invariance, and an explicit routing-step bound. Every internal financial move
is checked against an independent physical-cash ledger.

`mutation_check.py` also ran eight targeted, syntactically valid model mutations;
all eight were detected by the unmodified tests. The mutations changed relay
ceil rounding, claim denominator, refunded principal, seed fallback, seed
minimum output, causal process triggering, due-margin handling at the last
routing boundary, and the routing budget comparison. This is evidence that
those model assertions are meaningful, not mutation coverage of native WASM.

The earlier `test_closure.py` checks an augmented monotone threshold tree in
25,600 cases and a 65,536-level domino discovery. That tree is a separate
proposal; it is not implemented by the bounded native auction. It does not
prove the current hybrid router monotone for arbitrary atom inputs.

The independent actual-chain file
[stop_security_tests.rs](../../packages/user/Exchange/service/src/stop_security_tests.rs)
contains **11 written fixtures**: owner coalescing/cancellation/replay, capacity
admission and cancellation escape, the 64-price minimum-atom cliff, exact common
claims and book isolation, limit/minimum-output causal fallback, opposing
maturity calls, maximum-principal output-cap refunds, a seeded 96-action native
state sequence, LP-resize unreachable triggers, crossed limit-remainder refunds,
and exhausted-maker retirement with late-join claims and restored capacity.

Their final actual runner results are pending insertion by the native-run owner;
this review does not infer a pass from their source or from host coverage. The
parent suite's rollback snapshot and physical escrow auditor include all four
stop tables, checking armed index consistency, shares and sealed cash backing.
Native benchmark samples fork the same fixture state/block time, while wall
durations are measured repeatedly rather than asserted deterministic.

## Confidence reporting

Use separate evidence categories:

1. **Mathematically established under stated assumptions:** one-direction
   monotone closure, floor-claim upper bounds, and earlier same-direction AMM
   recovery monotonicity. These are not whole-service formal verification.
2. **Reference-model tested:** the seeded cases above, with exact assumptions and
   intentional exclusions stated in code.
3. **Native behavior observed:** actual authenticated chain fixtures, accounting
   audits after each action, transaction rollback, and maximal-state timing.
4. **Still requiring evidence:** whole-service/native branch coverage, broader
   native fault injection, additional bounded-state fuzzing, and external audit.
   The observed host planner mutations and branch coverage do not fill those
   separate evidence gaps.

Branch coverage measures execution of instrumented source; it does not measure
the probability that an untested financial failure is absent. Mutation checks
are useful when they deliberately remove authority, refund, latching, cap, or
certificate checks and require meaningful tests to fail. Neither a high line
coverage number nor many random cases justifies a fabricated “99% secure” claim.

Known reference limitations are hybrid book routing, mixed-direction maturity
paths, native token transfers/authentication, Fracpack bounds, and WASM runtime
failures. Those require native tests and review of the actual implementation.
Public consensus actions/events and local admin SQL remain inspectable; an
owner-only HTTP DTO is not cryptographic transaction privacy. AuthAny demo
wallets are not production account authentication.
