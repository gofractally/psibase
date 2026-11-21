# Native Exchange UI contract

The chain-hosted interface imports Psibase's native `/common/common-lib.js` and
uses its Supervisor. It has no development-wallet HTTP dependency. Public
markets, depth, token metadata and trade prints use same-origin native queries.
Private data and financial operations use native plugins. Private queries never
select an owner supplied by the page. Financial calls carry the displayed owner
as a native precondition: they fail if Host has switched accounts, and cannot
select or impersonate that owner.

## Account authority

`host:accounts/api.getCurrentUser()` supplies the active account.
`host:accounts/activeApp.connectAccount()` opens the native account prompt;
`getConnectedAccounts`, `login(account)` and `logout()` manage accounts already
connected through Host. The UI does not import keys or impersonate demo accounts.
The supervisor supplies authenticated caller origins, the current account and
its native auth plugin. Plugin calls compose and submit native transactions.

## Funding and transfer permission

The ticket tabs are **Spot | Margin | Deposit | Withdraw**. Deposit calls
`tokens:plugin/transfer.credit(tokenId, "exchange", decimalAmount, memo, expectedUser)`.
The Tokens-owned review displays the exact operation, asset, amount, source,
destination and requesting app. Its optional, initially unchecked **Trust
exchange** remembers a narrow wallet↔exchange transfer permission in native
client storage. It does not grant generic Tokens High authority, issuer
permissions, AUTO_DEBIT or an on-chain unlimited allowance. The account menu
reads `transfer.trustStatus()` and offers `transfer.revokeTrust()`.

An untrusted transfer interrupts the composed transaction before submission.
Only that known native prompt signal saves an exact call and a nonsensitive form
draft in session storage. On return the UI checks the same connected owner and
`transfer.approvalStatus()`: only an approved review resumes that exact operation.
The native operation checks the original expected owner again within the same
supervised call, including automatic preparation followups. A denial restores
the draft without submitting. Errors and unknown submission
outcomes are never retried automatically. The native permission binds approval
to the exact atom amount, operation, token, counterparty, caller and memo; it is
staged during composition and rolled back if another prompt or signing fails
before publication. It becomes irrevocably spent immediately before the
publication attempt, including when the RPC reply is unknown or the chain rejects
the transaction. An unknown result therefore cannot replay a one-off approval.

Withdrawal calls `exchange:plugin/user.withdraw(tokenId, atomAmountString, expectedOwner, fundingAfter?)`.
The native plugin realizes eligible own proceeds as needed and schedules native
Tokens debit/uncredit actions. Tokens owns transfer authorization for these
calls as well. Reserved order input and margin collateral remain unavailable
until the relevant cancellation, repayment or native liquidation releases them.

## Exchange plugin

Financial input quantities are digit strings. Returned native integer values
above JavaScript’s safe integer range remain strings and are converted directly
to BigInt for arithmetic. Page cursors are opaque strings, not offsets or IDs.
No financial amount is rounded through JavaScript Number.

| Interface and method | Parameters | Result |
|---|---|---|
| `queries.snapshot` | none | bounded compatibility snapshot with explicit continuations |
| `queries.scopedSnapshot` | optional exact market ID | fresh selected-market snapshot |
| `queries.positions` | kind, optional market ID, optional after, limit | own orders/loans/lenders/liquidity page, all referenced metadata, `next_after` |
| `queries.assets` | optional after, limit | own native asset page, `next_after` |
| `queries.asset` | exact token ID | exact own balance and token metadata |
| `queries.stops` | optional before string, limit 1–200 | own stop page, referenced market/token metadata, `next_before` |
| `queries.stop` | generation string | own stop or null JSON |
| `queries.history` | tokenId, optional before string, limit | native Tokens transfer history JSON |
| `user.execute` | allowlisted method, args JSON, expected owner, optional funding cursor | funding/execution result below |
| `user.withdraw` | tokenId, atom amount string, expected owner, optional funding cursor | funding/execution result below |
| `user.releasePosition` | orders/loans, exact market, optional side/price, expected owner | exact own receipt recovery beyond visible pages |
| `user.releaseStop` | generation string, expected owner | native own receipt release |

`execute` supports create, trade, limit, cancel, stop, cancelstop, claimstop,
process, borrow, repay, claim, liquidate, renew, lend, unlend, addliq and remliq.
The plugin queries exact market/token/position points and bounded own funding
pages rather than inferring absence from a truncated catalog.

Funding results include `{status,executed,prepared,funding_cursor,scanned,
funding_complete}`. `executed` means the requested transaction completed.
`prepared` means a confirmed native transaction realized some own proceeds but
the requested action remains pending. Only that successful result allows one
automatic followup; there are at most two confirmed preparation calls per click
and at most 32 claims per call. Remaining preparation is returned to the user as
an explicit continuation, not an error claiming those transactions failed.
`scan_progress` means this bounded scan page scheduled no transaction; it is
returned immediately and never causes an automatic scan loop. The UI preserves
the exact owner, operation, arguments and opaque funding cursor, displays the
request summary, and offers **Continue preparing funds** or **Discard request**.
An approved native prompt return makes exactly one Exchange call, so it cannot
restart the automatic preparation budget. A preparation result then requires an
explicit Continue. Changing the draft/account/market discards the continuation. Unknown or rejected
financial submissions never trigger an automatic retry.

