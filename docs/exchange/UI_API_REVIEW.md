# Exchange UI and API production review

Reviewed 2026-11-21 against the local source. This review covers client request
budgets, accounting presentation, owner isolation and read-model completeness.
It does not replace a native financial audit. Native browser verification is
recorded separately below. Financial matching/solvency code was not changed by
the UI performance fix.

## Fixed: repeated portfolio computation could freeze the browser

The previous asset renderer recomputed every token's proceeds and committed
balance by rescanning positions and finding market/loan records linearly. It
also rendered the Assets table while its account dialog was closed. A platform
with many unrelated native tokens magnified the cost for a wallet with many
positions even if that wallet traded only BTC/USD.

The current [portfolio projection](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/src/portfolio.js:11)
indexes markets, loan metadata, balances and any legacy level IDs once per
snapshot. Each maker/loan/stop row contributes once to per-token maps, then
available/committed lookups are constant time. The native `refund` DTO remains
authoritative; a public depth row cannot replace a wallet's exact entitlement.
The [snapshot integration](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/src/app.js:173)
builds this projection once. Assets DOM is rebuilt only while that account tab
is open, or when the user opens it.

Measured process CPU per projection plus all-token lookups, five interleaved
samples after warmup on this workstation:

| Native tokens | Maker rows | Loan rows | Previous median / p95 ms | Current median / p95 ms |
|---:|---:|---:|---:|---:|
| 2 | 100 | 100 | 1.923 / 3.661 | 0.104 / 0.131 |
| 100 | 100 | 100 | 41.047 / 44.096 | 0.075 / 0.118 |
| 1,000 | 100 | 100 | 286.553 / 290.307 | 0.181 / 0.359 |
| 2 | 500 | 500 | 9.501 / 11.457 | 0.207 / 0.332 |
| 100 | 500 | 500 | 318.726 / 321.666 | 0.186 / 0.348 |
| 1,000 | 1,000 | 1,000 | 11,850.810 / 12,416.537 | 0.550 / 1.024 |

Every fixture has 100 markets and 1,000 public levels; positions use the same
BTC/USD assets across those books. These are deterministic synthetic bounded
snapshots, not a claim about typical customer portfolios. The baseline executes
the actual previous helper source. Every token's exact result is compared on
every run. These numbers exclude DOM, formatting, network, native query work
and matching. With five samples, p95 is the maximum observation, not a precise
tail-latency estimate. The 11.85-second baseline explains a plausible UI hang;
it is not a matching-engine hang.

Reproduce with [bench_ui_portfolio.mjs](/Users/dlarimer/psibase-exchange/demo/bench_ui_portfolio.mjs:1),
which imports the tracked previous helper bodies at
[ui-portfolio-before.js](/Users/dlarimer/psibase-exchange/demo/fixtures/ui-portfolio-before.js:1).
Raw CPU and wall samples, fixture hash and original source hash are in
[ui-portfolio-benchmark.json](/Users/dlarimer/psibase-exchange/demo/ui-portfolio-benchmark.json:1). The three new semantic
[portfolio tests](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/test/portfolio.test.mjs:6)
cover maker/loan/stop sums, foreign owners, paused funding, exact native refunds,
wide integers and legacy floor rounding. There are no timing assertions.

## Fixed in source: market, book and owner pagination

The original review reproduced a funded 101st market missing from first 100 global
snapshots, and a global 1000-level prefix hiding another side or market. Those
were read-model limits, not financial admission limits. The original native
fixture is retained as historical evidence; new native cardinality cases verify
the replacement APIs.

The replacement Exchange-only implementation provides bounded seek pages for
market discovery, separate bid/ask depth, owner orders/loans/lenders/liquidity,
and assets. Exact market, asset and position points bypass catalog prefixes.
Every page includes referenced token/market metadata, an explicit continuation,
and native owner authorization for private data. No shared engine/database/SDK
change is required. Financial planning uses point data and a bounded own-receipt
funding cursor; an incomplete page no longer proves insufficient funds.

The UI has public Load more market discovery and exact-ID opening, independent
buy/sell depth continuations, and an account Positions browser across markets
with optional exact market filtering. Native stop pages remain descending owner
pages; a market filter applies to loaded rows without an unbounded search loop.
Assets have explicit own pages and point token-ID lookup. Late responses are
fenced by account, filter/request epoch and a private-data epoch, including
same-owner point queries that began before a mutation or fresher snapshot.

Live portfolio calculations use only fresh scoped snapshot data. Previously
loaded account pages remain separate point views across automatic polling and
are invalidated after mutations or account changes. Available/reserved values
are labeled as shown subtotals, even if the selected market's page is complete:
other markets may contain proceeds. Unknown reserved values on extra asset
pages are a dash. Bounded funding continuations require an explicit user click;
no automatic all-page draining or unknown-outcome transaction retry is allowed.

## Fixed in source: polling no longer scans the token namespace

An explicitly selected native snapshot skips market discovery and the global
asset page, fetching exact selected-market balances and bounded owner prefixes.
The Assets drawer pages the owner's native balance/pending indexes explicitly.
Public discovery and exact market/book reads no longer construct an owner-zero
full portfolio. Unrelated token issuance therefore does not increase every
visitor's selected-market token metadata scan. The earlier 12-request small-demo
HTTP latency sample was not a load-capacity or server-CPU measurement and should
not be treated as a benchmark of the replacement queries.

