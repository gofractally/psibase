# Exchange pagination validation

Verified locally on 2026-11-21. The demo is deployed at
`http://exchange.psibase.localhost:8089/`. Changes are confined to Exchange.
Framework source, engine, pssz, psitri and other services were not changed or
deployed. Builds used the previously verified framework source and frozen
`psitest`/packager binaries in `build-exchange-pagination`.

The [API contract](../PAGINATION.md) describes cursor scopes and coverage.
Tables, matching and financial action semantics are unchanged. Public depth is
market/side scoped. Private pages seek only the authenticated owner's prefix.
Every collection has a 1–200 row bound with an explicit continuation, and exact
market, asset and own-position lookups bypass discovery pages.

## Native cardinality fixtures

All fixture rows were created through real native service actions, not inserted
as fabricated database rows. Traversal used 73-row pages and checked unique rows,
final cursor exhaustion, owner identity and referenced market metadata.

| Collection | Created and traversed |
|---|---:|
| Markets | 1,107 |
| Book levels | 1,001 bids and 1,001 asks in the same market |
| Alice's limit-order positions | 2,003 |
| Alice's borrower positions | 1,105 |
| Alice's lender positions | 1,105 |
| Liquidity positions | 1,107 |
| Alice's stop positions | 1,105 |
| Alice's native token assets | 1,007 |
| Pending recipients at a single token | 1,005 |

The last market remained accessible by exact lookup and selected snapshot, with
its native base/quote balance points. An early market's asks did not hide its
bids or a later market's depth. Alice could not read Bob's same-price position.
The asset union jumped past a token's entire recipient group to reach the next
token and a token beyond the old 1,000-token catalog limit.

A realized 2,000-quote-atom maker payout behind more than 2,000 nonpaying orders
was found using bounded funding continuations. Empty early pages explicitly
reported incomplete progress. Its native settlement, a final-market repayment
and cancellation succeeded; the independent custody, share, debt, dust and loan
coverage audit passed. The test auditor now groups rows once instead of
rescanning every global table for each market; its financial assertions remain
unchanged.

Native authority/cursor cases also check anonymous and cross-owner denial,
canonical Exchange host enforcement, Supervisor CORS, private no-store headers,
deleted boundary rows, kind/owner/market cursor mismatches, malformed cursors,
duplicate parameters and invalid page bounds. The original funded 101st-market
reproduction is now an access regression.

## Per-request CPU

Each value below is the median of five warmed native HTTP requests, using WASI
thread CPU clock 3. Setup, traversal of other pages and accounting audits are
outside the interval. Measurements include native request handling and response
encoding; they are observations on this machine, not production latency or
financial-safety probabilities.

| Request (73 rows) | First page | Late page |
|---|---:|---:|
| Market catalog | 55.28 ms | 53.03 ms |
| Own limit orders | 48.47 ms | 47.99 ms |
| Assets, with recipient fanout | 23.21 ms | — |

The late market page starts after 1,022 catalog entries; the late order page
starts after 1,898 positions. These samples show no offset-proportional growth.
Source inspection verifies ordered lower-bound seeks, bounded lookahead and
point joins; funding examines at most 200 rows plus at most three phase
lookaheads. Distinct-token asset pagination never walks all recipients.

## Client and deployment checks

Ten distinct native chain scenarios passed across the pagination and existing
query regressions. The native plugin passed 26 policy tests and a real component build. Planner
tests cover late market/token IDs, partial scan progress without a transaction,
claim caps without skipped receipts, both stop payout assets, account guards and
unknown-outcome handling. Three service host tests cover cursor scope, canonical
encoding, bounds and lossless integer JSON. All 40 UI tests passed, covering page
epochs, opaque cursor forwarding, explicit funding continuation, prompt replay
and exact route/draft precedence. See the
[browser report](../ui/qa/PAGINATION.md) for live checks.

The deployed API passed live traversal with one-market and two-depth-row pages,
exact last-market reads, private position/asset requests, owner denial, CORS and
invalid-limit/duplicate-parameter rejection. The browser placed a $10 order on
market 7, switched the trading view to market 1, then cancelled the market 7 row
from account positions. The reservation was fully restored. No test transfer or
order is pending.

Paged views are deliberately separate from current balance arithmetic. A live
cursor is an exclusive key, not an immutable multi-page snapshot; a refresh is
required for inserts before an already consumed boundary. Scoped balance
projections do not claim full global accrual coverage. Funding preparation uses
exact native points and bounded owner scans instead of deciding insufficiency
from a partial UI page.

## Reproduction and evidence

From the repository root, using the frozen framework baseline already prepared:

```sh
python3 packages/user/Exchange/qa/native_pages.py test pagination_native
python3 packages/user/Exchange/qa/live_pages.py
```

Evidence is in `build-exchange-pagination/`: `provenance.json`,
`exchange-inputs.json`, `deployment.json`, `live-pages.json`, `measurements.json`,
`native-assets-cursors.log`, `native-large-pages.log`,
`native-query-regressions.log`, `plugin-component.log` and
`plugin-workspace-test.log`. The asset and cursor cases completed before an
initial combined run was stopped to rebuild the test-only auditor. The large
fixture and 101st-market cases then completed with the optimized auditor; the
cursor case was also rerun with the query regressions.
