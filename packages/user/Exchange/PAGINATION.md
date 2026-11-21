# Native read API pagination

Every collection uses a native ordered-index seek followed by at most `limit+1`
rows (`limit` is 1–200). There are no offsets, global token-catalog joins, or
silently complete 100-market/1,000-position snapshots. A continuation is a live
exclusive key, not an immutable database snapshot: deletions of the boundary row
are safe, while inserts before an already-read boundary require a refresh.

## Public reads

- `GET /markets?after=ID&limit=N`: `markets`, referenced `tokens`, `next_after`.
  Discovery has no order depth (`levels:[]`). `after` is an exclusive market ID.
- `GET /market?market=ID`: exact `market` and its two `tokens`, including IDs
  beyond the loaded discovery page. Unknown IDs return 404.
- `GET /book?market=ID&bid=true|false&after=CURSOR&limit=N`: one side in native
  execution priority, `levels` and `next_after`. Public levels contain aggregate
  market/side/price/outgoing/active values, never owner records.

## Authenticated owner reads

All endpoints below require the native authenticated user, the canonical
Exchange host, and return `Cache-Control: no-store`. An `owner` or `account`
parameter cannot select a different user. Native Supervisor-origin CORS does not
replace these authority checks.

- `GET /positions?kind=orders|loans|lenders|liquidity&market=ID&after=CURSOR&limit=N`.
  `market` is optional; omitting it seeks the owner's global native prefix.
  Returns `owner`, `kind`, filter `market`, `rows`, `next_after`, and exact
  `markets`/`tokens` for **every** row. Compatibility aliases are `positions`,
  `loan_positions` plus `loans`, `lenders`, and `relay_shares`, respectively.
- `GET /position?kind=K&market=ID&side=true|false&price=P`: exact own position.
  Orders and loans require side+price; lenders require side; liquidity requires
  neither. The native aliases `bid`, `long`, and `base` are accepted for side.
  A conflicting alias is rejected. Returns the same shape with zero or one row.
- `GET /assets?after=CURSOR&limit=N`: `balances`, `tokens`, `next_after`. Tokens
  are the ordered union of the user's native primary balances and pending shared
  balances. Each step seeks the **next distinct token**, skipping all recipients
  at the current token without iterating them. Other-app pending entries can
  produce an asset with zero Exchange incoming/outgoing balances.
- `GET /asset?token=ID`: exact `balance` and token metadata, also exposed as
  `balances:[balance]`, `tokens:[token]`. Missing balance/config rows synthesize
  zero balances and use the user's authoritative native AUTO preference.
- Existing `GET /stops?before=GENERATION&limit=N` remains descending and bounded,
  with exclusive `next_before`; `/stop?generation=ID` is a direct own lookup.
  Both include referenced market/token metadata.

Opaque cursors are `p1.` plus canonical lowercase hexadecimal JSON. They bind
version, owner, collection kind, market filter and (for funding) requested token
list. Scope mismatches, malformed/noncanonical values and oversized cursors are
rejected. They grant no authority and cannot select another owner. IDs above
JavaScript's safe integer range are serialized as decimal strings. Clients must
treat cursors as opaque and must not merge older position pages into an exact
current balance calculation.

## Scoped snapshots

`GET /snapshot?market=ID` point-loads that market, the first 200 levels of each
book side, each selected-market owner position prefix, and the first 200
owner-global stops. Native stop storage has no owner+market index, so a selected
snapshot does not silently filter and scan all stops. Metadata includes all
returned stop markets and their tokens.

Balances are exactly the selected base/quote points. The response declares
`balance_scope:"selected-market-points"`, `asset_page_included:false`, and
`coverage_scope:"selected-market-owner-prefixes-and-owner-global-stops"`.
Discovery and assets are separate explicit pages. Legacy `/snapshot` without a
market keeps bounded first global owner/catalog/asset pages and first-market
book sides. The financial action `snapshot` retains local-only reads, without
opening foreign token tables.

`continuations` has keys `markets`, `book_bid`, `book_ask`, `orders`, `loans`,
`lenders`, `liquidity`, `assets`, `stops`. `coverage_complete` means only the
collections requested in that response have no continuation; it does **not**
assert a complete global portfolio for scoped snapshots. `accrual_coverage`
explicitly directs transaction preparation to the funding reader.

## Bounded receipt preparation

`GET /funding?tokens=ID,ID&after=CURSOR&limit=N` accepts 1–16 sorted, unique token
IDs. It scans at most `N` own positions across three cursor phases: makers,
borrowers, then descending stops. A completed phase advances to the next phase;
no token filter causes a scan of unbounded unrelated positions.

The response is `owner`, exact requested/payout-token `balances`, their `tokens`,
`claims:[{action:{method,args},payouts:{tokenID:atomString}}]`, `scanned`,
`next_cursor`, and `complete`. Claim actions are restricted to realized maker
`settle`, closed-loan `claim`, and closed-stop `claimstop`. Damaged or legacy
market escrow is not proposed as spendable funding. Both stop payout assets
have authoritative AUTO flags, even if absent native balance rows have zero
amounts.

A partial scan with no claim is progress, **not proof of insufficient funds**.
Exact free native balances may independently satisfy an action. Clients must
request continuation explicitly; a capped claim transaction must not skip
unselected claims from its current page. No fill adds owner iteration or a new
persistent claimability index.

## Validation

`service/src/pages.rs` has host tests for cursor scope/canonical encoding, limits
and lossless integer JSON. Native chain pagination fixtures create more than
1,100 markets and positions, more than 1,000 assets, and more than 1,000 price levels per side;
they exercise full traversal, deleted cursor boundaries, exact late-market
funding, recipient fanout, owner denial, canonical-host denial and per-query CPU
samples. Fixture creation time is excluded from query measurements.
