# Banx

Banx is a **mutual-credit** ledger. There is no cash balance and no token you “have.” Value is always a directed claim: **A owes B** some amount of a registered asset.

A payment does not move coins. It **creates or shrinks obligations** along a path of credit lines (and, when the books already run the other way, it **unwinds** those claims).

## Mental model

- **Credit line** — B is willing to be owed by A, up to a limit, at an APR. A can *draw* on B: A becomes debtor, B creditor.
- **Obligation** — the actual debt. One pair/asset can have several rows (different rates). **Exposure** is principal + live interest.
- **Path-forward offer** — B’s standing terms for *sitting in the middle* of a `path_pay`. Specific next hop, or **global** (any next hop).
- **Claim offer** — standing **buy** (`sell_claim` hits it) or **sell** (`buy_claim` hits it) terms for transferring a claim on a debtor. Specific debtor, or **global**.
- **Currency policy** — a posted from→to FX offer. Others take it with `convert`. Path pay uses it to size a hop when the poster is in the middle.

Alice paying Carol $1 via Bob:

1. Alice draws on Bob’s line → Alice owes Bob $1.
2. Bob forwards to Carol (Bob must have a live path-forward offer; Carol must have lined Bob, **or** Bob must already owe Carol) → Bob owes Carol $1.

Carol is paid in the sense that she holds a claim. Bob is the middle book.

If Carol later pays Alice $1 back the same way, those two claims **auto-net** to zero. Carol does **not** need Bob to have lined her, and Alice does not need to have lined Bob, as long as the reverse obligations are still there.

## Credit lines

Posted by the **creditor** (`st_crd_lne` / `setCreditLine`). The debtor must already exist as a chain account.

| Term | Meaning |
|------|---------|
| Limit | Cap on outstanding exposure (principal + interest), revolving unless deplete is on |
| APR | Daily compound, ppm (`10_000` = 1%) |
| Deplete | If on, each *new* draw also spends a remaining grant; repayment does not restore it |
| Grace | Interest-free window in **seconds** after this pair goes 0→positive |

`limit` is not a deposited balance. Drawing uses unused headroom: `limit − exposure` (and remaining grant if depleting).

A path hop is a **connection**: that directed pair in one asset — the creditor’s line (if any) plus both tabs. Capacity is reverse claim + unused line headroom. A draw unwinds what they already owe you, then books any leftover as new debt on the line (1000 against a 400 reverse tab → unwind 400 + new 600). The reverse book does not need a line.

## Obligations and netting

Every draw, deposit, buy-claim, and convert **auto-nets** that pair/asset: equal value both ways is cancelled.

Reduction order is fixed:

1. Accrued interest first, then principal.
2. Highest APR first (then older `created_at`, then lower id).

A **deposit** is how off-graph value enters: the receiver books a liability to the depositor, then nets. That is also how you *repay* (the creditor deposits the debtor, which books the opposite claim and nets).

`net` remains as an action (either party, optional `max_amount`) for scripts or cleanup. The UI does not expose it; writers already full-net.

## Requests

Three kinds (`st_req` / `createRequest`). Counterparty, amount, memo (80 bytes), optional expiry. Invoice `counterparty` may be `0` (anyone). Please-book and settle-auth still require a named party.

| Kind | Poster | Fulfiller | Effect |
|------|--------|-----------|--------|
| **Invoice** (`1`) | Payee | Anyone with a path to the poster, via `pay_inv` (`counterparty` is who was billed; `0` = open) | Walks hops backward from remaining; `max_spend` is the send budget. Does **not** shrink an existing loan to that payee. |
| **Please-book** (`2`) | Debtor (or whoever sent value off-graph) | **Only** the named creditor, via `deposit` with `request_id` | Opposite claim + auto-net. The poster cannot book this themselves. |
| **Settle-auth** (`3`) | **Creditor** | **Only** the named debtor, via `fl_stl` | Same book as the creditor depositing them. Capped by `min(amount, remaining, live exposure)` — cannot flip the book or mint a claim on the creditor. |

Fulfillment is partial (`remaining` declines). Poster can `rm_req` while still open. Activity records `request_id` and memo on create / cancel / fulfill (and on the deposit that books a please-book).

