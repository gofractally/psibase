# Stop-auction validation and measured cost

The bounded stop-market auction is implemented and the tested financial/query
WASMs have been deployed to the local native Psibase exchange. This report
separates source-level reasoning, actual-chain behavior, host coverage and
measured per-transaction cost. It is not an external audit or a numerical
probability that the system is secure.

The implementation contract and cash proof are in
[CASCADE_AUCTION.md](CASCADE_AUCTION.md), [STOP_LOSSES.md](STOP_LOSSES.md) and
[SECURITY.md](SECURITY.md). Earlier package/test records are retained in
[VERIFICATION.md](VERIFICATION.md) as historical evidence.

## Native correctness and provenance

The authoritative result is [stop-native-tests.json](../../demo/stop-native-tests.json):

| Run | Result | Actual-chain fixtures |
| --- | --- | ---: |
| Complete Exchange WASM suite | 53 passed, 0 failed, 5 expected-panic cases ignored | 27 |
| Additional interleaved-owner and maximal mixed benchmarks | 2 passed, 0 failed | 2 |
| Unique passing tests across those runs | 55 | 29 |

The five expected-panic arithmetic/admission/minimum-output cases skipped by
the aborting WASM harness pass in the actual-Rust host harness. The full suite's
943.28 seconds and the additional run's 271.45 seconds include boot, funding,
fixture construction and audits; they are **not transaction CPU costs**.

[Full-run provenance](../../demo/stop-native-source.json) and
[additional-run provenance](../../demo/stop-additional-native-source.json)
record source, tester and packager hashes. Only `stop_benchmark_tests.rs` changed
between these runs; production financial/query source was identical. Generated
local logs are `demo/stop-final-native-tests.log` and
`demo/stop-additional-native-tests.log`; the versioned JSON retains their
fingerprints, results and raw timing samples.

Every native fixture uses real Tokens funding and checks native subaccount
cash against independently summed liabilities. Checks include maker and stop
shares, borrower units, lender/LP ownership, debt totals and the complete
remaining liquidation schedule. Covered cases include:

* Coalesced owner positions, generation replacement, foreign/replayed claims,
  exact refunds/output, rounding dust and unchanged execution-time owner rows.
* A one-atom initiating trade activating 64 distinct stop prices; legal active
  price caps and cancellations remaining available at capacity.
* Limit and minimum-output protection forcing causal fallback, and opposite
  flow returning a still-crossing limit remainder instead of posting it.
* Full-principal/output bounds, zero/sublot outcomes, permissionless retirement
  of exhausted makers, and terminal retirement surviving old-owner exits.
* LP changes making a stop threshold unreachable above `MAX`, without blocking
  trading, processing or cancellation.
* Both-direction maturity paths and maximal 64-stop/64-loan/128-book fixtures.
* Native funding revocation, auto-debit variations, damaged-book isolation,
  unsafe withdrawals, authenticated private pagination and owner-free public
  tape projections backed by the native history index.

## What was timed

[stop-native-benchmarks.json](../../demo/stop-native-benchmarks.json) contains
raw samples, metadata, source-log hashes and distributions. Measurements were
recorded on an Apple M5 Max running macOS 26.3.1. Each repeat forks identical
funded native state and block time. Boot, funding, fixture cloning and the
post-action full audit are outside the timed push.

Three measurements have different scopes:

* **Process CPU:** direct WASI clock 2 around the complete tester push, including
  host worker threads and interpreter/caller overhead.
* **Calling-thread CPU:** direct WASI clock 3 over the same push; retained in the
  JSON independently of process CPU. Nested clock reads add small overhead.
* **Native billable/watchdog time:** the native trace's accounting interval.
  On this macOS build it is monotonic elapsed time, with some runtime work
  paused out; on Linux its clock source is thread CPU. It is not interchangeable
  with either complete-push CPU or wall time.

The report also retains complete-push elapsed time and inner-action counts.
[The clock smoke test](../../demo/cpu-clock-smoke.json) confirms the native
process/thread clocks distinguish CPU work from sleeping. None of these
measurements is an isolated matcher instruction count or a blockchain gas fee.

## Same-price owner distribution

The interleaved benchmark prepares all three fixtures before timing, warms
each twice, then rotates six deterministic execution permutations. It records
64 timed forks for each owner count: **192 per-transaction samples**. Total
funded stop input is always 25,600 atoms at the same price, and initiating input
is always 10,000 atoms. Every sample has identical financial output and planner
work, unchanged owner rows and a complete native-cash audit.

| Owners sharing the price | Samples | Process CPU median, ms | Process CPU p95, ms | Native watchdog median, ms | Planner work |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 64 | 143.323 | 150.316 | 82.623 | 233 |
| 16 | 64 | 116.095 | 122.055 | 82.801 | 233 |
| 128 | 64 | 115.666 | 124.873 | 82.7715 | 233 |

The native watchdog interval is effectively flat in these fixtures, and CPU
cost did not grow with owner count. The one-owner fixture nevertheless has
higher whole-push CPU. That difference remains unexplained by this experiment
and lies outside the nearly equal billable intervals. Do not infer that adding
owners makes matching faster, or assign a causal matcher speedup to the gap.
The code's absence of owner enumeration and constant work count are separate
structural evidence.

These are repeated controlled fixtures, not 192 different real market states.
They do not establish production latency, an economic-profit distribution, or
a performance comparison with FIFO. Interleaving reduces run-order confounding;
it does not eliminate runtime, fixture or cache differences.

## Capacity and minimal-seed stress cases

