# Favor

Favor is a **mutual-credit** ledger. There is no cash balance and no token you “have.” Value is always a directed claim: **A owes B** some amount of a registered asset.

A payment does not move coins. It **creates or shrinks obligations** along a path of credit lines (and, when the books already run the other way, it **unwinds** those claims).

Credit is **interest-free**. Nothing accrues on a claim: what is owed today is what was booked, less what has been paid back or written off. There is no APR, grace period, or compounding anywhere.

## Mental model

- **Credit line** — B is willing to be owed by A, up to a limit. A can *draw* on B: A becomes debtor, B creditor.
- **Pair** — one row per two accounts and one asset. It holds a single signed **balance** (who owes whom, and how much) plus each side’s optional credit line. Only one direction is ever owed.
- **Path-forward offer** — B’s standing terms for *sitting in the middle* of a `path_pay`. Specific next hop, or **global** (any next hop).
- **Claim offer** — standing **buy** (`sell_claim` hits it) or **sell** (`buy_claim` hits it) **spread** for transferring a claim on a debtor. Specific debtor, or **global**. Who and how much come from the buyer’s credit line to that debtor.
- **FX offer** — a posted from→to FX offer. Others take it with `convert` (or `take_fx`). Path pay uses it to size a hop when the poster is in the middle.

Alice paying Carol $1 via Bob:

1. Alice draws on Bob’s line → Alice owes Bob $1.
2. Bob forwards to Carol (Bob must have a live path-forward offer; Carol must have lined Bob, **or** Bob must already owe Carol) → Bob owes Carol $1.

Carol is paid in the sense that she holds a claim. Bob is the middle book.

If Carol later pays Alice $1 back the same way, those two claims **auto-net** to zero. Carol does **not** need Bob to have lined her, and Alice does not need to have lined Bob, as long as the reverse obligations are still there.

## Credit lines

Posted by the **creditor** (`st_crd_lne` / `setCreditLine`). The debtor must already exist as a chain account.

| Term | Meaning |
|------|---------|
| Limit | Cap on what the debtor may owe, revolving unless deplete is on |
| Remaining | Unused depleting-line budget. Ignored on revolving lines |
| Deplete | If on, each `new_draw` spends `remaining`; repayment does not restore it |

`limit` is not a deposited balance. Drawing uses **headroom**: `limit − owed` (and `remaining` if depleting).

A path hop is a **connection**: that directed pair in one asset — the creditor’s line (if any) plus both claims. **Capacity** is reverse claim + headroom. A draw unwinds the reverse claim, then books **new_draw** on the line (1000 against a 400 reverse claim → unwind 400 + new_draw 600). The reverse claim does not need a line.

A **0-limit line** is still a line: consent to be a known counterparty. `rm_crd_lne` removes the line and leaves any balance untouched.

Lines cost nothing to use. Intermediaries and market makers earn only from what they post: **forward fees**, **claim-sale spreads**, **FX / cash fees**, and **relay curves**.

## Balance and netting

Each `Pair` is keyed by `(low, high, asset)`, where `low` is the account with the smaller account number. Its `balance` is signed: `> 0` means `high` owes `low`; `< 0` means `low` owes `high`. `low_line` and `high_line` are each side’s credit line (`limit`, `deplete`, `remaining`). A row with no balance and no line is deleted.

Balances are `i64` internally, so a single claim balance cannot exceed `i64::MAX` base units; booking past that fails.

Every write that books a claim **auto-nets**: a claim that meets a reverse claim cancels it first, so only one direction is ever owed. Equal value both ways cancels to zero; otherwise the leftover points one way.

A **deposit** is how off-graph value enters: the receiver books a liability to the depositor, then nets. That is also how you *repay* (the creditor deposits the debtor, which books the opposite claim and nets).

There is no `net` action; writers already full-net.

`forgive` is a one-sided write-off: the **creditor** reduces what the debtor owes them (capped at the amount owed; a zero balance does nothing). The debtor does not sign. UI: write-off on a savings row.

## Requests

Two kinds (`st_req` / `createRequest`). Counterparty, amount, memo (80 bytes), optional expiry. Invoice `counterparty` may be `0` (anyone). Please-book requires a named party.

| Kind | Poster | Fulfiller | Effect |
|------|--------|-----------|--------|
| **Invoice** (`1`) | Payee | Anyone with a path to the poster, via `pay_inv` (`counterparty` is who was billed; `0` = open) | Walks hops backward from remaining; `max_spend` is the send budget. Does **not** shrink an existing loan to that payee. |
| **Please-book** (`2`) | Debtor (or whoever sent value off-graph) | **Only** the named creditor, via `deposit` with `request_id` | Opposite claim + auto-net. The poster cannot book this themselves. |