UI: `/requests` (Plus to create). An account-row Request button opens the same modal with the party filled in (payer field omitted). Kinds in the UI: invoice, deposit request (please-book), settle-auth. Incoming invoices open Transfer with the invoice id.

## Path pay

`path_pay(hops, amount, min_return)` is atomic.

- **Hop 0** — sender draws on the first account (line and/or reverse claim). No hop fee.
- **Later hops** — the current path debtor must have a **live** path-forward offer. Specific next hop if live; otherwise a live global. Expired specific does **not** block the global. Buy-claim offers are not used here.
- **Asset change** — the previous hop’s **creditor** (middle man) applies their FX quote to size the next hop. The payer’s tab stays in the from-asset; the middle man takes the to-asset liability. The sender’s policy is ignored.
- **min_return** — final residual in the last hop’s asset must be at least this.
- **Invoice** — `pay_inv(hops, max_spend, request_id)`: remaining is exact, `max_spend` is the send budget.

Off-chain **Find path** (`quotePath`) searches a scoped subgraph (lines + reverse claims + clearing + FX), not the full network. Exact-in: amount is what you send. Exact-out: amount is what the payee should receive; the quote finds the send. Hop cards can show expected hop/FX fees.

You can still edit hops before execute.

## Path-forward offers

Posted by the **poster** (`st_fwd_ofr` / `st_glb_fwd`): poster is an intermediate; `next_hop` is the next creditor or global. Fees are Stripe-style: `out = in × (1 − percent) − fixed`. `max_line_apr` rejects a **new** draw if the next hop’s line APR is higher; a hop that only unwinds a reverse tab is not checked. A specific offer can be posted before that hop knows the poster; the hop still needs a line or live tab at `path_pay` time. The named next hop must exist. `allow_unknown` (applied on insert and update): if off, the poster must already know the next hop (a line to them, or a live tab); if on, anyone who lined the poster can become their creditor. `st_fwd_unk` is a flag-only update without re-posting fees.

## Claim offers

One table, `side` in the primary key (`1` buy, `2` sell). Spread ppm is signed (`10_000` = 1%). **Buy:** positive haircuts the seller, negative is a premium the buyer pays. **Sell:** positive is the seller’s profit (`+10_000` = 1% over face), negative is a discount. The debtor must know the buyer (a line to them, or a live tab). A buyer line to the debtor is optional and only caps size if present.

- **Buy** (`st_buy_clm` / `st_glb_buy`): poster’s bid. Taker calls `sell_claim`.
- **Sell** (`st_sell_clm` / `st_glb_sell`): poster’s ask. Taker calls `buy_claim`.

## Transferring a claim

`sell_claim(buyer, debtor, asset, amount)`: you hold a claim on `debtor` and hit the buyer’s **buy** offer.

`buy_claim(seller, debtor, asset, amount)`: you buy the seller’s claim on `debtor` under their **sell** offer.

Same books either way: face moves to the buyer; seller holds a claim on the buyer for face after the **maker’s** spread. Not a path payment and not “paid in full” for grace.

## Interest

Interest is **daily compound** on principal + already finalized interest.

- Full days: `bal × (1 + APR / 365)` (365-day year, no leap).
- Leftover hours in the current day: pro-rata on that daily rate.

It is computed from the last **principal/rate change**. Reads (GraphQL, exposure) include **live** interest. Any action that changes principal **locks** live interest first, then mutates.

So 25 days of a loan already carry 25 days of interest. Interest-on-interest starts after each full day.

Tiny principals can floor to zero daily increment (integer units). Use realistic precision (e.g. 4 dp USD).

## Interest-free grace

Posted with the credit line (`st_crd_lne`), stored on a **pair cycle** row keyed by `(creditor, debtor, asset)` — not on the facility terms. UI: None, 1 / 7 / 30 days, or custom days → seconds.

When that pair goes **0 → positive**, the posted `grace_seconds` is **snapshotted** on the cycle. Until that window ends, live interest on that pair is **0**. If they **deposit/net the pair to zero** inside the window, the cycle closes with nothing to charge. Later line edits change posted grace only; they do not rewrite an open snapshot.