| Initial state / entry point | Samples | Process CPU median, ms | Process CPU p95, ms | Planner work |
| --- | ---: | ---: | ---: | ---: |
| One-sided 64 stops, 64 loans, 128 book prices | 12 | 471.0875 | 507.545 | 19,810 |
| Maximal mixed maturity, `process`, no seed | 12 | 545.1105 | 615.183 | 18,880 |
| Same maximal mixed maturity, one-atom sell, seed budget 1 | 12 | 572.7165 | 643.147 | 18,893 |

The maximal mixed fixture has 32 long and 32 short cohorts, 32 sell and 32 buy
stop generations, and 64 bid plus 64 ask levels. All 24 mixed samples close
all 64 loans and stops, consume all 128 ordinary levels, produce two funded
stop batches, leave owner/borrower rows unchanged and reconcile exact cash.
No persistent market lock or owner loop is needed. The one-atom case shows why
a small initiating quantity does not imply a small automatic cascade cost.

At 12 samples, the reported nearest-rank p95 is the largest observed sample.
This is a small stress sample, not a reliable production tail estimate. These
are measured transactions within the explicit admission bounds, not proof that
every permitted state completes within a universal time on every machine.
The seed's `max_events` does not cap total automatic stop/margin work.

## Host coverage, mutation checks and independent models

[stop-host-tests.json](../../demo/stop-host-tests.json) records 25 passing host
Rust tests, source/runner fingerprints and four detected mutations in actual
Rust code: missing minimum output, an incorrect inclusive trigger boundary,
a wrong common-claim denominator and a missing refund-backing decrement.
The harness extracts production planner/math source and the native claim
arithmetic block; it does not substitute another routing implementation.

The planner-only coverage denominator excludes test helpers:

| Instrumented host planner measure | Covered |
| --- | ---: |
| Regions | 670 / 675 = 99.26% |
| Branch outcomes | 133 / 138 = 96.38% |
| Lines | 406 / 409 = 99.27% |

Branch instrumentation uses experimental host-only Rust coverage flags; deployed
WASM compilation is unchanged. The report lists the five unexercised defensive
branches and their rationale. These figures are **not whole-native-service or
deployed-WASM branch coverage**. KV authorization, Tokens transfers, serialization,
runtime metering and HTTP privacy rely on the separate actual-chain tests and
review. Source extraction also uses a host adapter for wide-value storage.

The independent Python reference model passes 17 tests and detects eight
model mutations, with its own assumptions and exclusions documented in
[the independent review](../../experiments/stop-cascade/SECURITY_REVIEW.md).
That result checks the model, not native WASM. The augmented-tree experiment
is another separate proposal, not an implementation or complexity claim about
the deployed bounded planner. Host/native overlapping tests are not added
together to manufacture a larger unique-test count.

## Deployment and client trust boundary

[stop-deployment.json](../../demo/stop-deployment.json) records the deployed
financial/query artifacts and four-wallet state preservation. The financial
WASM SHA-256 is:

```
e3431919968b9e7488f8642bd77010fefe64dbfe8b772acbf5d64cfdf62c7a11
```

The query WASM is
`09c4ed4f920c75d62971495fac4efade7a789be52951e7d1c5886f3de7e7f0f6`.
Their schemas identify `exchange` and `exchange+1`, respectively. The financial
service has no privileged flags. Only the reviewed read-only query service has
`isPrivileged`, with native HTTP caller and authenticated-owner guards.

The application uses native Sites at
`http://exchange.psibase.localhost:8089/`. Native stop execution history is
indexed and the account-hosted UI has been published. Live browser checks cover
both stop directions, same-owner top-ups, cancellation, actual triggering,
private views and implicit realization during exact two-asset withdrawals.
Minimum-size validation now gives a plain amount before submission. The final
development suites pass **57 Python tests and 16 UI tests**; see
[the stop UI QA record](../../packages/user/Exchange/ui/qa/STOPS.md).

The final UI-corrected package SHA-256 is
`470c870e11e041c5e32c6a2f478f6dfffa303ec87a98b0ad51d4989f4a5ec53a`.
The minimum-size UI fix changed no financial/query WASM or schema bytes.
[Restart verification](../../demo/stop-persistence-verification.json) preserves
all eight known wallets' financial snapshots exactly, including active stops
and the secured loan. The background trader was restarted and actual native
prices continued changing. The browser is left on Alice's main BTC/USD market
with two funded stops, one long, candles and volume. The preview-height fix
removed the forced 925px order-panel minimum; its measured page is 713px shorter.

This remains a local AuthAny demo with a loopback development wallet adapter,
not a completed production native-wallet integration. The adapter controls its
allowlisted demo identities; its selector is not separate-user authentication.
On-chain actions still derive ownership from the native sender. A production
client must replace the development signer with an authenticated native
wallet/plugin. API owner minimization does not hide public consensus actions
or state from validators and native operators. The BTC/USD tokens are native
demonstration assets, without a promised external redemption peg.

## Confidence and remaining work

Evidence is **strong for the specified bounded transitions under their stated
assumptions**: exact token conservation and floor-claim inequalities, native
rollback/ownership tests, coverage of actual Rust planner branches, targeted
mutation failures, and funded maximal-state progress tests agree.

Overall production confidence is **moderate**, pending external review and
operational validation. This is not a formally verified blockchain or a
fabricated percentage of financial correctness. Remaining work includes cold
or large historical database behavior, production-node/compiler/hardware
measurements, broader stateful fuzzing, whole-native branch coverage,
transaction/resource-fee economics, capacity occupation and storage growth,
upgrade/key security, real wallet integration and independent security review.
The guarantee also assumes intact native-token custody, immutable transferable
margin assets, fixed face debt, the certified committed relay and trusted runtime
semantics. Price manipulation, ordering, stop slippage and LP inventory risk
remain economic risks even when every cash invariant holds.