Fulfillment is partial (`remaining` declines). Poster can `rm_req` while still open. Activity records `request_id` and memo on create / cancel / fulfill (and on the deposit that books a please-book).

UI: `/requests` (Plus to create). An account-row Request button opens the same modal with the party filled in (payer field omitted). Kinds in the UI: invoice, deposit request (please-book). Incoming invoices open Transfer with the invoice id.

## Path pay

`path_pay(route, amount, min_return, request_id)` is atomic. `route` is a sealed blob from `quotePath`, not a hop list. The query service searches, then seals the hops; execution opens the blob and never searches. It checks the sender is the quoted payer, the blob is not expired (60 seconds) and was sealed with the current key, and `amount` matches. Everything below describes what each hop then does.

**Every hop is quoted to an exact amount.** Each sealed slot carries what that hop draws, in the hop's asset and after fees. Execution prices every hop live and aborts with `path price changed since the quote` if any draw differs. A forward fee, FX quote or relay reserve replaced after the quote therefore fails the payment outright. It does not fill at a worse price just because that price is still above `min_return`. `min_return` stays as your own floor on top. A fee that moves and moves back before inclusion does not matter, and settings that do not change any draw (a looser limit, a later expiry) do not invalidate a quote. There is no separate revision counter on lines or offers.

- **Hop 0** — sender draws on the first account (line and/or reverse claim). No hop fee.
- **Later hops** — the current path debtor must have a **live** path-forward offer. Specific next hop if live; otherwise a live global. Expired specific does **not** block the global. Buy-claim offers are not used here.
- **Asset change** — the previous hop’s **creditor** (middle man) sizes the next hop: with their relay curve for the pair if they posted one, otherwise their creditor-side FX offer. The payer’s claim stays in the from-asset; the middle man takes the to-asset liability. The sender’s offer is ignored.
- **min_return** — final **amount_out** in the last hop’s asset must be at least this.
- **Invoice** — `pay_inv(route, max_spend, request_id)`: remaining is exact, `max_spend` is the send budget.

**Find path** (`quotePath` on the query service) needs a signed-in caller who is the payer or the payee. It searches a scoped subgraph (lines + reverse claims + clearing + FX), not the full network, and returns the sealed route with amounts in raw units, an expiry, and a hop count. It does not return the hops. Exact-in: amount is what you send. Exact-out: amount is what the payee should receive; the quote finds the send. The UI shows the send, the receive, and the hop count only.

### Repeating payments the payee runs

The payer picks the route of any payment she signs. A repeating payment is different: the payee can run it, so the payee picks the route. A line to the payer is no protection, because anyone can extend one unasked. A payee could open a line to the payer from a second account, charge a high forwarding fee on it, and route the payment through it, collecting up to `max_spend` minus `amount` every period and leaving the payer owing that account.

So when the payee runs a series, the first hop must be one of:
- the payee, whom the payer named when creating the series,
- an account the payer **knows**: she has a line to them (even at limit 0) or already owes them, or
- an account that owes the payer at least the draw, so it only cancels their debt.

This is the same test a forwarder with `allow_unknown` off applies to its next hop. The payer's own run is her own choice of route and has no such limit. The payee's quote only offers starts the chain will accept, so a payer who wants her payee able to collect through a hub should line that hub (limit 0 is enough). A hub that forwards to anyone (`allow_unknown` on) still lets a later hop be chosen by the payee, and `max_spend` remains the ceiling.

### What the seal does and does not hide

The route is sealed with a 12-slot envelope, padded so the blob does not show how many hops were used. The UI and plugin never handle hops. The key is **objective state** and is passed as an action argument, so it is readable by any service and by anyone reading history. The seal is not secrecy from validators.

The query service answers private data only to a signed-in caller, and only with rows the caller is a party to: `creditLines`, `obligations`, `bookAuths`, `exposure`, `requests`/`request`, `payAuths`, `forwardOffers` (your own routing fees), `invites` and `activity` (your own history). Asking about another account returns just what is between you and them. There is no network-wide line, forwarding or path-graph query, so Favor has no network map: other people's lines are not shown. Public marketplace data stays public: assets, claim offers, FX offers, relays, token relays, cash quotes and vaults, and a single invite by id (its link is how it is claimed).

This is a limit of the query service, not of the chain. The `Pair`, `ForwardOffer` and other rows are ordinary service tables that any service can read, and executed hops still emit `path_draw` activity events naming each pair. Caller-scoped queries stop Favor's own API from handing out the graph. They do not make the ledger private.

### Routing key

