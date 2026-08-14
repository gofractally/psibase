# Banx

Banx is a **mutual-credit** ledger. There is no cash balance and no token you “have.” Value is always a directed claim: **A owes B** some amount of a registered asset.

A payment does not move coins. It **creates or shrinks obligations** along a path of credit lines (and, when the books already run the other way, it **unwinds** those claims).

## Mental model

- **Credit line** — B is willing to be owed by A, up to a limit, at an APR. A can *draw* on B: A becomes debtor, B creditor.
- **Obligation** — the actual debt. One pair/asset can have several rows (different rates). **Exposure** is principal + live interest.
- **Clearing offer** — B’s standing terms for *forwarding* a path through them (and for *buying* someone else’s claim). Specific next hop, or **global** (any next hop).
- **Currency policy** — a debtor’s quote to rebook their debt from one asset to another (FX + optional fixed fee).

Alice paying Carol $1 via Bob:

1. Alice draws on Bob’s line → Alice owes Bob $1.
2. Bob forwards to Carol (Bob must have a live clearing offer with forward on; Carol must have lined Bob, **or** Bob must already owe Carol) → Bob owes Carol $1.

Carol is paid in the sense that she holds a claim. Bob is the middle book.

If Carol later pays Alice $1 back the same way, those two claims **auto-net** to zero. Carol does **not** need Bob to have lined her, and Alice does not need to have lined Bob, as long as the reverse obligations are still there.

## Credit lines

Posted by the **creditor** (`st_crd_lne` / `setCreditLine`):

| Term | Meaning |
|------|---------|
| Limit | Cap on outstanding exposure (principal + interest), revolving unless deplete is on |
| APR | Daily compound, ppm (`10_000` = 1%) |
| Deplete | If on, each *new* draw also spends a remaining grant; repayment does not restore it |
| Grace | Interest-free window in **seconds** after this pair goes 0→positive |

`limit` is not a deposited balance. Drawing uses unused headroom: `limit − exposure` (and remaining grant if depleting).

Path capacity is larger than line headroom: **headroom + reverse claim** (what the next hop already owes you). A path draw against a reverse claim is booked and immediately netted, so the existing obligation shrinks.

## Obligations and netting

Every draw, deposit, and takeout **auto-nets** that pair/asset: equal value both ways is cancelled.

Reduction order is fixed:

1. Accrued interest first, then principal.
2. Highest APR first (then older `created_at`, then lower id).

A **deposit** is how off-graph value enters: the receiver books a liability to the depositor, then nets. That is also how you *repay* (the creditor deposits the debtor, which books the opposite claim and nets).

`net` is the explicit bilateral cancel. Either party may call.

## Path pay

`path_pay(hops, amount, min_return)` is atomic.

- **Hop 0** — sender draws on the first account (line and/or reverse claim). No hop fee.
- **Later hops** — the current path debtor must have a **usable** clearing offer (`forward_enabled`, not expired). Specific offer if live; otherwise a live global. Take-only or expired specific does **not** block the global.
- **Asset change** — convert the previous edge using the previous edge **debtor’s** currency policy, then continue. If debit auto-net ate that edge, convert uses whatever is left (or fails `min_return`).
- **min_return** — final residual in the last hop’s asset must be at least this.

Off-chain **Find path** (`quotePath`) searches a scoped subgraph (lines + reverse claims + clearing + FX), not the full network. Exact-in: amount is what you send. Exact-out: amount is what the payee should receive; the quote finds the send. Hop cards can show expected hop/FX fees.

You can still edit hops before execute.

## Clearing offers

Posted by the **poster** (`st_clr_ofr` / `st_glb_clr`):

- **Path forward** (optional) — poster is an intermediate; `counterparty` is the next hop or global. Fees are Stripe-style: `out = in × (1 − percent) − fixed`. `max_line_apr` rejects the next hop’s line if that line’s APR is higher.
- **Claim takeout** — while a live row exists, anyone can `sell_claim` to the poster: seller’s claim on a debtor moves to the poster; seller receives face after fees as a claim on the poster. Poster must have line residual on that debtor. Takeout does not require `forward_enabled`.