## Snapshot scope and explicit browsing

Market discovery uses independent public pages. A selected market is fetched by
exact ID even when absent from the first discovery page. The Markets screen
supports Load more and Open market by ID; `?market=ID` opens a direct market URL.
Selection updates only the market URL parameter using same-origin replaceState,
preserving other parameters, path and fragment without growing browser history.
On a native prompt return, the exact reviewed draft market takes precedence
over an older address-bar query before the scoped snapshot is fetched. The UI
polls the selected market, not the catalog.

`scopedSnapshot` carries the selected market’s first 200 own orders, loans,
lenders and liquidity records, up to 200 levels independently on each book side,
and the latest 200 owner-global stop records. Metadata accompanies every
referenced market and token. `continuations` contains independent markets,
book_bid, book_ask, orders, loans, lenders, liquidity, assets and stops fields;
`coverage_complete` describes those requested bounded collections only.
Explicit selected snapshots have `balance_scope:"selected-market-points"` and
`asset_page_included:false`: exact base/quote cash points, without scanning the
asset catalog. An explicitly selected third funding token gets one exact balance
point while its Deposit/Withdraw ticket is active.

Even when selected pages are complete, proceeds in other markets can exist.
The UI therefore labels projected amounts **Available shown** and **Reserved
shown**, with a clear scope note. Fresh selected-market positions and recent
stop receipts feed the portfolio calculator. Older account pages are separate
point views, never merged into live available/committed arithmetic. Their values
remain visible across two-second polls with a last-query explanation; owner
changes and financial mutations invalidate their rows/cursors. Private stale
responses are discarded using both owner/scope and request-epoch guards.

The account’s Positions tab pages all own limit orders, margin loans, lending
and liquidity records across markets, with an optional exact market filter.
Rows include Open market and appropriate cancel/repay/recovery controls. Settled
loan and maker receipts remain accessible. Stop pages traverse the native global
owner index in descending order; a market filter applies to the loaded stop
rows, and explicit further pages may contain additional matches. There is no
unbounded catchup scan. Expanded public depth has independent buy/sell controls
and a Refresh depth action; cached expanded depth is labeled as a page view and
never enters current funding/spread calculations.

After create completes, the UI opens paged own liquidity positions if the native
result does not identify the committed market. It does not predict an allocator
ID or misidentify another concurrent creation.

## Assets and transaction history

The top-right account menu contains Assets, Positions, Transaction history and
Permissions. Assets use explicit native owner pages and exact token-ID lookup.
Selected-market live balances override matching cached asset rows; other asset
rows retain their last query values until refreshed. Available/reserved amounts
are explicitly scoped, and an unqueried reserved amount is shown as a dash. There is no
bottom-of-page asset section. Deposit and Withdraw shortcuts select their ticket
tabs.

Transaction history reads one selected asset's durable native Tokens
`balChanges` connection, limited to the connected owner and exact exchange
counterparty. Native decimal event amounts are parsed exactly at the token's
precision. The UI rejects a response containing another owner, counterparty or
token. Older pages require an explicit click. Node event retention may limit
history. The expandable **Recent actions on this browser** is clearly separate:
it remembers successful native calls locally and is not represented as a
complete historical trade audit.

## Public data and refresh

`GET /markets?after=ID&limit=100` supplies bounded discovery and token metadata,
with `next_after`. `GET /market?market=ID` resolves an exact market.
`GET /book?market=ID&bid=true|false&after=OPAQUE&limit=100` pages either side
independently with `next_after`; no global depth prefix can hide the other side.
`GET /tokens?after=ID&limit=1` resolves any native token ID and its precision and
reserved symbol. `GET /trades?market=ID&limit=100` supplies actual native trade
and liquidation prints. The first tape load follows at most five pages; later
refreshes use exclusive `after=latestEventId`, preserving that lower bound while
following bounded `before` pages. At most 2,000 unique prints are retained per
visited market for the visible recent-trades tape. Candles use the independent
native candle-history endpoint rather than this browser cache.

`GET /candles?market=ID&interval=5|15|60|3600|86400&limit=200` reads native
candle history. Completed bars reside in prunable event history; only the current
bar per market/interval remains in objective state. Coverage starts when this
aggregation is deployed; the UI does not invent earlier bars or zero-trade
buckets. `before` and `next_before` are opaque event cursor strings, not times.
A page includes the current bar only on the latest page.

Candle `time` is a Unix-seconds bucket. Open/high/low/close, base-atom volume and
trade count are exact integer strings. `price_precision` gives the decimal scale
of OHLC prices: the backend scales atomic quote/base ratios by 10^18 and accounts
for both token precisions. It can exceed ordinary quote-token precision, so tiny
asset prices do not round to zero. The UI validates the ranges and converts to
Number only when mapping SVG geometry. The 1h and 1d views use UTC dates/times.
Older/Latest controls fetch bounded native pages. Current hourly/daily bars
refresh at most every ten seconds; shorter intervals at most every two seconds.

Visible, idle pages refresh snapshots every two seconds. Hidden pages do not
poll. Financial submission pauses polling; account changes discard stale private
data. Native transfer history is fetched when its account tab is opened or its
asset is changed, rather than scanning every asset during each market refresh.

Recent-trades requests run only while that order-book tab is visible. Native candle history is independent of its bounded print cache.