After the window, daily compound runs from the last principal/rate change (origination if nothing changed during grace — the “lost grace” case).

Editing the line later does not change an **open** cycle; it applies to the next 0→positive.

Sell, convert, and path_pay do **not** count as a grace payoff. They lock whatever is owed (zero during grace) and move or rebook the claim. A sold claim keeps the source cycle’s remaining window (same end). It does not start the buyer’s posted grace — that would reset an already-aged tab.

Default in the UI is **7 days**. `0` means interest from the first second.

## Currency (FX)

Anyone posts `st_cur_pol`: from-asset → to-asset, fixed fee in from-asset, rate (human “to per 1 from” in the plugin), optional new APR, expiry. That is an **offer**.

`convert` is a take: sender uses the **counterparty’s** live quote, not their own. Nets `from_asset` first, rebooks the leftover at that offer, then auto-nets `to_asset`. Neither party can re-denominate a claim at a rate they set themselves.

Path pay does **not** rebook. It only uses the middle man’s quote to size the next hop.

## Amounts and units

On chain, quantities are raw integers. The plugin and GraphQL use **human decimals** for the asset’s precision (`"1.45"`). APR and hop percent are **ppm** (`10_000` = 1%). FX `fx_rate` is `RATE_SCALE` fixed-point (`1_000_000` = 1:1).

## Architecture

| Layer | Role |
|-------|------|
| **service** | Tables and actions |
| **r-banx** | GraphQL (assets, lines, obligations, forward/claim offers, FX, scoped `pathGraph`) |
| **plugin** | WIT `api` for the Supervisor (`setCreditLine`, `pathPay`, `quotePath`, …) |
| **ui** | React app on the `banx` subdomain |

### Actions (service)

| Action | Purpose |
|--------|---------|
| `st_crd_lne` | Set credit line (limit, deplete, APR, grace seconds) |
| `rm_crd_lne` | Remove a credit line (0-limit is not a remove) |
| `st_fwd_ofr` / `st_glb_fwd` | Specific / global path-forward offer |
| `st_fwd_unk` | Flag-only `allow_unknown` update (`next_hop` 0 = global) |
| `rm_fwd_ofr` / `rm_glb_fwd` | Remove path-forward offer |
| `st_buy_clm` / `st_glb_buy` | Specific / global buy claim offer |
| `rm_buy_clm` / `rm_glb_buy` | Remove buy claim offer |
| `st_sell_clm` / `st_glb_sell` | Specific / global sell claim offer |
| `rm_sell_clm` / `rm_glb_sell` | Remove sell claim offer |
| `path_pay` | Multi-hop draw (`min_return`; optional `request_id` ticks an invoice) |
| `pay_inv` | Pay invoice: exact remaining, `max_spend` budget |
| `sell_claim` | Sell a claim into a buyer’s offer |
| `buy_claim` | Buy a claim from a seller’s offer |
| `deposit` | Book a deposit and auto-net (`request_id` 0 or please-book) |
| `st_req` / `rm_req` | Create / cancel invoice, please-book, or settle-auth |
| `fl_stl` | Debtor fulfills a settle-auth |
| `net` | Explicit bilateral net (no UI; writers already auto-net) |
| `st_cur_pol` | Post a from→to FX offer |
| `convert` | Take the counterparty’s FX offer and rebook |
| `get_exposure` | Live pair exposure |
| `add_asset` | Register an asset (service only) |

## UI

- `/accounts` — claims you hold and liabilities you owe; offer/edit lines
- `/payees` — contacts; deposit or draw
- `/path-pay` — Transfer: find a path and execute
- `/requests` — invoices and please-book
- `/policies` — path-forward offers, buy-claim offers, and currency policies
- `/assets` — registered assets

`/obligations` redirects to `/accounts`.

## Build

```bash
# UI
cd packages/user/Banx/ui && yarn && yarn build

# Package (from Banx root)
cargo-psibase package
```

Install with `cargo-psibase install` against a local psinode. Open `https://banx.<root>/`. GraphiQL: `/graphiql`.

## Test

```bash
cargo-psibase test   # from packages/user/Banx/service
```
