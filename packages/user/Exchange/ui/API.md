# Exchange UI bridge contract

This static interface sends every financial mutation to the native Psibase
service through the local demo bridge. It does not store balances, simulate
fills, or persist orders in the browser. The account picker controls only the
explicitly labelled local devnet accounts; it is not a production signer.
Production deployment should replace this bridge with native Supervisor/plugin
transaction signing while keeping the same service actions and queries.

`GET /api/state?account=alice` returns the native `/snapshot?owner=alice` JSON
directly, or wrapped under `snapshot`. Expected arrays: `markets`, `tokens`,
`balances`, `levels`, `positions`, `loans`, `loan_positions`, `lenders`,
`relay_shares`. The UI accepts atom quantities as digit strings or native
`Quantity` objects with `value`. Market records have `id,base,quote,base_lot,
quote_tick,x,y,k,lp_supply,vault_base,vault_quote,debt_base,debt_quote,
lending_base,lending_quote`. Token records have `id,precision,symbol`.
Balance records have `token,wallet,incoming,outgoing,spendable`.
Own order positions expose native `remaining_outgoing`, `remaining_base`,
`remaining_quote`, and `status`. Only a positive remaining outgoing amount
counts as an open order. The UI does not infer original or lifetime filled
quantities from settlement balances.
Loan metadata is scoped to the owner's position. The UI uses the native
`claimable_surplus` floor payout directly when supplied; it does not need
other borrowers' aggregate collateral or debt to display balances.

`GET /api/trades?market=ID&limit=100` returns actual native executed trades,
latest first, with `event_id,base_amount,quote_amount,time,sell_base,kind`
and `next_before`. The initial load follows at most five 100-entry pages;
subsequent updates send exclusive `after=latestEventId`, following
`before=next_before` while retaining that original `after` cursor if needed.
Returned IDs satisfy `after < event_id < before` when both cursors exist;
the latest-seen cursor advances only after that bounded fetch completes.
The browser retains at most 2,000 unique events per visited market. Each
print is the actual aggregate execution VWAP, including liquidation trades;
there is no synthetic external trade data in the chart or tape.

`GET /api/tokens?after=ID&limit=1` proxies the public native token catalog.
The creation form accepts any native token IDs and resolves their actual
precision and reserved symbol metadata through that endpoint before packing
amounts. Multiple independently funded books for one pair are supported;
market pickers show each unique market ID and the selected lot/tick grid.

Market capability fields are native `margin_enabled` (sticky eligibility),
`legacy_unsupported`, and `escrow_base/escrow_quote` objects with
`actual,expected,funded`. The UI labels eligible books **Margin enabled** and
others **Spot only**. Borrowing and new lending require eligibility and
verified funding; observed native underfunding pauses new commitment buttons.
Existing cancellation, repayment, redemption, and withdrawal actions remain
available for the native service to validate.

`POST /api/action` receives `{account,method,args}` and returns a confirmed
transaction or an HTTP failure with `{error: "chain rejection reason"}`.
All u64 form amounts, prices, units, and shares are sent as **digit strings**
to avoid JavaScript rounding. Token IDs and event limits are bounded numbers.

| Method | Arguments |
|---|---|
| `create` | `base,quote,base_amount,quote_amount,base_lot,quote_tick` |
| `trade` | `market,sell_base,amount,min_output,max_events` |
| `limit` | `market,bid,price,amount` |
| `cancel` | `market,bid,price` |
| `borrow` | `market,long,price,units` |
| `repay` | `market,long,price,units` |
| `claim` | `market,long,price` |
| `liquidate` | `market,max_events` |
| `renew` | `market` (new term only after both debt books are empty) |
| `lend` | `market,base,amount` |
| `unlend` | `market,base,shares` |
| `addliq`, `remliq` | `market,shares` |

`POST /api/deposit` and `/api/withdraw` receive
`{account,tokenId,amount:"nativeAtoms"}`. The bridge must use native token
credit/uncredit/debit actions and preserve user identity. The `spendable`
balance includes both directions of live shared token credits; it is not
an exchange-maintained free-balance ledger.

The UI adds funded maker `position.proceeds` and each closed loan's exact
pro-rata surplus to available funds. Before a spending action or withdrawal,
the bridge atomically prepends `exchange.settle{market,bid,price}` for that
wallet's positive maker proceeds and `exchange.claim{market,long,price}` for
closed loan positions. This realizes accrued funds inside the transaction;
the user does not need a separate claim action. Never credit a browser-only
balance or submit settlement and spending as separately committed steps.

The default price chart groups actual native timestamps into 5-second,
15-second, or 1-minute OHLC candles and aligned base-volume bars. Empty time
intervals stay empty. The depth view combines current native limit orders
and executable market-maker reserves within a configurable symmetric
percentage of the current price. Far orders remain on chain; changing the
viewport does not cancel them. Session activity entries are added only after
a successful confirmed transaction response.

State refreshes every two seconds while the document is visible; incremental
trades additionally pause outside the exchange view. Chart geometry and trade-tape signatures skip
unchanged SVG/HTML work; focused forms are not replaced by polling. Optional
`?profile=1` logs API UTF-8 payload bytes, fetch/decode durations, synchronous
render durations, and actual chart redraw durations to the console. It is
disabled by default, keeps no metrics buffer, and does not measure browser
paint or frame time.

When hosted on `exchange.psibase.localhost`, the central API adapter uses
the explicitly configured local development wallet at
`http://127.0.0.1:8090`. The bridge permits that exact native origin via CORS.
Other hostnames use same-origin API paths. Native Sites serves all static
assets; a production wallet signer can replace this demo adapter separately.

Build: `npm run build` (no dependencies). Test: `npm test`.
The bridge can serve `dist/` directly, or those static assets can be published
to the native service. Do not launch the `dev` static-only server expecting
financial actions; the real bridge is required.
