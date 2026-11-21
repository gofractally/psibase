# Native-host UI verification

Verified in visible Chrome at `http://exchange.psibase.localhost:8089/`.
The native Sites service hosts all eight static assets; the local development
wallet bridge handles private state and signed transactions through its
explicit native-origin CORS policy. No browser warnings or errors were
reported during the final verification.

The final tab is Chrome tab **1697463706**, left open and marked as a
deliverable, with Alice, BTC/USD market **#1**, the 5-second Price chart,
and the normal browser viewport restored. The URL has no profiling flag.

## Behavior verified

- Actual native OHLC history loads, with aligned BTC volume bars. Changing
  the interval to 15 seconds and 1 minute changes the actual aggregation;
  empty trading intervals remain empty.
- Depth uses the full responsive plot area and a symmetric current-price
  range. Custom ±0.5% updates immediately, Zoom in selects ±0.25%, and
  Zoom out restores ±0.5%. Fixed maker-price tick marks are absent. Existing
  distant 101,000/102,000 asks do not change the depth viewport.
- The UI shows ordinary limit-order size, remaining size, status, and
  cancellation. Internal matching shares and generations are not exposed.
  A fully liquidated margin position is absent from the active count.
- A new Alice buy limit at **40,000 USD**, size **0.0001 BTC**, previewed
  exactly **4 USD**, submitted successfully through the native-host UI,
  and appeared as an open order. Cancellation confirmed and restored her
  available USD to exactly **151,091.6336**, preserving the pre-existing
  **5 USD** remainder at 99,000. No new test order remains.
- Real maker activity can consume a side of the book; the UI retains only
  actual orders rather than filling empty rows with fabricated liquidity.

## Responsive layout

| CSS viewport | Page scroll width | Ticket right | Account selector right |
|---:|---:|---:|---:|
| 1280 | 1280 | 1251.99 | 1242 |
| 1366 | 1366 | 1338 | 1328 |
| 1440 | 1440 | 1412 | 1402 |
| 390 | 390 | below chart | 375 |

At 390px the chart measures 366px across, with its geometry rebuilt for the
phone viewport. Temporary viewport overrides were reset after checking.
`native-viewport-checks.json` contains the measured desktop values.

Screenshots: `native-candles.jpg` and `native-depth.jpg` show the 1440px
desktop layout; `native-mobile.jpg` shows the 390px phone layout. They
capture actual continuously changing native state.

## Browser update measurements

Optional `?profile=1` instrumentation was enabled only for measurement.
`browser-profile.json` contains structured console entries retrieved through
the supported browser developer-log API. Nine steady updates were recorded
at a 1440px CSS viewport, excluding initial historical backfill.

| Operation | Median | Observed range |
|---|---:|---:|
| Private state fetch + decode | 14.9ms | 14.5–17.4ms |
| New-trade fetch + decode | 29.8ms | 29.3–30.8ms |
| Synchronous state rendering | 4.2ms | 3.3–6.6ms |
| New-history SVG rebuild | 3.9ms | 2.8–5.1ms |
| Private state payload | 4,582 bytes | 4,336–4,582 bytes |
| New-trade payload | 515 bytes | 511–518 bytes |

Every state-render chart check skipped the unchanged SVG. A single chart
rebuild followed each new-history response. Fixing SVG intrinsic sizing
eliminated the previous fractional container-height drift that invalidated
the chart signature. The chart viewport stayed exactly 323px high during
this measurement.

The initial load deliberately fetches up to five 100-execution pages
(approximately 20KB each). Subsequent requests use the exclusive native
`after` cursor. The refresh interval is two seconds; hidden documents pause
automatic work, and trade history additionally pauses outside the exchange
view. These timings measure JavaScript and fetch/decode elapsed time, not
paint/frame latency, transaction execution CPU, or production network load.

All thirteen UI unit tests pass. They cover exact BigInt financial inputs,
capability guards, asset-based ownership conversion, cumulative depth,
native OHLC/volume aggregation, symmetric zoom, and native-host wallet routing.

All funds and identities in these checks are local development-chain demo
assets; no real BTC or USD was moved.
