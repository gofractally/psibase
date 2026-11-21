# Pooled stop orders: design proposal

This is a proposed extension, not an implemented exchange feature. The current
service, UI, solvency tests, and liquidation guarantee do not include stop orders.
No financial API or deployed state was changed for this proposal.

The useful extension is to aggregate fully funded conditional orders by trigger
price and execution policy, just as the exchange aggregates ordinary orders by
price. Triggering or executing a pool must not enumerate its owners. An owner's
deposit, cancellation, and proceeds claim access that owner's position directly.

## Native records and indices

Use native Psibase tables; the following are proposed records, not reserved
table numbers. Prices, quantities, and arithmetic must retain the checked bounds
used by the existing exchange.

| Record | Fields and native key | Purpose |
| --- | --- | --- |
| `StopPolicy` | Primary `(market, policy_id)`; immutable direction-compatible execution kind, execution limit or common slippage rule, expiry class, trigger rule, fee schedule | A small bounded set of policies prevents arbitrary per-order conditions from defeating aggregation. |
| `TriggerBook` | Primary `(market, direction, priority_tick, policy_id)`; `generation` | One armed pool per trigger and policy. For sell stops use `priority_tick = u64::MAX - trigger_tick`; for buy stops use `priority_tick = trigger_tick`. Scope every range lookup to the market and direction. |
| `StopPool` | Primary `generation`; market, direction, trigger tick, policy ID, state, remaining input `U`, unpaid output `H`, shares `S`, output index `A`, dust, activation sequence | The pool alone participates in routing. State distinguishes armed, triggered, executing, and finished. The generation ID is never reused. |
| `StopPosition` | Primary `(owner, generation)`; owner, market, direction, trigger tick, policy ID, shares `s`, output debt `D`; optional secondary `(owner, market, direction, trigger_tick, policy_id, generation)` | Coalesces the same wallet's contributions within a generation and supports bounded own-position pagination. Including the generation preserves old claims when a new pool starts at the same price. |
| `StopWork` | Primary `(market, activation_sequence, generation)`; continuation and prepaid work balance | Makes activated work resumable without fetching owner positions. Use a deterministic tie rule for pools activated by the same crossing. |

All stop input is committed through the existing native token funding path into
that market's isolated token subaccount. A revocable free user-to-exchange credit
is insufficient backing for a stop. Existing damaged-book cache checks and the
sticky eligibility rules for guaranteed credit still apply.

An armed pool has not executed anything, so input atoms can initially mint the
same number of shares: `U = S`. Adding input to the same owner's armed position
coalesces it; it does not create a new queue position. Trigger activation seals
the generation against further deposits. Subsequent deposits use a fresh armed
generation, or are immediately activated/rejected if their condition is already
true, according to a documented placement rule. They cannot share proceeds
earned before their deposit.

Pools must be homogeneous. A market stop and a stop-limit order cannot share an
execution policy. Neither can two incompatible execution limits, expiry rules,
or trigger sources. A common relative slippage rule can be fixed against the
same activation reference for every member. Unbounded user-defined policies or
expiry timestamps would recreate a separate pool for every order.

## Trigger and execution semantics

A sell stop activates on a specified downward crossing; a buy stop activates on
an upward crossing. Specify inclusivity at the trigger tick and the behavior of
an order placed while the condition is already true. Define the reference
precisely: relay marginal price, last execution price, or a separate oracle are
different contracts. The public HTTP book or an external UI feed must never be
the consensus trigger source.

For a native price-path rule, inspect actual committed price-changing segments,
including fills at a fixed book price and relay motion. Integer tick boundaries
must use conservative exact arithmetic. Stop-induced trades can activate more
stops, so their price path follows the same rule. A trigger is latched: a later
price retreat does not silently re-arm the same generation.

At activation, move the generation from `TriggerBook` to `StopWork` and freeze
its membership. A pool-aware router spends input through the relay and ordinary
price levels, respecting the existing certified margin-liquidation boundaries,
and retains output in stop escrow instead of paying individual owners. It
updates one `StopPool` per execution segment, not its individual positions.
Different trigger levels keep the declared deterministic priority; identical
trigger and policy members share execution proportionally.

