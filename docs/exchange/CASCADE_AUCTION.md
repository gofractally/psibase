# One clearing sale for a stop cascade

This tests the proposed auction semantics. It is not an implemented financial
feature. The live exchange still has ordinary limits and certified margin
liquidations, with no stop-loss action.

## What the proposal can guarantee

For fully funded, one-direction market stops against a fixed monotone routing
curve, start with the initiating input `q0`. Let `P(Q)` be the final marginal
price after selling total input `Q`. Repeatedly include every sell stop whose
trigger is reached by that price:

```
Q_next = q0 + sum(stop.input for stop.trigger >= P(Q))
```

Starting at `Q=q0` makes this nondecreasing. Each changing step adds at least
one previously excluded trigger group, so a finite book terminates. The result
is the **least causal fixed point**: it does not include stops whose own
hypothetical execution is necessary to justify activating them.

For example, a stop at price 90 containing 20 units can hypothetically push a
100/10,000 constant-product relay below 90. With no initiating trade it must
remain armed. Solving only the final self-consistency equation could instead
select that uncaused cascade.

Seal the resulting membership before distributing output. Every included stop
can receive its proportional share of one common **realized average price**.
The final marginal price and the average execution price are different.

## Exact accounting example

Use a fee-free toy relay with 100 base units and 10,000 quote units. Its initial
price is 100. The initiating sale is 10 base units. Stops are 10 units at 90,
20 at 75, and 10 at 60.

| Candidate total sale | Final marginal price | Stops now reached |
| ---: | ---: | --- |
| 10 | 82.644628 | 10 at 90 |
| 20 | 69.444444 | also 20 at 75 |
| 40 | 51.020408 | also 10 at 60 |
| 50 | 44.444444 | no additional stops |

The final reserve change releases 3,333.333333 quote units.

If only stop participants share the auction price, and the initiating order
keeps its counterfactual first-leg execution, the initiator receives
909.090909. The 40 stop units share the remaining 2,424.242424, receiving
**60.606061 per unit**. The two allocations exactly sum to the actual output.
This honors an initiating sell limit of 80 in this example.

If the initiator also joins the uniform-price group, all 50 units instead
receive 66.666667. That is a different rule and would violate that limit of
80. Paying everyone the terminal marginal price of 44.444444 is another rule:
it leaves undistributed proceeds. Define allocation explicitly rather than
calling both prices the clearing price.

`demo/stop-cascade-analysis.json` records exact-rational calculations rounded
only for presentation.

## Batch boundaries still matter

Equal pricing holds inside one sealed cascade. It cannot retroactively alter
completed earlier transactions. With the same relay, stops of 5 at 90 and 5
at 80, and counterfactual first-leg pricing for each initiating trade:

* One initiating sale of 10 puts both stops in one cascade. Both receive
  75.757576 per unit.
* Split it into 6 and then 4. The first sale activates only the 90 stop, which
  receives 84.990651. The later sale activates the 80 stop, which receives
  72.463768.

Final reserves and total output are identical. Allocation differs because
the stop groups joined different batches. This is not an accounting error;
it is a consequence of the selected auction boundary. A time-based batch
would define another boundary, with its own latency and manipulation costs.

## Efficient closure can avoid a linear scan

Order triggers by the cumulative input `R_i` required to reach them. Give a
subtree total stop input `C` and required seed input `H`. Consecutive nodes
combine associatively:

```
C = C_left + C_right
H = max(H_left, H_right - C_left)
```

A complete prefix is reachable exactly when
`q0 >= max_i(R_i - sum_{j<i} C_j)`. Accept a whole subtree when its certificate
passes; otherwise descend to its first barrier. A balanced tree can find the
reachable prefix in logarithmic visits. Native ordered table indices do not
maintain these aggregates automatically; dedicated augmented node records
and lazy range activation are required. Writing every activated pool would
restore linear work despite the faster calculation.

See `experiments/stop-cascade/test_closure.py` for exact integer comparison
against a simple causal scan, including long cascades and multiple roots.

