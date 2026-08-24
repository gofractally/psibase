/// Daily compound interest (path-independent closed form).
pub mod interest;
/// Shared fee / FX integer math (on-chain and path search).
pub mod math;
/// Off-chain path discovery for multi-hop `path_pay` (TokenSwap-style search).
pub mod path_find;
pub mod tables;

#[psibase::service(name = "banx-app", tables = "tables::tables")]
pub mod service {
    use crate::tables::{
        assert_account_exists, emit_pair_activity, path_required_send, run_path, Asset, CashQuote,
        ClaimOffer, Connection, CreditLine, CurrencyPolicy, ForwardOffer, InitRow, InitTable,
        Obligation, PathHop, PayRequest,
    };
    use psibase::{
        services::events,
        services::tokens::{Precision, Quantity, Wrapper as Tokens},
        AccountNumber, EventDb, MethodNumber, TimePointSec, *,
    };

    #[action]
    fn init() {
        // History indexes (safe to re-register on re-init).
        let add_index = |method: &str, column: u8| {
            events::Wrapper::call().addIndex(
                EventDb::HistoryEvent,
                Wrapper::SERVICE,
                MethodNumber::from(method),
                column,
            );
        };
        add_index("activity", 0); // account
        add_index("activity", 1); // counterparty
        add_index("activity", 2); // asset_id
        add_index("activity", 6); // other_asset_id (path_pay / convert)

        let table = InitTable::new();
        if InitTable::read().get_index_pk().get(&()).is_none() {
            table
                .put(&InitRow {
                    next_obligation_id: 1,
                    next_asset_id: 1,
                    next_request_id: 1,
                })
                .unwrap();

            let fiat4 = Precision::new(4).expect("fiat asset precision");
            for (symbol, description) in [
                (account!("usd"), "United States dollar"),
                (account!("aud"), "Australian dollar"),
                (account!("gbp"), "British pound sterling"),
                (account!("euro"), "Euro"),
            ] {
                Asset::add(symbol, fiat4, description.into());
            }

            let metal_precision = Precision::new(6).expect("metal asset precision");
            Asset::add(
                account!("gold"),
                metal_precision,
                "1.000000 = 1 gram of gold".into(),
            );
            Asset::add(
                account!("silver"),
                metal_precision,
                "1.000000 = 1 gram of silver".into(),
            );

            // 7–10 more fiat; 11–12 crypto
            Asset::add(account!("cad"), fiat4, "Canadian dollar".into());
            Asset::add(account!("chf"), fiat4, "Swiss franc".into());
            Asset::add(
                account!("jpy"),
                Precision::new(2).expect("jpy precision"),
                "Japanese yen".into(),
            );
            Asset::add(account!("nzd"), fiat4, "New Zealand dollar".into());

            let crypto8 = Precision::new(8).expect("crypto asset precision");
            Asset::add(account!("btc"), crypto8, "1.00000000 = 1 Bitcoin".into());
            Asset::add(account!("eth"), crypto8, "1.00000000 = 1 Ethereum".into());
        }
    }

    /// Register a new asset. Service-only (`get_sender() == get_service()`).
    ///
    /// Returns the allocated `u16` asset id.
    #[action]
    fn add_asset(symbol: AccountNumber, precision: Precision, description: Memo) -> u16 {
        assert_eq!(get_sender(), get_service());
        Asset::add(symbol, precision, description).id
    }

    /// Set a credit line for the sender as creditor, offering capacity to `debitor`.
    ///
    /// `debitor` must already exist as a chain account.
    /// `amount` is the exposure `limit`: max outstanding principal + accrued
    /// interest (revolving cap), not a deposited balance. See [`CreditLine`].
    #[action]
    fn st_crd_lne(
        debitor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        deplete_on_debit: bool,
        interest_rate: u32,
        grace_seconds: u32,
    ) {
        let creditor = get_sender();
        CreditLine::upsert_credit_line(
            creditor,
            debitor,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate,
            grace_seconds,
        );
        emit_pair_activity(
            creditor,
            debitor,
            asset_id,
            "credit_line",
            amount,
            0.into(),
            asset_id,
            0,
            "",
        );
    }

