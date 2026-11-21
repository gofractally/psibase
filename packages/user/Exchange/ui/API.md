# Exchange UI bridge contract

This static interface sends every financial mutation to the native Psibase
service through the local demo bridge. It does not store balances, simulate
fills, or persist orders in the browser. The account picker controls only the
explicitly labelled local devnet accounts; it is not a production signer.
Production deployment should replace this bridge with native Supervisor/plugin
transaction signing while keeping the same service actions and queries.

`GET /api/state?account=alice` returns the native `/snapshot?owner=alice` JSON
directly, or wrapped under `snapshot`. Expected arrays: `markets`, `tokens`,
`balances`, `levels`, `positions`, `stop_positions`, `loans`, `loan_positions`, `lenders`,
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
Own stop rows contain `owner,generation,market,sell_base,trigger,status,
remaining_outgoing,claimable_input,claimable_output,input_token,output_token`
and optional native
`can_cancel/can_claim` flags. Status is `armed`, `filled`, `partially_filled`,
or `unfilled`. Armed stops reserve their outgoing asset;
completed stops have zero remaining outgoing amount. The UI adds the exact
input refund and output payout to available funds. No aggregate stop data
or other owners' orders enter private wallet balances.

The snapshot includes the latest 1,000 own stop positions, in descending
generation order, with nullable `stop_positions_next`. Older rows use
`GET /api/stops?account=alice&before=GEN&limit=100`, forwarded to the native
owner-authenticated `/stops` endpoint. The limit is 1–200 and `before` is an
exclusive u64 generation cursor. The response is
`{owner,stop_positions,next_before}`. Cursors never select another owner.

`GET /api/stop?account=alice&generation=GEN` reads one authenticated own row
or null. Only this point response includes `input_auto_debit` and
`output_auto_debit`, taken from that owner's native receipt settings. An
unknown generation and a generation belonging to someone else both return
the same null private position.

The interface fetches one older page per explicit click and keeps it
separate from live balances. Loaded pages are cleared on wallet/market
changes and financial submissions. Older armed orders can be cancelled;
older completed receipts have a **Return to balance** action. That action
posts `{account,generation}` to `/api/release-stop`, which performs a fresh
authenticated point lookup before one atomic native `claimstop` and its
AUTO_DEBIT re-credits. It does not depend on old market metadata being in
the current snapshot. Missing/foreign rows return 404, armed rows return 400,
and no push occurs in either case. Unknown submission results are not retried.
For wallets below the snapshot limit there is no extra pagination request
or older-order interface.
When the snapshot has older rows, the balance column is explicitly labelled
**Available shown** with an older-orders note. Positive receipts outside the
snapshot are excluded rather than double-counted from a potentially stale
loaded page. This can understate total available proceeds in the local demo
wallet; it does not change native ownership or liabilities. The explicit
older-receipt escape is limited to this case, while ordinary proceeds remain
implicit. A production wallet can extend authenticated pagination and
transaction preparation without changing the matching service.

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
| `stop` | `market,sell_base,trigger,amount` |
| `cancelstop`, `claimstop` | `generation` |
| `process` | `market` (permissionless due-order execution) |
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

The UI adds funded maker `position.proceeds`, each closed loan's exact
surplus, and both exact stop payouts to available funds. The user does not
need a separate claim step. A stop market order reserves its input now:
base atoms for sells, quote atoms for buys. Native reserve price reaching
the trigger executes the funded order; any unfilled input is returned. It
does not promise a future execution price or become a resting limit order.
New owned stops require at least the market's base size increment for sells,
or its trigger-value equivalent in quote tokens for buys. Existing owned
armed positions at the same market, side, and trigger can receive smaller
positive additions. The preview and local input validation show this minimum
in ordinary token units; the native service remains authoritative.

The local wallet adapter derives required input assets from the native
action's integer formulas. Ready shared funds are spent or withdrawn directly
without realizing unrelated proceeds. Otherwise it realizes only owner
receipts needed for missing input assets, using `settle`, `claim`, or
`claimstop`. Each preparation transaction includes all corresponding
AUTO_DEBIT re-credits atomically and is followed by a fresh native read.
There are at most two preparation transactions per HTTP request, each with
at most 32 receipts and 64 total native actions including re-credits.

The final requested action is then submitted exactly once, as its own
transaction. It is never automatically retried after an unknown submission
result. If preparation reaches its bound first, HTTP 409 returns structured
`progress` and a plain retry message; the UI refreshes native balances.
Already realized proceeds remain the owner's free funds. A retry begins
from native state rather than replaying a cached preparation. This bounded
multi-transaction behavior is specific to the local development wallet;
a production native wallet/plugin can provide its own transaction workflow.

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
