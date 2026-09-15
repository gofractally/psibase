# How Banx works

Banx is a **mutual-credit ledger**. There is no cash balance and no token you “have.” Value is always a directed claim: **A owes B** some amount of a registered asset.

A payment does not move coins. It **creates or shrinks obligations** along a path of credit lines. When two people already owe each other, Banx **nets** and keeps only the leftover.

This document is the system: first the idea and stories, then how the book is actually kept.

---

## Mental model

You never have “$10 in an account.” You only have:

- **Claim:** they owe you.
- **Debt:** you owe them.

The rest of Banx is machinery around that:

| Piece | Meaning |
|-------|---------|
| **Credit line** | “I am willing to be owed by you, up to this much, at this APR.” A ceiling, not a pile of money. Posted by the **creditor**. |
| **Obligation** | The actual debt. One pair/asset can have several rows (different APRs). **Exposure** is principal + live interest. |
| **Connection** | One directed pair in one asset: the line (if any) plus both claims. A path hop *is* a connection. Capacity = reverse claim + unused line headroom. |
| **Path-forward offer** | “I will sit in the middle of a path.” Specific next hop, or **global**. |
| **Claim offer** | Standing bid or ask to **transfer** a claim on a debtor (not a path payment). |
| **Currency policy** | Posted from→to FX quote. Path pay uses it only to **size** the next hop. `convert` actually rebooks. |
| **Request** | Invoice or please-book. Consent around who may write or pull. |

Alice paying Carol $1 via Bob:

1. Alice draws on Bob → Alice owes Bob $1.
2. Bob forwards to Carol (Bob has a live path-forward offer; Carol lined Bob, **or** Bob already owes Carol) → Bob owes Carol $1.

Carol is paid because she holds a claim. Bob is the middle book.

If Carol later pays Alice $1 the same way, those two claims **auto-net** to zero. Carol does **not** need Bob to have lined her, and Alice does not need to have lined Bob, as long as the reverse obligations are still there.

---

## Stories

### 1. Alice and Bob (direct friends)

They split dinners, petrol, concert tickets. No one else is involved.

**Bob pays the whole dinner, $60.** Alice’s share is $30.

Alice records it. Banx writes:

> Alice owes Bob $30.

That’s a **deposit**: real life happened (Bob paid the restaurant), and the book remembers.

**Next week Alice pays for both of them, $40.** Bob’s share is $20.

Bob records it:

> Bob owes Alice $20.

Banx sees both claims and **nets**. Now Alice only owes Bob $10.

That’s Splitwise. Deposit when someone covers you. The book shrinks by itself.

To “pay it off” in cash, Alice hands Bob $10 and records that she received $10 of value from him — the last claim nets away. They’re even.

No paths. No middle people. Just two friends and the notebook.

### 2. Pippa, Oli, and Jo (a little triangle)

- Pippa pays Oli **$800 rent** each month.
- Pippa and **Jo** shop together.
- **Oli and Jo** are engaged. They have a **deep credit line** between them.

They each fill their own trolley. At the till, **Pippa pays for both baskets**. Jo’s share was $70. Pippa sends Jo a **please-book**:

> I just paid $70 for your groceries. Please accept.

Jo hits **accept**. That is Jo’s **deposit**. Banx writes:

> Jo owes Pippa $70.

Pippa now holds a **claim on Jo**.

When rent is due, **Oli invoices Pippa $800**. Pippa pays **through Jo**:

1. **Pippa to Jo.** She already has a claim on Jo, so this hop **shrinks** it. No new line needed.
2. **Jo to Oli.** Jo draws on Oli’s line. Jo has a **path-forward offer**. Banx books Jo’s debt to Oli and nets whatever they already owe each other.

The invoice is paid because the last hop is Oli. Oli never “sees” money from Pippa. What he notices is that **Jo owes him more** (or he owes Jo less).

If Pippa’s claim on Jo is short of $800, she can hand Jo cash and Jo records a deposit. That tops up Jo’s debt to Pippa so the path will go through.

### 3. John needs a tradie, and nobody has cash

John asks **Oli** to do a $150 job. No cash in the house. They both trust **Pippa**.

John **path-pays Oli through Pippa**:

1. **John to Pippa.** John owes Pippa $150.
2. **Pippa to Oli.** Pippa owes Oli $150 extra.

John’s books with Oli are done. **Collecting is Pippa’s problem now, not John’s.**