    /// Remove the sender's credit line to `debitor`. Limit 0 still counts as
    /// a line (consent to be a known counterparty); this erases the row.
    #[action]
    fn rm_crd_lne(debitor: AccountNumber, asset_id: u16) {
        let creditor = get_sender();
        CreditLine::remove(creditor, debitor, asset_id);
        emit_pair_activity(
            creditor,
            debitor,
            asset_id,
            "rm_credit_line",
            Quantity::new(0),
            Quantity::new(0),
            asset_id,
            0,
            "",
        );
    }

    /// Post/update a **specific** path-forward offer (`next_hop` ≠ 0).
    ///
    /// Poster sits in the middle of `path_pay`; next hop is `next_hop`.
    /// Fees: Stripe-style `out = in * (1 - fee_percent) - fee_fixed`.
    #[action]
    fn st_fwd_ofr(
        next_hop: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        max_line_apr: u32,
        expires_at: TimePointSec,
        allow_unknown: bool,
    ) {
        assert!(
            next_hop != ForwardOffer::GLOBAL,
            "use st_glb_fwd for global forward offer (next hop 0)"
        );
        ForwardOffer::upsert(
            get_sender(),
            next_hop,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            expires_at,
            allow_unknown,
        );
    }

    /// Post/update a **global** path-forward offer (`next_hop = 0`).
    #[action]
    fn st_glb_fwd(
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        max_line_apr: u32,
        expires_at: TimePointSec,
        allow_unknown: bool,
    ) {
        ForwardOffer::upsert(
            get_sender(),
            ForwardOffer::GLOBAL,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            expires_at,
            allow_unknown,
        );
    }

    /// Remove a **specific** path-forward offer.
    #[action]
    fn rm_fwd_ofr(next_hop: AccountNumber, asset_id: u16) {
        assert!(
            next_hop != ForwardOffer::GLOBAL,
            "use rm_glb_fwd for global forward offer"
        );
        ForwardOffer::remove(get_sender(), next_hop, asset_id);
    }

    /// Remove a **global** path-forward offer.
    #[action]
    fn rm_glb_fwd(asset_id: u16) {
        ForwardOffer::remove(get_sender(), ForwardOffer::GLOBAL, asset_id);
    }

    /// Set `allow_unknown` on a posted path-forward offer (`next_hop` 0 = global).
    #[action]
    fn st_fwd_unk(next_hop: AccountNumber, asset_id: u16, allow_unknown: bool) {
        ForwardOffer::set_allow_unknown(get_sender(), next_hop, asset_id, allow_unknown);
    }