This certificate assumes monotone routing. The current native hybrid router
can skip a bid when a remaining amount is below a base lot. Increasing input
from just below that lot to one complete lot may fill the bid and leave the
relay at a *higher* price. A native implementation must normalize auction
amounts/dust semantics or prove a suitable monotone trigger curve first.
LP changes to the protected product also change thresholds nonuniformly;
cached certificates need rebuilding or a stronger representation.

## CPU budget is not a reliable cascade damper

A huge same-price pool can be cheap on a relay alone. Cost grows with distinct
trigger groups, ordinary book levels, and protected credit boundaries, not
the count of its owners or necessarily its notional size.

Conversely, the smallest valid trade crossing a trigger can activate a pool
which forces more work than the budget. Smaller initiating trades cannot
make that already-funded pool smaller. Atomic rejection can freeze every
sale through that boundary, including arbitrage and protective activity.
It does not remove external market price moves. A resource bound is useful,
but an intended circuit breaker needs an explicit price/work/auction policy
and a liveness path, rather than depending on expensive execution.

## Preserve senior collateral obligations

Do not redistribute certified margin-liquidation proceeds as if they were
ordinary stops. With a 100/100 relay, collateral 10 can sell for 9.090909 and
cover face debt 8. Sharing uniformly with 90 more units of stop input gives
the combined sale output 50, a common price 0.5, and only 5 for that collateral.
The existing guarantee would fail solely because allocation changed.

Retain senior liquidation allocation, or prove a new joint certificate for
every protected cohort under the new clearing rule. Fully funded ordinary
stops introduce no debt, but all proceeds, residual input, and rounding dust
must still remain backed by the market's isolated native token escrow.

## Forecast first, execute margin first

In the current design, a falling-price long liquidation sells BTC collateral
to repay USD, the same direction as a sell stop. A rising-price short
liquidation buys BTC using USD collateral, the same direction as a buy stop.
Price-triggered liquidation therefore reinforces its relevant stop flow.

There is a constructive version of the proposed reordering: calculate the
**joint least closure** of initial input, stops, and newly triggered margin
collateral before committing any of it. Then give the selected margin cohorts
senior execution, preserving their certified relative order, followed by the
initiating order and the common-price stop auction.

For the toy 100/10,000 relay, initial input 10 activates a stop of 10 at 90.
The stop-only forecast ends at 69.444444. This selects a margin cohort with
10 base collateral at 80. Including it ends at 59.171598, activating a further
stop of 10 at 65. A single stop-only forecast misses this additional stop;
the joint closure ends at total input 40 and marginal price 51.020408.

For same-direction long cohorts under a fixed protected product, the existing
debt bound can survive senior-first execution. Let the old certified reserve
for cohort `i` be `U_i`, its collateral `C_i`, and face debt `D_i`. The existing
certificate requires

```
floor(K * C_i / (U_i * (U_i + C_i))) >= D_i
```

Executing selected cohorts first in the same relative order starts each at
`E_i = X0 + sum(previous selected C)`. For a reachable prefix, `E_i <= U_i`.
The same expression at `E_i` is at least its value at `U_i`; native rounded
relay output covers that lower bound. Thus debt remains covered. Exact rounded
borrower surplus is a separate calculation. Buy-side cohorts have the symmetric
argument in quote-reserve units.

The original input must still exist under the final ordering. For example,
an initiating sale of 10 in the toy relay can fully execute with a sell limit
of 80: its ending marginal is 82.644628. If it hypothetically selects a margin
cohort with 20 collateral at trigger 90, executing that collateral first moves
the marginal to 69.444444. The initiating limit now executes zero. Committing
that forecast would manufacture its own trigger. Recompute the feasible seed
and membership, or reject the whole atomic batch.

These are proposed batch semantics. The existing liquidation action processes
currently due cohorts; it does not authorize premature calls based on an
uncommitted forecast. Mixed signed flows, hybrid-book lot effects, execution
limits and resumable batches require their own clearing rules and proof.