The matching Exchange-only service/query/plugin/UI deployment passed native
browser smoke for exact market opening, independent depth expansion, own asset
and position filters, owner switching and cancellation of an exact market 7
order while market 1 was selected. See
[PAGINATION.md](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/qa/PAGINATION.md:1).
Large-cardinality native fixtures are separate evidence; browser automation did
not traverse 1000 owner rows on the two-market live demo.

## Request budgets and privacy

The visible idle page [polls every two seconds](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/src/app.js:999),
pauses automatic polls during financial submission and skips hidden pages.
Normally there is one owner snapshot per cycle. The selected price chart reads
one native candle page (at most 200 bars), at two-second intervals for 5s/15s/1m
or ten-second intervals for 1h/1d. Requests are deduplicated; viewing an older
candle page stops automatic chart replacement. The tape is read only while the
Recent trades tab is selected. Tape loading follows at most five 100-row pages
and retains at most 2,000 prints per visited market. Each native trade page uses
bounded [per-market index seeks and exact event IDs](/Users/dlarimer/psibase-exchange/packages/user/Exchange/service/src/trades.rs:207).
Transfer history and older stop pages are explicit, bounded reads rather than
all-asset scans on every poll.

One remaining tape completeness issue is the five-page catchup cap: if more
than 500 prints accumulated while hidden, the next refresh keeps the newest
500 and advances `after` to the newest event. The missing older part of that
delta is not drained on the following poll. This affects the bounded Recent
trades cache, not the candle chart. The chart now reads a separate native
historical candle service: [completed bars are in prunable event history](/Users/dlarimer/psibase-exchange/packages/user/Exchange/service/src/candles.rs:86), with
one current row per market/interval in objective state. The UI uses opaque event
cursors for older pages, exact native OHLC and volume, and hourly/daily intervals.
Coverage begins at deployment; there is no fabricated backfill or empty-volume
bar. History availability still depends on a node's pruning/retention policy.

Private [HTTP handlers](/Users/dlarimer/psibase-exchange/packages/user/Exchange/query-service/src/lib.rs:132)
require the native authenticated owner; caller-supplied owner/account aliases
must match, and only the native HTTP server may invoke the privileged reader.
Foreign and unknown point stop IDs return the same null result. Public DTOs
exclude owners and private position totals. Native Tokens transfer history is
scoped to the current wallet and exact exchange counterparty; its UI
[normalizer](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/src/token-history.js:6)
rejects another account, token or counterparty and parses native decimal history
amounts exactly.

Account changes immediately clear private DOM and portfolio caches; writes
require a fresh matching snapshot. Native expected-owner preconditions guard
all financial calls, and the platform pins/checks the transaction account.
Submission captures the displayed draft and locks financial controls before any
permission prompt. Only known pre-publication prompts can save resumable intent;
unknown transaction outcomes are not retried. Stale snapshot errors, account-sync
responses and history responses are guarded so an older asynchronous result
cannot overwrite a newer account's presentation. Browser validation has exercised native Host, exact Tokens approvals, denial,
remembered trust, revocation, owner-specific history and a native market trade;
the detailed results and remaining cases are recorded in the QA report.

## Fixed: platform privacy and native compatibility gaps

The wallet reviewer identified two source-backed gaps. Both are now repaired
and deployed. The native [Exchange reader](/Users/dlarimer/psibase-exchange/packages/user/Exchange/query-service/src/lib.rs:150)
binds private requests to the canonical Exchange host as well as checking the
native HTTP sender and authenticated owner. Another app cannot route its own
domain to the reader to bypass Exchange's client permission gate.

Native HTTP now [strips the actual case-sensitive `__Host-SESSION` cookie and
Authorization header](/Users/dlarimer/psibase-exchange/packages/system/HttpServer/include/services/system/HttpServerRequest.hpp:10)
before forwarding requests to an application backend. Ordinary app cookies
remain available; the old uppercase session alias is stripped defensively too.
Exact Supervisor-origin CORS and the native cookie endpoint are also deployed,
with targeted platform regression coverage. Actual Alice and Bob browser
queries now succeed through native Host/Supervisor with port 8090 stopped.
These observations verify specific repaired paths, not every platform API.

## Browser integration status

The native named-account UI, Host Alice/Bob connections, exact native deposits,
approval denial, remembered permission, revocation, owner history and an isolated
market trade, withdrawal and limit placement/cancellation passed browser checks
with port 8090 stopped. The first withdrawal test caught a pre-publication plugin
guard rejecting Tokens-only withdrawals; balances remained unchanged, the
targeted fix was deployed, and a fresh one-off withdrawal passed exact checks. Current
observations and unfinished cases are recorded in
[NATIVE-WALLET.md](/Users/dlarimer/psibase-exchange/packages/user/Exchange/ui/qa/NATIVE-WALLET.md:1).
Do not describe incomplete cases as passed or these checks as a security audit.

## UI/API contribution to the top production blockers

1. Secure spending/upgrade authorities and deployment configuration; complete
   remaining native browser cases and independently audit the platform.
2. Validate the new paged/point read model and bounded funding continuations
   at deployed cardinalities, including independent review of recovery paths.
   Original silent global truncation is replaced in source, not accepted as an
   ongoing production limitation.
3. Provide durable own order/fill/fee/export history and a defined retention
   policy for native historical OHLCV. Native transfer history and browser-local
   action labels are deliberately distinguished from a complete trading audit;
   completed candle history is now native but prunable.
   Validate resource admission, recovery/upgrade controls and financial
   execution with independent review and deployed stress tests.
   The portfolio fix is measured evidence for one client hot path, not a claim
   that the exchange or its platform is production-audited.