### 4. Sleepover weekend

**Sam** sleeps over at **Riley’s**. Riley’s parent buys Sam a Happy Meal on a Visa.

Sam **path-pays Riley’s parent** through Sam’s parent:

1. Sam draws on the family line. Sam now owes their own parent.
2. Sam’s parent draws on Riley’s parent. The households trust each other for a weekend of this.

Riley’s parent never needs Sam’s bank details. The Visa bill is theirs; the book says **Sam’s parent owes them**. Next weekend the debts run the other way and **net**.

### 5. Mitchell’s bucks (clearing through the groom)

**Mitchell** is getting married. **John** is organising the bucks among the men: **Zac**, **Daniel**, **Josh**, and himself. There will be other guests, but these four are the ones putting cards down.

The weekend needs money **now**, before anyone is in the same room: a house, tickets, a deposit for the entertainment. The usual way is ugly. Whoever books the Airbnb is $1,000 out. Then they chase the others for cash on a loud night, or swap BSB and account numbers in a group chat. Someone always ducks. The bloke who paid is stuck.

Mitchell does not want his friends in that position. Before anything is booked he **extends a decent credit line to each invitee** — he is willing to be owed by them, enough to cover a share of the weekend. He also says he will **sit in the middle** (a path-forward offer). The men who might front a bill line him the other way, so they can hold a claim **on Mitchell** instead of on each other.

Now the expenses:

**John books the house, $1,000 on his card.** Five shares of $200. He keeps his own and **invoices** Mitchell, Zac, Daniel, and Josh $200 each.

They do not PayID John. They **path-pay him through Mitchell**:

1. **Zac to Mitchell.** Zac draws on Mitchell’s line. Zac owes Mitchell $200.
2. **Mitchell to John.** Mitchell forwards. John now holds a claim on Mitchell (or Mitchell owes him less).

Same for Daniel and Josh. John is **paid**. He is not chasing Zac’s bank details. He is owed by **Mitchell**.

**Zac buys the tickets, $400.** He invoices the other four $80. They pay through Mitchell again. Zac is not floating four mates until Monday.

**Daniel puts down the entertainment deposit.** Same invoices, same path. He is not the group’s unofficial lender.

By the next day the pairwise IOUs between the bucks have been **exchanged for Mitchell’s debt**. Look at the books:

- Each invitee owes **Mitchell** their share of what they did not front themselves.
- Whoever paid a real card holds a claim **on Mitchell** for the rest of that bill.

Nobody has to settle with four hungover people. **Only Mitchell chases or settles.** He can collect cash, net against a claim he already has, or wait. The man who put the house on his Visa already has his settlement path. No awkward cash requests on or after the night.

---

## The ledger

Everything lives on **Banx**, a psibase service. Quantities on chain are **raw integers** at the asset’s precision (USD 4 dp → `1.0000` is `10000`). GraphQL and the plugin show human decimals.

### Assets

Registered currencies (`usd`, `aud`, …). Compact `u16` id everywhere else; `symbol` is the name. Precision is fixed at registration (max 8). Anyone can `add_asset`.

### Obligations

A row is: `debtor` owes `creditor` this `asset_id`, at one APR.

- Several rows per pair if draws happened at different rates.
- `remaining_principal` + `accrued_interest` (finalized).
- **Exposure** = Σ(principal + **live** interest) for that directed pair/asset.
- Empty rows are deleted.

Writers **lock** live interest before changing principal, then mutate. Reads (GraphQL, `get_exposure`) include live interest without writing.

### Netting

Every draw, deposit, claim transfer, and convert **auto-nets** the pair/asset.

1. Accrue both directions.
2. Cancel `min(exposure each way, max)`.
3. Reduce each direction: **all interest first** (highest APR, then older, then lower id), **then principal** in the same order.

`net` still exists as an action for scripts. The UI does not expose it; writers already full-net.

### Write-off (`forgive`)

The creditor drops some or all of a claim they hold. One-sided `apply_reduction` — the debtor does not sign. Same waterfall as net (interest first, highest APR). Capped at live exposure.

- **Partial** does **not** reset an open grace snapshot (same as a partial deposit).
- **Principal → 0** closes the cycle. A later 0→positive starts a new window.

UI: write-off on a savings/deposit row.

### Credit lines

Posted by the creditor (`st_crd_lne`). The debtor must already exist as a chain account.