## Selling a claim

`sell_claim(buyer, debtor, asset, amount)`: you hold a claim on `debtor`, the buyer has a clearing offer and a line to that debtor. Face moves to the buyer; you hold a claim on the buyer for proceeds after fees.

This is not a path payment and does **not** count as “paid in full” for grace.

## Interest

Interest is **daily compound** on principal + already finalized interest.

- Full days: `bal × (1 + APR / 365)` (365-day year, no leap).
- Leftover hours in the current day: pro-rata on that daily rate.

It is computed from the last **principal/rate change**, not from “last time someone clicked Accrue.” The `accrue` action is a no-op. Reads (GraphQL, exposure) include **live** interest. Any action that changes principal **locks** live interest first, then mutates.

So 25 days of a loan already carry 25 days of interest. Interest-on-interest starts after each full day.

Tiny principals can floor to zero daily increment (integer units). Use realistic precision (e.g. 4 dp USD).

## Interest-free grace

A term on the **credit line**, in seconds (UI: None, 1 / 7 / 30 days, or custom days → seconds).

When that pair goes **0 → positive**, the line’s `grace_seconds` is **snapshotted**. Until that window ends, live interest on that pair is **0**. If they **deposit/net the pair to zero** inside the window, the cycle closes with nothing to charge.

After the window, daily compound runs from origination (the “lost grace” case).

Editing the line later does not change an **open** cycle; it applies to the next 0→positive.

Sell, convert, and path_pay do **not** count as a grace payoff. They lock whatever is owed (zero during grace) and move or rebook the claim.

Default in the UI is **7 days**. `0` means interest from the first second.

## Currency (FX)

The **debtor** posts `st_cur_pol`: from-asset → to-asset, fixed fee in from-asset, rate (human “to per 1 from” in the plugin), optional new APR, expiry.

`convert` rebooks an existing claim. The debtor is who **actually owes** `from_asset` on that pair, not whoever posted a policy. Path pay calls convert internally on asset-changing hops (previous edge debtor’s policy).

## Amounts and units

On chain, quantities are raw integers. The plugin and GraphQL use **human decimals** for the asset’s precision (`"1.45"`). APR and hop percent are **ppm** (`10_000` = 1%). FX `fx_rate` is `RATE_SCALE` fixed-point (`1_000_000` = 1:1).

## Architecture

| Layer | Role |
|-------|------|
| **service** | Tables and actions |
| **r-banx** | GraphQL (assets, lines, obligations, clearing, FX, scoped `pathGraph`) |
| **plugin** | WIT `api` for the Supervisor (`setCreditLine`, `pathPay`, `quotePath`, …) |
| **ui** | React app on the `banx` subdomain |

### Actions (service)

| Action | Purpose |
|--------|---------|
| `st_crd_lne` | Set credit line (limit, deplete, APR, grace seconds) |
| `st_clr_ofr` / `st_glb_clr` | Specific / global clearing offer |
| `rm_clr_ofr` / `rm_glb_clr` | Remove offer |
| `path_pay` | Multi-hop draw |
| `sell_claim` | Sell a claim to a buyer’s offer |
| `deposit` | Book a deposit and auto-net |
| `net` | Explicit bilateral net |
| `st_cur_pol` | Post convert quote |
| `convert` | Rebook a claim |
| `accrue` | No-op (interest is live) |
| `get_exposure` | Live pair exposure |
| `add_asset` | Register an asset (service only) |

## UI

- `/accounts` — claims you hold and liabilities you owe; offer/edit lines
- `/payees` — contacts; deposit or draw
- `/path-pay` — Transfer: find a path and execute
- `/policies` — clearing offers and currency policies
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
