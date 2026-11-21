# Exchange production readiness review

Reviewed 2026-11-21. This is an internal source review with actual-chain
reproductions, not an independent audit or a production release certification.
Financial matching behavior was not changed during the review.

## The three production gates, in priority order

1. **Secure the authorities that can spend and upgrade.** Local users use
   AuthAny. Exchange and Tokens correctly delegate to `root`, which delegates
   to `producers+3`; the sole producer's empty consensus claim makes the demo's
   administrative authority effectively unsigned. Native signing UI does not
   secure those underlying accounts. Require secured users and producer claims,
   independent upgrade controls and tested recovery. Committed native
   subaccounts remain under Exchange authority.
2. **Make execution and account access consistent and complete.** A far-away,
   untriggered stop changes tiny-trade routing. The ordinary route can consume
   input for zero output. Global snapshot caps hide funded markets and owner
   positions; the wallet can then fail to prepare repayment or trading for an
   omitted market. Unify economic rules, replace global prefixes with paged,
   market/owner-scoped queries, and supply durable order/fill records. Independently
   review the financial certificate and define issuer-damage wind-down.
3. **Prove sustainable operation under hostile load.** One funded wallet can
   occupy all 64 stop-price slots, while 128 ordinary prices exhaust new-price
   admission with stops armed. Matching/cancellation remain live; admission is
   denied. Define resource charges, economic commitments or expiry, historical
   storage policy and realistic cold-database/concurrent-load tests. CPU bounds
   alone do not establish fair admission or whole-system capacity.

## Confirmed bugs and performance findings

| Finding | Evidence and effect | Status |
|---|---|---|
| Global query truncation | Actual chain: 101 funded markets exist; both public/private snapshots return 100 and omit the last. Global 1,000-level/owner prefixes also lack cursors. | Open, P1 |
| Routing depends on unrelated stop | Forked native book: sell 99 base atoms returns 9,802 quote without a stop; an untriggered stop at price 50 instead refunds all 99. Best-price maker remains untouched in both. | Open, P2 |
| Zero-output input consumption | Native relay with reserves 2/2 accepts one input atom and returns zero when minimum output is zero. | Open, P2 |
| Browser portfolio repeated scans | Synthetic maximum bounded snapshot: median helper CPU 11,850.810 ms before, 0.550 ms after; exact token results compared. Five samples; excludes DOM/network/server. | Fixed in UI source |
| Public query waste | `/markets` constructs an owner-zero private/native-token snapshot before dropping private fields; unrelated token issuance increases each visitor's read work. | Open |
| Candle gap after inactivity | Catchup is bounded to five 100-print pages, then advances its high-water mark; larger gaps can lose intermediate history from the browser chart. | Open |

All three new native reproductions pass the separate physical escrow/share
audit. This distinguishes balanced token accounting from correct execution and
complete access to owned positions. No new quantity-solvency counterexample was
found. External BTC/USD redemption, public-chain confidentiality, privileged
upgrade safety and execution during outages are outside that quantity guarantee.

## Evidence and limits

* [Native authority, financial and custody review](NATIVE_WALLET_REVIEW.md)
* [UI/API review and measured CPU distributions](UI_API_REVIEW.md)
* [Three actual-chain reproduction results](../../demo/review-native-tests.json)
* [Reproduction fixtures](../../packages/user/Exchange/service/src/review_reproduction_tests.rs)
* [Earlier bounded-cascade validation and measurement limits](STOP_VALIDATION.md)

The new reproductions cover specific failures, not all global-cap variants.
The earlier 96.38% branch coverage belongs to the extracted stop planner only;
it is not coverage of the whole native service, runtime, wallet or browser.
No justified numeric probability of financial safety follows from these tests.
Unrelated, unfinished BTC/Ethereum bridge work in the shared checkout was
excluded from this review and the isolated Exchange build manifests.