| Term | Meaning |
|------|---------|
| Limit | Cap on outstanding **exposure** (principal + interest) |
| APR | Daily compound, ppm (`10_000` = 1%) |
| Remaining | Unused depleting-line budget. Ignored on revolving lines |
| Deplete | If on, each `new_draw` spends `remaining`; repayment does not restore it |
| Grace | Interest-free window in **seconds** after this pair goes 0→positive (stored on a **pair cycle**, not on the line row) |

`limit` is not a deposited balance. Drawing uses **headroom**: `limit − exposure` (and `remaining` if depleting).

A **0-limit line** is still a line: consent to be a known counterparty. Removing the row is `rm_crd_lne`. Outstanding obligations are untouched.

### Connection (a path hop)

Not a table. For creditor C, debtor D, asset X:

- **Forward:** D already owes C.
- **Reverse:** C already owes D (unwind — **no line required**).
- **Line:** C’s facility to D, if any.

**Headroom** = unused line (`limit − exposure`, also capped by `remaining` if depleting).
**Capacity** = reverse claim + headroom.
**new_draw** = amount − reverse (the part that hits the line).

**Draw** of 1000 against a 400 reverse claim: unwind 400 + new_draw 600. After net, D owes C 600. `remaining` (depleting lines) is consumed only for **new_draw**.

`knows(who, them, asset)`: `who` lined `them` (0-limit is enough), or `who` already owes `them`. A claim only the other way (`them` owes `who`) is not enough — anyone can create that with `deposit`. A hop that only unwinds such a reverse claim (`new_draw == 0`) is still allowed.

---

## Path pay

`path_pay(hops, amount, min_return)` is atomic. Each hop is `(account, asset_id)`: draw on that account in that asset.

### Hop 0

The **sender** draws `amount` on the first hop. No hop fee. Needs a connection (line and/or reverse claim).

### Later hops

The current path debtor (the previous hop’s account) must have a **live path-forward offer**:

- Live **specific** next hop if present; else live **global**.
- Expired specific does **not** block the global.
- Fees are Stripe-style: `out = in × (1 − percent) − fixed`. Hop 0 has no fee.
- `max_line_apr` rejects a **new_draw** if the next hop’s line APR is higher. A hop that only unwinds a reverse claim is not checked.
- `allow_unknown`: if off, the poster must already know the next hop (lined them, or already owes them). A hop that only unwinds a reverse claim does not need that. If on, anyone who lined the poster can become their creditor. Checked at **pay** time, not when posting. A specific offer may be posted before that hop knows the poster; at pay time the hop still needs a line, existing debt, or unwind capacity.

### Currency change

If hop *i*’s asset differs from hop *i−1*, the previous hop’s **creditor** (the middle man) applies their FX quote to **size** the next hop. That does **not** rebook the previous claim: the payer still owes the middle man in the from-asset; the middle man takes the to-asset liability onward. The sender’s FX policy is ignored.

`min_return` is the final **amount_out** in the **last** hop’s asset.

### Paying an invoice

`pay_inv(hops, max_spend, request_id)`:

- Remaining on the invoice is the exact **out**.
- Walk hops **backward** (undo hop fees, then FX) to compute the required send.
- Require send ≤ `max_spend`, then execute that send.
- Last hop must be the invoice poster in that asset.

`path_pay` can also pass a `request_id`; it ticks remaining after a successful walk. Prefer `pay_inv` when paying a bill.

An invoice fulfill **does not** shrink an existing debt to the payee. The books that change are the hop draws. Fulfill only decreases `remaining` and writes history.

### Finding a path (off-chain)

`quotePath` / `pathGraph` search a **scoped subgraph** (lines + reverse claims + forward offers + FX), not the whole network. Same fee/FX formulas as chain. Exact-in: amount is what you send. Exact-out: amount is what the payee should receive; the quote finds the send.

The chain still executes whatever hop list you pass. The search is a helper, not an enforcer.

---

## Deposits and requests

### Deposit

Off-graph value enters here: cash, dinner, groceries. The **receiver** (signer) books a liability to the **depositor**, then auto-nets. That is also how you **repay**: the creditor deposits the debtor (opposite claim + net).

Optional `interest_rate` on the new bucket. Optional `request_id` to fulfill a please-book.

### Two request kinds (`st_req`)

