# Native Exchange client plugin

The chain-hosted Exchange UI calls this WASM component through Supervisor. It
uses Host's current account, native authenticated HTTP, the account's own auth
plugin and Transact. There is no RPC accepting a caller-selected owner, signing
key, arbitrary target service or raw packed action.

- `queries.snapshot()` remains a bounded compatibility overview.
- `queries.scopedSnapshot(market?)` selects one exact market, including IDs
  outside the public catalog's first page. Private position families each carry
  their own continuation; the selected base/quote balances are exact points.
- `queries.market(market)` returns the exact public market and its token metadata.
- `queries.positions(kind, market?, after?, limit)` pages the owner's `orders`,
  `loans`, `lenders` or `liquidity`. `queries.position(kind, market, side?, price?)`
  retrieves one exact own key. Order/loan keys require side and price; lender
  keys require side; liquidity keys require neither. No owner parameter exists.
- `queries.assets(after?, limit)` pages native balances and
  `queries.asset(token)` retrieves any known token's exact balance and settings,
  independent of public token discovery. Position/asset pages are at most 200.
- `queries.stops(before, limit)` and `queries.stop(generation)` retrieve only
  that owner's stop receipts. Page size is bounded at 200.
- `queries.history(tokenId, before, limit)` delegates to Tokens' scoped,
  read-only `transfer.history`; it returns native persisted transfer records for
  the current owner and Exchange only. Page size is bounded at 100. Order
  submission/cancellation audit history is not fabricated from these transfers.
- `user.execute(method, argsJson, expectedOwner, fundingAfter?)` validates a fixed
  list of Exchange actions and their complete arguments. Quantities and IDs can
  be decimal integer strings; booleans must be booleans. Monetary calculations
  use checked integers.
- `user.withdraw(tokenId, amountAtoms, expectedOwner, fundingAfter?)` composes
  native Tokens debit/uncredit for an exact token, including tokens outside the
  visible asset page.
- `user.releasePosition(kind, market, side?, price?, expectedOwner)` settles
  one exact own order's proceeds or claims one closed loan receipt. A fresh
  private point query checks identity and payout settings first. Cancel, repay,
  unlend and remove-liquidity actions already target exact native keys through
  `execute`; they do not require loading the whole portfolio.
- `user.releaseStop(generation, expectedOwner)` freshly verifies and realizes a
  closed receipt beyond the normal snapshot page.

A deposit calls `tokens:plugin/transfer.credit` directly, using the native token's
precision. Every debit, uncredit and automatic recredit from this component also
crosses Tokens' independent `transfer` permission interface. Exchange has no
Tokens whitelist exception. Optional remembered trust is client-side and scoped
to this wallet and Exchange as counterparty; it does not create an unlimited
on-chain allowance or alter AUTO_DEBIT.

A funded action reads one exact market and at most two exact asset points.
It never treats the first 100 public markets, first asset page or first portfolio
page as a complete database. Only a funding deficit invokes the private native
`/funding` query. One invocation scans at most 200 own rows across order, loan and
stop indexes, using an opaque continuation bound to the owner and sorted funding
token IDs. Normalized receipt actions are limited to settle, claim and claimstop;
payout atom strings are parsed exactly. Every payout's native AUTO_DEBIT setting
must be present, including both sides of a closed stop.

At most 32 useful receipts and 64 native actions are scheduled per financial
transaction. The JSON result distinguishes:

- `status: "executed"`: receipts, required recredits and the requested operation
  are atomic; `executed` is true and `funding_cursor` is null.
- `status: "prepared"`: only a bounded, useful receipt batch is submitted;
  `executed` is false and `prepared` is positive. After confirmation the client
  refreshes the same input `funding_cursor`, including null, so receipts omitted
  by the batch cap remain reachable. An incomplete page cannot prove global
  insufficiency; useful partial batches may still be prepared from a final page.
- `status: "scan_progress"`: an incomplete page had no useful claims. No native
  action, transfer approval, consumed nonce or publication seal is staged.
  `prepared` is zero and `funding_cursor` advances. The UI offers an explicit
  continuation without representing this read-only scan as a confirmed trade.

Results also carry `scanned` and `funding_complete`. Cursors are opaque and bounded;
they are percent-encoded rather than interpreted as query syntax. The client
must keep the exact operation, reviewed owner and continuation together, clearing
them on account/market/draft changes. It may perform at most two *confirmed
financial preparations* per explicit submission, then offer continuation. It
must never automatically drain the portfolio or retry an unknown submission
outcome. Exhausting a scan without useful funds reports that the remaining scan
has no sufficient funds; restarting includes any new proceeds accrued behind
its cursor. Visible-page totals must never be presented as whole-wallet totals.

AUTO_DEBIT claims arrive in the primary wallet. Only the fixed cash deficit
needed by the requested action is recredited to Exchange; other automatically
accepted proceeds remain in the user's wallet. The user-facing assets view
shows both balances. AUTO_DEBIT-disabled claims instead arrive in native shared
balances and need no transfer back.

An in-flight exact transfer review pins its computed receipt plan in encrypted,
chain-scoped client session storage for at most five minutes. Its key includes
the current user and active application, and its request includes the exact
method, normalized arguments and funding continuation. A transactional consumed nonce tracks confirmed native success. The optional
native Transact publication hook additionally seals the plan immediately before
the RPC, after proofs and signing prompts. That nontransactional seal survives
rejection, timeout or a lost response, so stale receipts cannot reappear after
an unknown outcome. Prompts that interrupt composition or signing leave the
unpublished plan reusable. The hook accepts only native Transact and verifies
the current account, active app and actual signed action senders. Execute and
preparation-only calls require Exchange receipt/action scopes; a ready withdrawal
requires native Tokens scopes and may have no Exchange action. Its canonical
pinned request binds token and atom amount, while Tokens independently validates
its exact transfer quantity, counterparty and consent. One
Exchange operation may be composed per transaction. Native services still
validate every action. A concurrently consumed receipt, changed collateral
condition, changed liquidity requirement or expired plan can reject the whole
transaction without partial settlement. This cache is not a transaction
idempotency guarantee and never authorizes automatic retry of an unknown result.

`cargo test -p exchange-plugin --lib` exercises the pure client planner. The
native financial service remains the authoritative ledger, matching engine and
solvency enforcement. Plugin tests do not replace native WASM integration or
browser authorization tests.

The required expectedOwner parameter is a stale-tab guard, never an identity
selector. Host's authoritative current user and the authenticated snapshot owner
must both match before any action is scheduled. Every Tokens transfer also
receives the same expected user, while Transact independently pins the account
from transaction start through publication.
