# Verification results

Verified current upstream baseline `db601e572` with the local native exchange
implementation. The frozen exchange package used for the chain and tests has
SHA-256:

```
fcae27df9c083e76d7a11647d51924a25f60ad8970dad5168f3b02345c9aa2c4
```

The financial service's package flags are empty. The separate authenticated
read-only query service has the explicitly reviewed `isPrivileged` flag for
static foreign-table reads. The financial contract receives no such privilege.

## Executed checks

| Check | Observed result |
|---|---|
| Native exchange WASM suite | 16 passed, 0 failed, 1 expected-panic test ignored by the WASM harness; 459.06 seconds |
| Actual-chain scenarios included in that suite | All 11 passed |
| Host execution of exact arithmetic source | All 5 passed, including the boundary panic omitted by the WASM harness |
| Native Tokens tuple-index / lazy-ID regression | 1 passed, 0 failed; other token cases filtered; 128.62 seconds |
| Development wallet construction/security | All 14 Python tests passed |
| UI exact amount / capability / escaping tests | All 7 tests passed |
| Source whitespace/error check | `git diff --check` clean |
| Native node + wallet restart | All four complete financial snapshots unchanged |
| Live deployed state | Two independent books and one active loan cohort passed snapshot checks |

The 11 native chain cases independently reconcile actual native subaccount
cash with every market's expected escrow, relay, maker reserves/proceeds,
lending cash, pledged collateral and closed surplus. They also reconcile
maker shares, borrower units, LP ownership, debt totals and the complete
price-ordered liquidation schedule. The cases cover:

* Native shared-funding revocation, actor isolation, and atomic rollback.
* Hybrid relay/book execution, late joins, coalesced maker positions and dust.
* A pooled liquidation which leaves borrower rows unchanged while actually
  repaying the lender and funding surplus claims.
* Long/short cascades and safe event-budget checkpoints.
* Rejected unsafe relay-capital and lending-cash withdrawals.
* Mutable-token margin rejection and epoch renewal with debt/old claims.
* Both recipient auto-debit configurations and financial-only snapshots.
* Exactly funded aggressive limits without a second debit or invalid fill price.
* Unauthenticated or forged privileged query callers being rejected.
* Independent books for the same token pair.
* Issuer recall of an old spot book, followed by sealing the assets and opening
  a new guaranteed book: the old book stays ineligible and cannot drain the
  new market's native cash.

The wallet tests separately verify implicit settlement, mixed auto-debit
overrides, exact `u64` quantities, partial withdrawals without double counting,
damaged-book isolation, Host/Origin defenses, bounded catalog forwarding,
native login caching, and extraction of requested results from native
transaction wrapper traces.

## Browser and persistence

[The browser QA report](../../packages/user/Exchange/ui/qa/README.md) records
actual confirmed deposits, withdrawals, market and limit trading,
cancellation, borrowing and repayment, lending and redemption, LP additions
and withdrawals, and creation of a separately funded second BTC/USD book.
The seeded 100-unit loan was retained after testing.

Private wallet separation was checked by switching from Alice to Bob. Native
query authentication remained enabled. Desktop widths of 1280, 1366 and 1440
CSS pixels and narrow mobile widths were checked for overflow. The visible
Chrome tab was left open on Alice's BTC/USD book #1. The interface has no
browser console warnings or errors from these interactions.

`demo/persistence-verification.json` contains the four financial snapshot
digests verified before and after a controlled native-node and wallet restart.
The restarted application remains running; startup does not reset balances.

A separate sample of 20 warm authenticated HTTP snapshot requests on the
two-book demo measured median 7.518 ms, p95 7.663 ms, maximum 8.599 ms.
These are local read-only HTTP wall times, **not matcher CPU costs, gas costs,
or a production throughput benchmark**. `demo/query-latency.json` records the
measurement scope.

## Scope of the result

The algebraic proof is a proof of the specified accounting and recovery
transitions; the native tests exercise their integer implementation. Neither
is a machine-checked proof of the entire blockchain runtime or an independent
production audit. Guaranteed credit requires immutable transferable native
tokens, market-isolated custody, fixed face debt and committed relay depth.
Spot-only issuer-controlled books retain the issuer's native recall/freeze
risk and are prevented from contaminating guaranteed books.

The demo uses local AuthAny wallets and native demonstration BTC/USD assets.
No external currency redemption or real bitcoin custody is claimed. See
[the security review](SECURITY.md) for the query privilege, upgrade and
fresh-index deployment assumptions.