Until a key is set, every route action fails with `routing key is not set`. `deploy.sh` sets one when `routingReady` is false and leaves an existing key alone, so a redeploy does not invalidate open quotes. `ROTATE_KEY=1 ./packages/user/Favor/deploy.sh` replaces it, which does. The GraphQL `routingReady` field says whether a key exists.

## Path-forward offers

Posted by the **poster** (`st_fwd_ofr` / `st_glb_fwd`): poster is an intermediate; `next_hop` is the next creditor or global. Fees are Stripe-style: `out = in × (1 − percent) − fixed`. The fee is the only price of sitting in the middle: lines carry no interest. A specific offer can be posted before that hop knows the poster; the hop still needs a line or live claim at `path_pay` time. The named next hop must exist. `allow_unknown` (checked at pay time): if off, the poster must already know the next hop (a line to them, or existing debt to them); a hop that only unwinds a reverse claim is allowed without that. If on, anyone who lined the poster can become their creditor. `st_fwd_unk` is a flag-only update without re-posting fees.

## Claim offers

One table, `side` in the primary key (`1` buy, `2` sell). Spread ppm is signed (`10_000` = 1%). **Buy:** positive haircuts the seller, negative is a premium the buyer pays. **Sell:** positive is the seller’s profit (`+10_000` = 1% over face), negative is a discount. The debtor must know the buyer (a line to them, or a live claim) when the take creates new exposure. New exposure requires the buyer’s credit line to the debtor and is capped like a path hop (reverse claim + headroom). That line’s depleting budget is spent only on **new_draw**; a take that only unwinds a reverse claim needs no buyer line. The offer itself has a separate face budget, spent on every take and left at 0 so it can be topped up. The line is who and how much new exposure.

- **Buy** (`st_buy_clm` / `st_glb_buy`): poster’s bid. Taker calls `sell_claim`.
- **Sell** (`st_sell_clm` / `st_glb_sell`): poster’s ask. Taker calls `buy_claim`.

## Transferring a claim

Claims are fungible: a claim on a debtor is just part of the debtor’s `Pair` balance with the holder. A transfer moves that balance from the seller to the buyer on the debtor. The proceeds (face after the spread) are an ordinary claim between buyer and seller, so the spread is the only price.

`sell_claim(buyer, debtor, asset, amount, min_proceeds)`: you hold a claim on `debtor` and hit the buyer’s **buy** offer. A positive `min_proceeds` is the floor you sign.

`buy_claim(seller, debtor, asset, amount, max_cost)`: you buy the seller’s claim on `debtor` under their **sell** offer. A positive `max_cost` is the cap you sign. The cost you owe the seller is a draw on the **seller’s credit line to you** (reverse claim + headroom). Their ask alone does not take your IOU. Unwinding a debt they already owe you needs no line.

`sell_claim` pays the seller with a deposit, because the seller is signing and accepts the buyer’s IOU. Either way the face moves to the buyer. Not a path payment.

## Currency (FX)

Anyone posts `st_fx_ofr`: from-asset → to-asset, `poster_is_creditor` (which debt direction the offer applies to), fixed fee in from-asset, rate (human “to per 1 from” in the plugin), `remaining` (from-asset still accepted), expiry. That is an **offer**.

`convert` is a take: sender uses the **counterparty’s** live quote, not their own. It reduces the leftover `from_asset` claim between the two and rebooks that amount in `to_asset` at that offer, auto-netting against any `to_asset` claim the other way. Neither party can re-denominate a claim at a rate they set themselves.

`take_fx` takes a posted order (`poster_is_creditor` picks the row). A **buy** rebooks any from-asset the taker still owes the poster (as in `convert`), then opens both legs for the rest: the taker owes the poster the from-asset and the poster owes the taker the priced to-asset (each leg needs that party’s line as capacity, or a reverse claim to unwind). A **sell** only rebooks from-asset the poster owes the taker.

Path pay does **not** rebook. It only uses the middle man’s quote to size the next hop.

A **relay** (`st_relay`) is a constant-product curve between two Favor assets. Both reserves are virtual weights, not a debt, and one row prices both directions. If the previous hop’s creditor posted a relay for the pair, a path that changes asset there uses the curve instead of an FX offer. The curve itself has no fee; a path that continues pays the forward fee. `st_tok_relay` is the Favor↔token version (token reserve held in a Tokens sub-account).

## Amounts and units

On chain, quantities are raw integers. The plugin and GraphQL use **human decimals** for the asset’s precision (`"1.45"`). Hop percent and claim spread are **ppm** (`10_000` = 1%). FX `fx_rate` is `RATE_SCALE` fixed-point (`1_000_000` = 1:1). Pair balances are `i64`, so a single claim balance cannot exceed `i64::MAX` base units.

