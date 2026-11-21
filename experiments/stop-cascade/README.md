# Stop-cascade closure experiment

This is a **design proposal experiment**, not production exchange code or a
deployed-contract test. It does not access the chain, native database, or network.
The implemented exchange does not yet provide these stop-auction semantics.

Run with Python 3.10 or later; no dependencies are required:

```sh
python3 experiments/stop-cascade/test_closure.py
```

The suite compares the tree with an exact-integer linear causal reference in
25,600 deterministic random cases, checks its node-visit bound, and activates a
65,536-level domino cascade using one root-summary read. It also checks inclusive
boundaries, an unreachable gap, associativity, multiple fixed points, and a
separate mathematical lot-routing counterexample. Building the tree is O(n);
the logarithmic claim concerns closure discovery using maintained summaries.

## Assumptions and proof

For one sale direction, freeze a deterministic liquidity snapshot whose
reference price is nonincreasing with cumulative sale. Order distinct trigger
levels downward. Let `R_i` be the exact cumulative sale needed to reach trigger
`i`, including the declared integer rounding and inclusive boundary rule. Let
`c_i >= 0` be its fully funded, unconditionally executable stop input. Compatible
owners at one trigger are aggregated; owners are not visited by this experiment.

With initial executed seed input `q`, trigger `i` is reachable after the earlier
triggers exactly when

```
q + sum(c_j for j < i) >= R_i.
```

Thus an entire ordered block has summary `(C,H)`, where `C` is its total stop
input and `H = max_i(R_i - earlier_input_within_the_block)`. Concatenation is

```
C = C_left + C_right
H = max(H_left, H_right - C_left).
```

This is associative: three blocks require the maximum of `H_1`, `H_2-C_1`, and
`H_3-C_1-C_2`. An incoming available sale at least `H` reaches every trigger in
the block, after which the available sale increases by `C`. Otherwise descend
left first, and visit the right child only after accepting all of the left.
There is only one failing root-to-leaf path, plus its accepted siblings: at most
`2*height+1` summary reads. A balanced tree therefore finds the maximal reachable
prefix in O(log n), independently of how many trigger levels that prefix holds.
Binary searching a prefix-summary query is an alternative O(log² n) algorithm.

The causal qualifier matters. With seed 5, threshold 10, and stop input 20,
including the stop yields a self-consistent final sale of 25. But the seed never
reaches 10, so that larger fixed point cannot start. The tree selects the least
causal closure and cannot finance crossing a gap with stops behind that gap.

## Maintenance and native implementation limits

Native ordered indices alone do not maintain these summaries. A proposed native
implementation needs an explicitly augmented balanced-tree `NodeTable`, checked
sum bounds, and atomic updates of summaries and lazy range tags. In the usual
fixed-product, fixed-route model, thresholds have the form

```
R_i = required_relay_reserve_K(trigger_i) - current_relay_reserve
      + ordinary_bid_input_strictly_before_trigger_i.
```

Changing stop input updates ancestor `(C,H)` summaries in O(log n). Changing bid
depth adds a constant to the affected threshold suffix, permitting a lazy range
update. Changing the current relay input reserve gives a common threshold shift.
Same-price trigger/fill priority must be specified before choosing suffix bounds.
Changing relay product `K`, as an LP resize can do, changes thresholds differently
at different prices. The two-number certificate does **not** make that update
logarithmic: rebuild in O(n), bound admission, or prove a richer representation.

The test's lot counterexample is a warning about applying the monotone premise
to the existing router. With product `10^10`, reserves `(10,000,1,000,000)`, a
funded bid at tick 100, and a 100-atom input lot, selling 99 atoms skips that bid
and moves the relay down. Selling 100 instead fills the bid and leaves the relay
unchanged. The larger input has a higher final relay price. This is a standalone
math model of the branch, not a live-chain regression. An auction needs a proved
lot/dust policy before treating arbitrary atom inputs as a monotone curve.

Discovery is not execution. To avoid O(k) writes for k activated stop levels, a
future design must freeze the prefix under a common auction generation, retain
old owner-generation membership, and resolve individual claims lazily. A split
tree with sealed-root batch metadata is one possible approach. Merely finding
the prefix quickly and then updating every stop pool loses the bound. Ordinary
maker fills, margin cohorts, and their native accounting also need their own
cost analysis; none is accelerated or modified by this experiment.

## Economic and liveness boundaries

Fully funded market stops with a common execution policy fit the model.
Stop-limit participation depends on execution price and cannot automatically
contribute its whole amount. A marketable initiating limit contributes only
executable input, and its price protection must survive any redistribution.
The final marginal price and a common proceeds-per-unit average are different.

Current margin liquidations use the relay directly, while ordinary trading uses
hybrid book/relay routing. They cannot simply be inserted into one scalar curve
without a new proof. Giving protected collateral a common price can also break
the existing solvency guarantee: a 100/100 constant-product relay pays about 9.09
for collateral 10, covering debt 8; combining it with another 90 units pays 50
total, and a common average gives that collateral only 5. Preserve senior margin
allocation or certify all included obligations jointly. Opposite-direction flow
and maturity-triggered liquidations require further analysis.

CPU-budget abortion bounds work, not liveness. Thresholds `R_i=i` with `c_i=1`
produce an arbitrarily long cascade when seed 1 reaches the first threshold.
Smaller steps cannot cross that first threshold without activating the cascade.
The certificate makes discovery cheap in this example; it does not prove the
remaining execution and accounting work fits a native transaction.
