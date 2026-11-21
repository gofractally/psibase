# Bounded native pagination browser QA

Verified 2026-11-21 at `http://exchange.psibase.localhost:8089/` in Chrome tab
1697463706, after the Exchange-only deployment recorded in
`build-exchange-pagination/deployment.json`. The development wallet bridge on
port 8090 remains off. No engine, shared SDK or platform change was required.
The final UI build and all 40 unit tests pass, including the route/draft follow-up.

## Browsing and privacy

- Direct `/?market=7` selected the exact native market. The Markets screen
  displayed the actual two live books (IDs 1 and 7); opening ID 1 through its search
  form selected the main market. The live catalog fits one UI page.
- The nearest 14 orders on each side appeared by default. More sell orders
  expanded to 20 asks and More buy orders to 24 bids, independently. Expanded rows
  survived automatic two-second polling, were labeled as a last-query page view,
  and Refresh depth restored current nearest rows.
- Native Assets loaded owner records and exact token-ID 2 lookup. Available and
  reserved columns explicitly say **shown**. The note explains that wallet/cash
  points are exact at their last query, while the projected position subtotal
  covers the selected market plus recent owner-global stops. Other markets or
  further pages may add proceeds; no full-portfolio total is claimed.
- Positions displayed limit orders, margin loans, lending, liquidity and stop
  orders across markets, with referenced token and market metadata. Alice's
  all-market margin view showed 400 USD owed in market 1. Filtering market 7 returned
  zero rows. Liquidity discovery included Alice's market 7 position.
- Native Bob selection replaced private rows/assets with Bob's own data. His
  armed stop showed 0.0025 BTC versus Alice's 0.005 BTC; his USD wallet/available were
  800000/199950, distinct from Alice. Switching back restored Alice. Loaded
  position pages are separate from the live funding calculator and are discarded
  on account changes or financial mutations.

## Exact-target financial proof

With Alice and quiet market 7 selected, a native limit buy of 0.0001 BTC at
100000 USD reserved exactly 10 USD:

| State | USD wallet | USD available shown | USD reserved in market 7 |
|---|---:|---:|---:|
| Before | 799999 | 151374.3009 | 0 |
| Order placed | 799999 | 151364.3009 | 10 |
| After cancellation | 799999 | 151374.3009 | 0 |

The new order was located through account Positions → Limit orders → market 7.
The underlying trading selector was then switched to market 1. Its cached account
page still displayed the market 7 order. Cancelling that row completed natively,
targeted market 7, and refreshed its filtered account page to zero rows. This
checks that a row's exact target market is used instead of the current trading
market. Existing main-market commitments remained 5 USD and 0.025 BTC. BTC wallet 8,
BTC available 2.46478972 and USD wallet 799999 remained unchanged throughout.

## Layout and native candle history

At 390×844 the Assets dialog measured 370×767, and document width remained 390px.
Temporary viewport overrides were reset. Hourly candles showed both a completed
hour and the current hour, with actual BTC volume and UTC labels. Older 5s candle
navigation loaded a historical native page and Latest returned to the live page.
This completes the older-history observation that lacked enough live bars in
the initial wallet-integration run.

The browser was left under Alice on main market 1, Spot/Market, with the live 5s
candlestick chart and volume visible. No approval or money operation is pending.

## Coverage limits

The live demo has two markets and fewer than 200 records per displayed owner
family. UI Load more controls for native multi-page portfolios therefore were
not exercised against 1000 records in this browser. Separate native chain
cardinality/privacy fixtures cover those endpoints; this report does not
represent those fixtures as browser activity.

The route follow-up prioritizes the exact reviewed prompt draft over an older
market query parameter. Market selection uses same-origin replaceState, preserving
path, other query parameters and fragments without growing history. Focused
tests cover exact u64 IDs and both precedence and URL preservation.

Unit tests cover request-epoch rejection after owner/scope/mutation resets,
opaque cursor preservation, explicit scan continuation, malformed result
rejection, no unknown-outcome retry, and a single financial call on approval
resume. Live balances were sufficient for the small order, so a multi-page
funding search did not occur in this browser run. Source guards and unit tests
cover that adapter path; independent financial review remains necessary.

Final route follow-up was deployed with app SHA256
`c1bbdc5cf5016d415f12fc9844a1a23e83ae99576caa7907037d9e4084c82d5a`.
Browser verification opened `?market=7`, selected 1, and observed the address change
to `?market=1`. Reload preserved market 1; native Alice sign-in and live 5s candles
with volume returned. This is the final retained browser route. The focused
prompt-draft precedence case is unit-tested rather than represented as another
financial browser approval.