For output-index scale `Q`, allocate output received by advancing `A` and
carrying integer remainder as dust. An owner's unpaid proceeds are
`floor((s*A-D)/Q)`. Unspent input is allocated from `U` by the same share rules
as the existing pooled book. Claims update `D` while retaining fractional
entitlement. Full exits move discarded fractions into pool dust, and the last
settlement handles all remaining atoms explicitly. No dust can be counted both
as a user's claim and as free exchange or lender cash.

Cancellation before activation refunds committed input and removes shares. Once
triggered, the simplest deterministic policy permits cancellation of the
unexecuted remainder between bounded execution chunks, while preserving all
already earned proceeds. A transaction that has already executed cannot be
undone. A stricter policy may lock cancellation until that activation batch is
finished; that restriction must be explicit. In either policy, cancellation
touches one owner position and one pool, never other owners. Do not overwrite a
closed generation's claim when the owner places another stop at the same price.

## Solvency and the meaning of a guarantee

For each market and token, extend the existing physical-cash identity with the
sum of that token's unspent stop input and unpaid stop proceeds:

```
native market subaccount balance =
    existing relay, book, credit, and claim liabilities
  + stop input escrow
  + stop output escrow
```

These are disjoint accounting categories, not new cash. Arming a stop increases
physical escrow and its input liability by the same amount. Within the input
asset, a fill transfers an equal amount from stop input escrow to the relay
reserve or counterparty's accrued proceeds. Within the output asset, it
transfers an equal amount from the relay reserve or counterparty's order
escrow to stop output escrow. No physical cash changes during those internal
reclassifications. A claim or refund
decreases physical escrow and the corresponding stop liability equally.
Triggering changes classification only. Checked rounding and explicit dust
preserve the integer identity. Each ordinary action still rejects externally
depleted native escrow before it mutates the book.

Fully funded stop orders therefore need no new loan liability. They must use the
same margin-safe router: stop flow cannot consume backing already reserved by
the liquidation certificate. Any proposed shortcut that bypasses those relay
boundaries would invalidate the existing proof.

Activation is not a guaranteed execution price. A market stop may execute at a
worse price after a gap; a stop-limit may remain partly or wholly unfilled. A
minimum-output condition can prevent a bad fill but does not create liquidity.
Execution also requires someone to submit a valid transaction with a sufficient
resource budget.

An optional **guaranteed minimum-output stop** would require a new joint
certificate over all protected obligations, including margin cohorts and stop
pools. Reserve irrevocable relay capacity, assign deterministic priority across
both kinds, and certify the cumulative worst-case path after earlier protected
obligations execute. LP withdrawals, new loans, new guaranteed stops, and every
ordinary trade must preserve that joint certificate. Cancellable ordinary limit
orders cannot count as irrevocable backing. The same capacity must never be
pledged independently to a loan and to a stop.

That optional certificate needs a new proof covering direction changes,
stop-induced cascades, rounding, and cancellation. The existing margin-only
certificate cannot simply be relabeled as covering stops. Reserving guaranteed
capacity also has an economic cost: less depth is available for ordinary users,
and LP withdrawals may be restricted more often.

## CPU bounds, priority, and liveness

Native ordered keys locate the next relevant trigger without scanning owners.
Processing cost grows with trigger pools and actual liquidity levels visited,
plus index operations; it does not grow with the number of wallets sharing a
pool. This is the same advantage as pooled ordinary orders.

Pooling does not prevent an attacker from creating many small pools at distinct
ticks. Bound resources per market, not per wallet: wallet creation is cheap.
Use all of the following as appropriate:

* A maximum number of active trigger/policy buckets and a small allowed policy set.
* Minimum lot/value per new bucket, with a documented valuation rule.
* A storage deposit and prepaid processing allowance per bucket; make activation
  work charges nonrefundable where necessary so cancellation cannot recover the
  cost after forcing work. A token-denominated allowance needs an actual keeper
  payment mechanism; it does not automatically pay native CPU charges.
* Explicit maximum trigger activations and routing transitions per action.
* A deterministic continuation and keeper incentive for unfinished work.

There is a real contract choice when a price move crosses more stops than the
transaction can process:

1. **Immediate strict priority:** no trade advances past unprocessed protected
   triggers. The action must stop at a safe boundary or reject until a keeper
   processes work. Bound market admission tightly enough that tiny buckets
   cannot cheaply freeze trading. Never stop inside a state that violates the
   existing margin guarantee.
