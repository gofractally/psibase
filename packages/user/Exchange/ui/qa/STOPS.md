# Live native stop-order verification

Verified in visible Chrome at `http://exchange.psibase.localhost:8089/`.
Every financial test used existing isolated BTC/USD **market #7**. No test
order or trade was submitted to the main market #1.

These are native local-development tokens and demo accounts. The current
loopback wallet adapter signs for the explicitly selected AuthAny demo
account. This does **not** test a production Tokens plugin permission popup.

## Placement, ownership, consolidation, cancellation

| Test | Native generation | Confirmed result |
|---|---:|---|
| Sell stop, 50,000 trigger, 0.0001 BTC | 389 | Reserved exactly 0.0001 BTC; Bob's view was empty; cancellation restored the exact original available balance. |
| Buy stop, 200,000 trigger, 20 USD twice | 393 | One owned row showed 40 USD; generation stayed the same; cancellation returned all 40 USD. |
| Sell stop, 95,000 trigger | 394 | Started with 0.0001 BTC; a 0.00000001 BTC owned addition succeeded, producing one 0.00010001 BTC row. |
| Buy stop, 80,000 trigger, 10 USD | 396 | Reserved 10 USD and subsequently executed after a real market buy crossed its trigger. |

The first attempted 10 USD buy stop at a 200,000 trigger was rejected safely
by the native minimum-size guard. This exposed missing UI guidance. The
corrected UI now previews **Minimum amount at this stop price: 20 USD** and
rejects that input before submission. An existing owned armed stop can still
receive a one-unit addition. A new unit test covers own, foreign, closed,
different-market, different-side, and different-trigger positions.

The UI-only correction was built and published; the financial WASM artifact
SHA256 stayed unchanged before and after publication:

`e3431919968b9e7488f8642bd77010fefe64dbfe8b772acbf5d64cfdf62c7a11`

## Actual executions and implicit proceeds

| Native history event | Kind | Actual base amount | Actual quote amount |
|---:|---|---:|---:|
| 83300 | Sell stop 394 | 0.00010001 BTC | 7.5764 USD |
| 83303 | Market sell | 0.0001 BTC | 9.0909 USD |
| 84606 | Buy stop 396 | 0.00008539 BTC | 10 USD |
| 84609 | Market buy | 0.00023226 BTC | 20 USD |

The sell execution records are in native block **9867**; the buy records are
in block **10001**. These are native aggregate execution records, displayed
in native event order. No synthetic prints or timestamps were introduced.
The sell candle's exact native base volume was **0.00020001 BTC**.

The triggering market sell protected a minimum receive amount of
**8.9999 USD** and actually received **9.0909 USD**. The triggering market buy
protected **0.00022993 BTC** and actually received **0.00023226 BTC**.

Both completed stops disappeared from Open orders. Activity showed their
actual output, and Available immediately included it. To exercise implicit
realization rather than merely ready cash:

- Withdrew **151,108.3009 USD**, including stop 394's **7.5764 USD** beyond
  the native ready shared balance. The wallet became **951,108.3009 USD**.
  Redepositing exactly the withdrawn amount restored the wallet to
  **800,000 USD**.
- Withdrew **2.48811746 BTC**, including stop 396's **0.00008539 BTC** beyond
  the native ready shared balance. The wallet became **10.48811746 BTC**.
  Redepositing exactly the withdrawn amount restored it to **8 BTC**.

Neither flow required a separate claim/settlement control. Fresh native
point queries returned null for both completed generations afterward.

Before the separate main-market seed, final available balances were
**2.48811746 BTC** and **151,078.3009 USD**; the existing **5 USD** limit-order
remainder was preserved. No test stop position remained in market #7.

## Native accounting cross-check

| Asset, native atoms | Market #7 before | Market #7 after | Alice available delta |
|---|---:|---:|---:|
| BTC | 100,000 | 88,236 | +11,764 |
| USD | 1,000,000 | 1,133,327 | −133,327 |

The two deltas cancel exactly for each asset. Both primary wallets were
restored, LP supply was unchanged, and final native escrow actual balances
equalled expected balances and relay reserves for both tokens. This checks
the observed transfers; it is not a profit estimate or a substitute for the
service's solvency proof and native tests.

Before the sell receipt was realized, the quote escrow was 909,091 atoms:
833,327 relay atoms plus the owner's exact 75,764-atom output. Before the buy
receipt was realized, the base escrow was 96,775 atoms: 88,236 relay atoms
plus the exact 8,539-atom output. Realization removed each entitlement from
that market's escrow and made it free native user cash.

Raw native observations are in `stop-sell-native.json`,
`stop-buy-native.json`, and `stop-final-native.json`; native generation IDs
are also recorded in `stop-order-ids.json`.

## Private queries and pagination

Thirteen live API checks passed, recorded in `stop-api-checks.json`:
anonymous native point access and a mismatched requested owner returned
403; Bob's authorized point lookup of Alice's generation returned null;
Alice's point and descending page returned her own row. Blank/boolean point
IDs, blank cursors, oversized pages, and unknown demo wallets were rejected.
Own point data omitted shared shares, batch totals, and work metadata.

The >1,000-position recovery path was not populated in the live demo. The
native fixture tests owner isolation and exclusive cursors with small pages;
bridge tests cover the older-receipt path. Its loaded
pages remain separate from live cash, with fresh authenticated point reads
before release. The rare partial-view label is **Available shown**; normal
wallets have no extra controls and keep proceeds implicit.

## Final visible demo

After the separate main-market seed, read-only checks confirmed Alice's
**two** main stops: a 60,000 buy stop funded with **100 USD**, and a 56,000
sell stop funded with **0.005 BTC**. The protected long loan shows a 40,000
trigger, **400 USD** amount owed, and **0.02 BTC** collateral. Its advance is
**396 USD**, reflecting the fixed 1% charge deducted from face value.
All seeded main positions were preserved.

Chrome tab **1697463706** was left open and marked as a deliverable on Alice,
market #1, Spot, the 5-second price chart and actual volume. The normal
viewport was restored. Final desktop widths 920, 1366, and 1440, plus a
390px phone width, had no horizontal page overflow. The order panel's minimum
height is zero; its actual 234px height follows the three current rows.
No pool/share/generation/batch/accrued labels or older-receipt controls were
visible. The browser warning/error log was empty.

Screenshots: `native-stops.jpg`, `native-stop-filled.jpg`,
`native-stop-buy-filled.jpg`, `native-margin-final.jpg`, `native-final.jpg`,
and refreshed `native-candles.jpg`, `native-depth.jpg`, `native-mobile.jpg`.
Layout measurements are in `stop-layout-checks.json`.

After the node, bridge, and activity process restarted, a final reload
preserved Alice, market #1, the two stops, the margin position, and the
5-second price/volume chart. Two successive native prices changed from
57,825.5761 to 57,819.41 while both checks showed no offline banner. There
were no new warning/error log entries. The final screenshot was refreshed;
the observations are in `restart-ui-checks.json`.

Validation commands:

```sh
python3 -m unittest discover -s demo -p 'test_*.py' -v  # 57 passed
npm test --prefix packages/user/Exchange/ui          # 16 passed
npm run build --prefix packages/user/Exchange/ui
node --check packages/user/Exchange/ui/src/app.js
python3 -m py_compile demo/bridge.py demo/test_stop_pagination.py
```