## Architecture

| Layer | Role |
|-------|------|
| **service** | Tables and actions |
| **r-favor** | GraphQL: caller-scoped lines, obligations, requests and history; public offers, FX, relays; `quotePath` returns a sealed route |
| **plugin** | WIT `api` for the Supervisor (`setCreditLine`, `pathPay`, `quotePath`, …) |
| **ui** | React app on the `favor-app` subdomain |

### Actions (service)

| Action | Purpose |
|--------|---------|
| `st_crd_lne` | Set credit line (limit, deplete) |
| `rm_crd_lne` | Remove a credit line (0-limit is not a remove) |
| `cr_invite` / `rm_invite` | Create / delete a Favor invite; first accept extends a credit line (limit, deplete) to the claimee |
| `st_bk_ath` / `rm_bk_ath` | Debtor lets a creditor `book` onto them up to `remaining` (optional expiry) |
| `book` | Creditor books onto a debtor under their book-auth; same ledger as `deposit`, auto-nets |
| `st_fwd_ofr` / `st_glb_fwd` | Specific / global path-forward offer (fee, expiry, `allow_unknown`) |
| `st_fwd_unk` | Flag-only `allow_unknown` update (`next_hop` 0 = global) |
| `rm_fwd_ofr` / `rm_glb_fwd` | Remove path-forward offer |
| `st_buy_clm` / `st_glb_buy` | Specific / global buy claim offer |
| `rm_buy_clm` / `rm_glb_buy` | Remove buy claim offer |
| `st_sell_clm` / `st_glb_sell` | Specific / global sell claim offer |
| `rm_sell_clm` / `rm_glb_sell` | Remove sell claim offer |
| `path_pay` | Multi-hop draw (`min_return`; optional `request_id` ticks an invoice) |
| `pay_inv` | Pay invoice: exact remaining, `max_spend` budget |
| `st_pay_ath` / `run_pay_ath` / `rm_pay_ath` | Repeating payment: create (`max_spend` per period) / run the oldest due period / delete. A payee-run must start at the payee, an account the payer knows, or an account that owes the payer |
| `sell_claim` | Sell a claim into a buyer’s offer |
| `buy_claim` | Buy a claim from a seller’s offer |
| `deposit` | Book a deposit and auto-net (`request_id` 0 or please-book) |
| `st_req` / `rm_req` | Create / cancel invoice or please-book |
| `forgive` | Creditor write-off of what a debtor owes them (one-sided; UI on savings rows) |
| `st_fx_ofr` / `rm_fx_ofr` | Post / remove a from→to FX offer |
| `convert` | Take the counterparty’s FX offer and rebook |
| `take_fx` | Take a posted FX order (rebook, or open both legs) |
| `st_relay` / `rm_relay` | Post / remove a Favor↔Favor relay curve |
| `st_tok_relay` / `rm_tok_relay` | Post / remove a Favor↔token relay |
| `tok_relay_out` / `tok_relay_in` | Draw Favor on the owner for tokens / send tokens for Favor owed by the owner |
| `path_cash` | Path-pay that ends by selling the last hop’s Favor for tokens from their relay |
| `st_csh_qte` / `rm_csh_qte` | Post / remove a Favor↔Tokens cash quote (`is_out` true = out) |
| `csh_fund` / `csh_wd` | Fund / withdraw Tokens sub-account `{poster}/{token_id}` on Favor |
| `cash_out` | Draw Favor on the cashier; tokens from their vault |
| `cash_in` | Take tokens from the sender’s vault; book Favor onto the cashier; tokens stay in the cashier’s vault |
| `get_exposure` | What a debtor owes a creditor in an asset |
| `add_asset` | Register an asset (anyone) |

## UI

- `/accounts` — claims you hold and liabilities you owe; transfer; activity feed. Click a name for `/accounts/:account` (history, lines, book-auth, claims).
- `/payees` — contacts; deposit
- `/requests` — invoices and please-book
- `/cash` — Tokens cash window: post quotes, fund/withdraw vault, cash in/out
- `/policies` — path-forward offers, buy-claim offers, and currency policies

New assets are registered from the currency picker on Accounts. `/assets` redirects there.

`/obligations`, `/history` and `/network` redirect to `/accounts`.

## Build

```bash
# UI
cd packages/user/Favor/ui && yarn && yarn build

# Package (from Favor root)
cargo-psibase package
```

Install with `cargo-psibase install` against a local psinode. Open `https://favor-app.<root>/`. GraphiQL: `/graphiql`.

## Test

```bash
cargo-psibase test   # from packages/user/Favor/service
```