    /// Post/update a **specific** buy offer (`debtor` ≠ 0). Takers call
    /// `sell_claim`.
    #[action]
    fn st_buy_clm(
        debtor: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: i32,
        expires_at: TimePointSec,
    ) {
        assert!(
            debtor != ClaimOffer::GLOBAL,
            "use st_glb_buy for global buy offer (debtor 0)"
        );
        ClaimOffer::upsert(
            get_sender(),
            debtor,
            asset_id,
            ClaimOffer::BUY,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Post/update a **global** buy offer (`debtor = 0`).
    #[action]
    fn st_glb_buy(asset_id: u16, fee_fixed: Quantity, fee_percent: i32, expires_at: TimePointSec) {
        ClaimOffer::upsert(
            get_sender(),
            ClaimOffer::GLOBAL,
            asset_id,
            ClaimOffer::BUY,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Remove a **specific** buy offer.
    #[action]
    fn rm_buy_clm(debtor: AccountNumber, asset_id: u16) {
        assert!(
            debtor != ClaimOffer::GLOBAL,
            "use rm_glb_buy for global buy offer"
        );
        ClaimOffer::remove(get_sender(), debtor, asset_id, ClaimOffer::BUY);
    }

    /// Remove a **global** buy offer.
    #[action]
    fn rm_glb_buy(asset_id: u16) {
        ClaimOffer::remove(get_sender(), ClaimOffer::GLOBAL, asset_id, ClaimOffer::BUY);
    }

    /// Post/update a **specific** sell offer (`debtor` ≠ 0). Takers call
    /// `buy_claim`.
    #[action]
    fn st_sell_clm(
        debtor: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: i32,
        expires_at: TimePointSec,
    ) {
        assert!(
            debtor != ClaimOffer::GLOBAL,
            "use st_glb_sell for global sell offer (debtor 0)"
        );
        ClaimOffer::upsert(
            get_sender(),
            debtor,
            asset_id,
            ClaimOffer::SELL,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Post/update a **global** sell offer (`debtor = 0`).
    #[action]
    fn st_glb_sell(asset_id: u16, fee_fixed: Quantity, fee_percent: i32, expires_at: TimePointSec) {
        ClaimOffer::upsert(
            get_sender(),
            ClaimOffer::GLOBAL,
            asset_id,
            ClaimOffer::SELL,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Remove a **specific** sell offer.
    #[action]
    fn rm_sell_clm(debtor: AccountNumber, asset_id: u16) {
        assert!(
            debtor != ClaimOffer::GLOBAL,
            "use rm_glb_sell for global sell offer"
        );
        ClaimOffer::remove(get_sender(), debtor, asset_id, ClaimOffer::SELL);
    }

    /// Remove a **global** sell offer.
    #[action]
    fn rm_glb_sell(asset_id: u16) {
        ClaimOffer::remove(get_sender(), ClaimOffer::GLOBAL, asset_id, ClaimOffer::SELL);
    }

    /// Seller (sender) sells claims on `debtor` to `buyer` under the buyer's
    /// **buy** offer. Buyer becomes creditor of `debtor`; seller receives face
    /// after the offer spread. The debtor must know the buyer (line or
    /// live claim). A buyer line to the debtor is optional (cap only).
    #[action]
    fn sell_claim(buyer: AccountNumber, debtor: AccountNumber, asset_id: u16, amount: Quantity) {
        let seller = get_sender();
        let offer = ClaimOffer::get_assert(buyer, debtor, asset_id, ClaimOffer::BUY);
        offer.execute(seller, buyer, debtor, amount, "sell_claim");
    }

    /// Buyer (sender) buys claims on `debtor` from `seller` under the seller's
    /// **sell** offer. Same books as `sell_claim`; the maker's ask applies.
    #[action]
    fn buy_claim(seller: AccountNumber, debtor: AccountNumber, asset_id: u16, amount: Quantity) {
        let buyer = get_sender();
        let offer = ClaimOffer::get_assert(seller, debtor, asset_id, ClaimOffer::SELL);
        offer.execute(seller, buyer, debtor, amount, "buy_claim");
    }

    /// Poster posts a from→to FX offer. Others `convert` against it; path
    /// pay uses it to size a hop when the poster is the middle man.
    #[action]
    fn st_cur_pol(
        from_asset: u16,
        to_asset: u16,
        fee_fixed: Quantity,
        fx_rate: u64,
        to_interest_rate: u32,
        expires_at: TimePointSec,
    ) {
        CurrencyPolicy::upsert(
            get_sender(),
            from_asset,
            to_asset,
            fee_fixed,
            fx_rate,
            to_interest_rate,
            expires_at,
        );
    }

    /// Post a cash quote: Banx `asset_id` ↔ Tokens `token_id`.
    ///
    /// `is_out` true: taker draws Banx, receives tokens. False: taker sends
    /// tokens, books a Banx deposit onto the poster.
    /// `fee_fixed` is in Banx units for out, token units for in.
    /// `fx_rate`: `to = (from − fee) * fx_rate / RATE_SCALE`.
    #[action]
    fn st_csh_qte(
        asset_id: u16,
        token_id: u32,
        is_out: bool,
        fee_fixed: Quantity,
        fx_rate: u64,
        expires_at: TimePointSec,
    ) {
        CashQuote::upsert(
            get_sender(),
            asset_id,
            token_id,
            is_out,
            fee_fixed,
            fx_rate,
            expires_at,
        );
    }

    /// Remove a cash quote.
    #[action]
    fn rm_csh_qte(asset_id: u16, token_id: u32, is_out: bool) {
        CashQuote::remove(get_sender(), asset_id, token_id, is_out);
    }

    /// Move tokens from shared(sender, Banx) into Banx's Tokens sub-account
    /// `{sender}/{token_id}`. Sender must `tokens.credit` Banx first.
    #[action]
    fn csh_fund(token_id: u32, amount: Quantity) {
        assert!(amount.value > 0, "csh_fund amount must be positive");
        let _ = Tokens::call().getToken(token_id);
        CashQuote::take_tokens(get_sender(), token_id, amount, "csh_fund");
    }

    /// Return tokens from Banx's `{sender}/{token_id}` sub-account.
    #[action]
    fn csh_wd(token_id: u32, amount: Quantity) {
        assert!(amount.value > 0, "csh_wd amount must be positive");
        let poster = get_sender();
        CashQuote::pay_tokens(poster, poster, token_id, amount, "csh_wd");
    }

    /// Draw `amount_banx` on `cashier`'s line; receive tokens from their vault.
    #[action]
    fn cash_out(
        cashier: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_banx: Quantity,
        min_tokens: Quantity,
    ) {
        CashQuote::get_assert(cashier, asset_id, token_id, true).cash_out(
            get_sender(),
            amount_banx,
            min_tokens,
        );
    }

    /// Send tokens from the sender's `{sender}/{token_id}` vault at
    /// `cashier`'s in quote; book Banx deposit onto the cashier. Tokens
    /// move into the cashier's vault. Sender fills their vault with `csh_fund`.
    #[action]
    fn cash_in(
        cashier: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_tokens: Quantity,
        min_banx: Quantity,
    ) {
        CashQuote::get_assert(cashier, asset_id, token_id, false).cash_in(
            get_sender(),
            amount_tokens,
            min_banx,
        );
    }

    /// Take the **counterparty's** [`CurrencyPolicy`]: rebook leftover
    /// `from_asset` on this pair into `to_asset` at their quote. Sender does
    /// not use their own policy. Nets `from_asset` first; requires output
    /// ≥ `min_to`; auto-nets `to_asset` after the rebook.
    #[action]
    fn convert(
        counterparty: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        amount_from: Quantity,
        min_to: Quantity,
    ) {
        let sender = get_sender();
        assert!(sender != counterparty, "cannot convert with self");
        CurrencyPolicy::get_assert(counterparty, from_asset, to_asset).convert(
            sender,
            counterparty,
            amount_from,
            min_to,
        );
    }

    /// Book a **deposit**: sender receives value and credits `depositor`, then
    /// **auto-nets** mutual obligations for this asset.
    ///
    /// `request_id` 0 = none. Non-zero must be a live please-book posted by
    /// `depositor` naming the sender as creditor.
    #[action]
    fn deposit(
        depositor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        interest_rate: u32,
        request_id: u32,
    ) {
        let receiver = get_sender();
        assert!(depositor != receiver, "cannot deposit from self");
        assert_account_exists(depositor);
        assert!(amount.value > 0, "deposit amount must be positive");
        Asset::get_assert(asset_id);
        assert!(
            interest_rate <= crate::tables::PPM_SCALE,
            "interest_rate exceeds 100% (PPM_SCALE)"
        );
        let req_memo = if request_id != 0 {
            PayRequest::fulfill_please_book(request_id, receiver, depositor, asset_id, amount)
        } else {
            String::new()
        };
        let netted = Connection::get(depositor, receiver, asset_id).deposit(amount, interest_rate);
        emit_pair_activity(
            depositor, receiver, asset_id, "deposit", amount, netted, asset_id, request_id,
            &req_memo,
        );
    }

    /// Live pair exposure (principal + interest since last principal/rate change).
    #[action]
    fn get_exposure(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Quantity {
        Obligation::exposure(creditor, debtor, asset_id)
    }

    /// Net mutual obligations between sender and `counterparty` for `asset_id`.
    #[action]
    fn net(counterparty: AccountNumber, asset_id: u16, max_amount: Quantity) {
        let sender = get_sender();
        let cancelled = Obligation::net_pair(sender, counterparty, asset_id, max_amount);
        if cancelled.value > 0 {
            emit_pair_activity(
                sender,
                counterparty,
                asset_id,
                "net",
                cancelled,
                Quantity::new(0),
                asset_id,
                0,
                "",
            );
        }
    }

    /// Path payment along `hops`: each hop is `(account, asset_id)`.
    ///
    /// # Example
    ///
    /// `path_pay([(Gary, AUD), (Steve, USD)], amount_aud, min_return_usd)`:
    /// 1. **First hop** — sender draws `amount` on Gary in **AUD** (line and/or
    ///    reverse claim that auto-nets).
    /// 2. **Currency change** — apply the previous-hop **creditor's**
    ///    [`CurrencyPolicy`] to size the next hop. Does **not** rebook the
    ///    previous claim: the payer still owes the middle man in the from-asset;
    ///    the middle man takes the to-asset liability onward.
    /// 3. **Later hops** — intermediate's live [`ForwardOffer`] (fee + max
    ///    line APR); draw on next line.
    /// 4. **`min_return`** — final hop principal (in **last** asset) ≥ this.
    ///
    /// Atomic: all legs succeed or none stick.
    ///
    /// Each draw **auto-nets** that pair/asset (via [`Connection::draw`]).
    ///
    /// `request_id` 0 = none. Non-zero must be a live invoice; last hop must
    /// be the invoice poster in that asset. Prefer [`pay_inv`] when paying a
    /// bill (exact remaining, spend budget).
    #[action]
    fn path_pay(hops: Vec<PathHop>, amount: Quantity, min_return: Quantity, request_id: u32) {
        assert!(!hops.is_empty(), "path_pay must include at least one hop");
        assert!(amount.value > 0, "path_pay amount must be positive");
        run_path(get_sender(), hops, amount, min_return, request_id);
    }

    /// Pay a live invoice by walking hops **backward** from remaining.
    ///
    /// `max_spend` is a send budget in the first hop's asset. The action
    /// computes the smallest send that delivers remaining (undo hop fees
    /// and FX), requires that send ≤ `max_spend`, then executes that send.
    ///
    /// `request_id` must be a live invoice; last hop must be the invoice
    /// poster in that asset. No `min_return`. Anyone with a path to the
    /// poster may pay (`counterparty` is who was billed, `0` = anyone).
    #[action]
    fn pay_inv(hops: Vec<PathHop>, max_spend: Quantity, request_id: u32) {
        assert!(request_id != 0, "pay_inv requires an invoice");
        assert!(!hops.is_empty(), "pay_inv must include at least one hop");
        assert!(max_spend.value > 0, "pay_inv max_spend must be positive");
        let last_hop = hops[hops.len() - 1];
        let remaining =
            PayRequest::live_invoice_remaining(request_id, last_hop.account, last_hop.asset_id);
        let required = path_required_send(&hops, remaining);
        assert!(
            required.value <= max_spend.value,
            "pay_inv max_spend below required send"
        );
        run_path(get_sender(), hops, required, remaining, request_id);
    }

    /// Post an invoice (`1`), please-book (`2`), or settle-auth (`3`).
    ///
    /// Invoice: poster is payee; `counterparty` is who was billed (`0` = anyone).
    /// Please-book: poster asks `counterparty` (creditor) to deposit them.
    /// Settle-auth: poster is creditor; named debtor may pull a deposit-equivalent.
    #[action]
    fn st_req(
        kind: u8,
        counterparty: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        memo: Memo,
        expires_at: TimePointSec,
    ) -> u32 {
        PayRequest::create(
            kind,
            get_sender(),
            counterparty,
            asset_id,
            amount,
            memo,
            expires_at,
        )
    }

    /// Cancel an open request. Poster only.
    #[action]
    fn rm_req(id: u32) {
        PayRequest::cancel(id, get_sender());
    }

    /// Debtor fulfills a settle-auth: same book as the creditor depositing
    /// them, capped by request remaining and live exposure (no flip).
    #[action]
    fn fl_stl(request_id: u32, amount: Quantity) {
        let debtor = get_sender();
        let (take, memo, creditor, asset_id) =
            PayRequest::fulfill_settle(request_id, debtor, amount);
        let netted = Connection::get(debtor, creditor, asset_id).deposit(take, 0);
        emit_pair_activity(
            debtor, creditor, asset_id, "deposit", take, netted, asset_id, request_id, &memo,
        );
    }

    /// Bilateral activity history (emitted once per party as `account`).
    ///
    /// - `kind`: `path_draw` | `path_pay` | `deposit` | `net` | `convert` |
    ///   `credit_line` | `rm_credit_line` | `sell_claim` | `invoice` |
    ///   `please_book` | `settle_auth` | `fulfill` | `req_cancel` |
    ///   `cash_out` | `cash_in`
    /// - `amount`: primary quantity (human decimal at `asset_id` precision)
    /// - `netted`: auto-net cancelled; convert/`path_pay` output at `other_asset_id`
    /// - `other_asset_id`: convert/`path_pay` destination asset; else same as `asset_id`
    /// - `request_id`: linked request (`0` = none)
    /// - `memo`: request memo when linked
    #[event(history)]
    pub fn activity(
        account: AccountNumber,
        counterparty: AccountNumber,
        asset_id: u16,
        kind: String,
        amount: String,
        netted: String,
        other_asset_id: u16,
        actor: AccountNumber,
        request_id: u32,
        memo: String,
    ) {
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        InitTable::read()
            .get_index_pk()
            .get(&())
            .expect("service not inited");
    }
}

#[cfg(test)]
mod tests;