Counterparty, amount, memo (80 bytes), optional expiry. Fulfillment is partial (`remaining` declines). Poster can `rm_req` while still open. Cancel erases the row; a fully paid request stays with `remaining = 0`.

| Kind | Poster | Who fulfills | Effect |
|------|--------|----------------|--------|
| **Invoice** (`1`) | Payee | Anyone with a path to the poster (`pay_inv`). `counterparty` is who was billed; `0` = anyone | Last hop must be the poster. Does not shrink a prior loan to that payee. |
| **Please-book** (`2`) | Person who sent value off-graph | **Only** the named creditor, via `deposit` | Opposite claim + auto-net. The poster cannot book this themselves. |

Invoice `counterparty` may be 0. Please-book requires a named, existing account.

---

## Claim offers (buy / sell a claim)

Not a path payment. You transfer a claim on a **debtor** to a **buyer**. The seller receives face after the **maker’s** spread as a claim on the buyer (0% APR). The moved claim **keeps its existing APR**.

One table, `side` in the primary key (`1` buy, `2` sell). `debtor = 0` is global. Spread ppm is signed (`10_000` = 1%):

- **Buy** (poster’s bid, taker calls `sell_claim`): positive haircuts the seller; negative is a premium the buyer pays.
- **Sell** (poster’s ask, taker calls `buy_claim`): positive is the seller’s profit; negative is a discount.

`out = in × (1 − spread) − fee_fixed` after flipping sell so positive is the poster’s profit.

The **debtor must know the buyer** (line to them, or a live claim). New exposure requires the **buyer’s credit line** to the debtor and is **capped** with the same capacity as a path hop (reverse claim + headroom); `remaining` is spent only on **new_draw**. A take that only unwinds a reverse claim needs no buyer line. The offer is the rate; the line is who and how much. Checks run at **take**, not at post.

Sell / convert / path_pay are **not** a grace payoff. They lock whatever is owed (zero during grace) and move or rebook. A sold claim keeps the source cycle’s remaining window (same end). It does not start the buyer’s posted grace.

---

## Interest

Daily compound on principal + already finalized interest. Path-independent: one evaluation from the last principal/rate change.

- Full days: `bal × (1 + APR / 365)` (365-day year, no leap).
- Leftover seconds in the current day: pro-rata on that daily rate.
- ppm: `10_000` = 1%, `PPM_SCALE` (`1_000_000`) = 100%.

Interest-on-interest starts after each full day. Tiny principals can floor to zero daily increment (integer units). Use realistic precision (e.g. 4 dp USD).

Compounding walks day by day in WASM, so a loan left untouched for years is more CPU at the next principal change.

### Grace

Posted with the credit line, stored on **PairCycle** `(creditor, debtor, asset)` so a later line upsert cannot clobber the clock.

When that pair goes **0 → positive**, posted `grace_seconds` is **snapshotted**. Until that window ends, live interest is **0**. If they deposit/net/forgive the pair to **zero** inside the window, the cycle closes with nothing to charge. Partial reductions leave the snapshot.

After the window, daily compound runs from the last principal/rate change (origination if nothing changed during grace). Editing the line later does not change an **open** cycle; it applies to the next 0→positive. `0` means interest from the first second.

---

## Currency (FX)

Anyone posts `st_cur_pol`: from-asset → to-asset, fixed fee in from-asset, `fx_rate` (`RATE_SCALE` fixed-point, `1_000_000` = 1:1), optional APR for the rebooked bucket, expiry.

`to = (from − fee_fixed) × fx_rate / RATE_SCALE`.

**`convert`** is a take: the other party uses the **counterparty’s** live quote (the poster must be one of the two parties). Nets `from_asset` first, rebooks leftover at that offer, then auto-nets `to_asset`. You cannot re-denominate a claim at a rate you set yourself.

**Path pay** does not call `convert`. It only uses the middle man’s quote to size the next hop.

---

## Cash window (Banx ↔ Tokens)

Banx claims stay claims. Tokens stay Tokens. A **cash quote** is the edge: the poster (cashier) says a Tokens `TID` trades for a Banx asset at `fx_rate`, not necessarily 1:1.

`to = (from − fee_fixed) × fx_rate / RATE_SCALE`.

| `is_out` | From | To | Take |
|----------|------|-----|------|
| true | Banx | tokens | `cash_out`: draw on the poster’s line, receive tokens from their vault |
| false | tokens | Banx | `cash_in`: send tokens into the poster’s vault, book a deposit onto the poster |