2. **Queued best-effort execution:** crossing durably activates stops, and bounded
   keeper batches execute them later. Other activity may obtain liquidity first;
   immediate price priority is weaker. A bounded queue or an explicitly designed
   range-activation structure must record every crossing, including a wick that
   reverses before the keeper runs. Checking only the current price loses such
   triggers.

An arbitrary number of immediate-priority triggers, constant taker cost, and
uninterrupted trading cannot all be promised together. Prepayment assigns the
economic cost; it does not remove the finite per-transaction execution bound.
Stopping a user's large market order at a work boundary also needs explicit
partial-fill/refund semantics rather than an accidental all-or-nothing rollback.

## Wicks, oracles, and privacy

A native spot-price trigger can react to a brief wick or flash trade that then
reverses. An actor may deliberately push through known trigger depth. Pooling
removes the race between equal-trigger owners but does not remove transaction
ordering, sandwiching, or manipulation incentives.

A TWAP or external oracle can require longer-lived price evidence, at the cost
of observation storage, freshness checks, keeper updates, delayed activation,
and additional trust or manipulation assumptions. A TWAP crossing is not proof
that the relay offers that execution price. Expose the trigger rule separately
from the execution limit, including stale-oracle behavior.

The exchange API should return only the authenticated owner's stop positions,
claims, and order statistics. Public ordinary depth remains aggregated by price.
Whether armed conditional depth is published is a separate explicit policy:
publishing it advertises future forced flow; keeping it out of the API does not
make consensus state cryptographically private.

The present privacy audit has these concrete boundaries:

* [Native query authorization](../../packages/user/Exchange/query-service/src/lib.rs)
  requires `http-server` as caller, requires an authenticated user for private
  snapshots, and rejects a different requested owner. The financial
  [snapshot action](../../packages/user/Exchange/service/src/lib.rs) also requires
  `owner == get_sender()`.
* [Snapshot projections](../../packages/user/Exchange/service/src/snapshot.rs)
  now allowlist public level fields and compute own-position loan entitlements.
  Serializing even an owner's shared raw loan generation would expose other
  borrowers' totals in that cohort; merely filtering generation IDs was
  insufficient. Public market health totals are aggregates, not per-owner rows.
* The public [trade DTO](../../packages/user/Exchange/service/src/trades.rs)
  omits account identity. However, the existing `traded` event is explicitly
  `history, public` and contains `owner`. Its historical signature is unchanged.
  Signed consensus actions also identify their actor. API minimization is not a
  claim of anonymous transactions or hidden on-chain balances.
* [REvents](../../packages/user/Events/src/REvents.cpp) restricts generic HTTP
  `/sql` to native admins. [XAdmin](../../packages/local/XAdmin/src/XAdmin.cpp)
  treats a direct loopback socket as admin; an unauthenticated local read-only
  probe of `events.psibase.localhost:8089/sql` successfully selected `owner` from
  `history.exchange.traded`. Public event schemas are also readable through
  service-to-service SQL; [SchemaCache](../../packages/user/Events/src/SchemaCache.cpp)
  distinguishes public from private event types, not individual fields.
* The loopback [development adapter](../../demo/bridge.py) can select any allowed
  AuthAny demo identity. Host and Origin checks constrain browser access but do
  not authenticate a person. It is a local development wallet, not a production
  privacy boundary. Production clients must use authenticated native identities.

Do not add public owner indices or public owner-bearing stop events merely to
simplify UI queries. Prefer authenticated native owner-prefix reads. This limits
the exchange API's disclosure without claiming secrecy from validators, node
administrators, or inspection of consensus actions.

## Validation required before implementation can be advertised

Actual-chain tests must reconcile stop escrow against native market subaccounts
and existing liabilities after every action; test both native AUTO_DEBIT modes,
revocation of uncommitted funds, immutable-asset eligibility, rollback, and
externally damaged isolated spot books. Compare multi-owner pooled execution
with an exact integer reference, including rounding dust and repeated claims.

Test trigger equality, gaps, reversal after activation, cascades in both
directions, placing a new generation before old claims are collected, and
cancellation between execution chunks. Test every work bound with many distinct
small buckets and verify that resumptions neither skip nor duplicate work.
Privacy tests need two owners in the same pool, not only different pools.

Guaranteed stops additionally require adversarial joint-certificate tests with
loans, LP withdrawals, and opposing cascades, plus an independent proof review.
Until then, the documented exchange guarantee remains the implemented margin
guarantee alone.