Inventory is Banx’s Tokens sub-account `{account}/{token_id}`. `csh_fund` is credit Banx, then Banx `toSub` into **your** bucket. `csh_wd` is `fromSub` back to you. `cash_in` `fromSub`s the taker and `toSub`s the cashier (same bucket `cash_out` spends). No Banx vault table.

Out uses the same capacity / remaining as a path draw. In is the same book as deposit (repay if you owe them; otherwise you hold a claim on them). The poster’s quote is consent. Tokens history records the coin move; Banx activity is `cash_out` / `cash_in`.

Multiple tokens per Banx asset: one quote row per `(poster, asset, token, is_out)`.

---

## History

Each writer emits a bilateral `history.banx-app.activity` event: one row per party as `account`, the other as `counterparty`. Amounts are **human decimals** at emit (asset precision; convert’s `netted` uses the destination asset).

Kinds include `path_draw`, `path_pay`, `deposit`, `book`, `net`, `forgive`, `convert`, `cash_out`, `cash_in`, `credit_line`, `rm_credit_line`, `book_auth`, `rm_book_auth`, `sell_claim` / `buy_claim`, `invoice`, `please_book`, `fulfill`, `req_cancel`.

Hop draws write the adjacent pairs (Alice↔Bob, Bob↔Carol). A **multi-hop** `path_pay` / `pay_inv` also writes **sender↔payee** (`kind: path_pay`): `amount` is what was sent (`asset_id` = first hop), `netted` is what was delivered (`other_asset_id` = last hop). Direct (1-hop) pays are only `path_draw` on that pair — same two people.

GraphQL `activity(account, counterparty?, assetId?)` is the pair view when both filters are set (matches `asset_id` **or** `other_asset_id`, so a USD delivery still shows on an AUD pair view). Omit them for the account feed (Accounts page). `asset_id` is interpolated as an integer in SQL (`?` would bind as text and miss). Claim-transfer `memo` is the **debtor**.

---

## Layers

| Layer | Role |
|-------|------|
| **service** (`banx`) | Tables and actions. Source of truth. |
| **r-banx** | GraphQL: assets, lines, obligations, offers, FX, requests, scoped `pathGraph`, pair or account `activity`. |
| **plugin** | WIT `api` for the Supervisor (`setCreditLine`, `pathPay`, `quotePath`, …). Human decimals in, raw out. |
| **ui** | React app on the `banx` subdomain. |

Off-chain path search lives in the service crate (`path_find`) and is called from the plugin. The query service only serves the subgraph.

### UI surfaces

- `/accounts` — claims you hold and liabilities you owe; offer/edit lines; transfer dialog; activity feed below. Old `/path-pay` links redirect here.
- `/requests` — invoices, deposit requests
- `/policies` — path-forward, claim offers, currency
- `/assets` — registered assets

`/obligations` redirects to `/accounts`.

---

## Units cheat sheet

| Thing | Unit |
|-------|------|
| Amounts on chain | Raw `u64` at asset precision |
| Amounts in GraphQL / plugin / UI | Decimal strings (`"1.4500"`) |
| APR, hop %, claim spread | ppm (`10_000` = 1%) |
| FX `fx_rate` | `RATE_SCALE` (`1_000_000` = 1:1) |
| Grace / expiry | Seconds (`0` expiry = never) |
| Asset precision | 0–8 decimal places |

---

## The pieces the stories used

**Deposit** — “Something real happened. Write it down.” Then net. Jo hitting accept *is* a deposit.

**Please-book** — “Please write down that I covered you.” Pippa cannot put Jo in debt by herself.

**Invoice** — “Please pay me this.” Paid with a claim or a path. Last hop is the payee.

**Net** — two people owe each other; keep only the leftover.

**Write-off / forgive** — you hold a claim and drop some or all of it. They do not sign. Partial keeps grace; zero principal closes the cycle.

**Credit line** — “I’ll let you owe me up to X.” Needed when someone draws *new* debt on you. Not needed to unwind an IOU that already exists.

**Path pay** — pay someone by walking through a friend, all or nothing.

**Path-forward** — “I’ll be that friend in the middle.” Mitchell on the bucks weekend.

**Buy-claim / sell-claim** — someone *buys your IOU*. Different tool from path pay. Not in these stories.
