/// Daily compound interest (path-independent daily loop, then leftover seconds).
pub mod interest;
mod iso4217;
/// Shared fee / FX integer math (on-chain and path search).
pub mod math;
/// Off-chain path discovery for multi-hop `path_pay` (TokenSwap-style search).
pub mod path_find;
pub mod tables;

#[psibase::service(name = "banx-app", tables = "tables::tables")]
pub mod service {
    use crate::tables::{
        assert_account_exists, emit_pair_activity, path_required_send, run_path, Asset, BanxInvite,
        BanxRelay, BookAuth, CashQuote, ClaimOffer, Connection, CreditLine, ForwardOffer, FxOffer,
        InitRow, InitTable, Obligation, PathHop, PayAuth, PayRequest, TokenRelay,
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
                    next_pay_auth_id: 1,
                })
                .unwrap();

            for &(symbol, precision, description) in crate::iso4217::SEEDED_ASSETS {
                Asset::add(
                    symbol,
                    Precision::new(precision).expect("seed precision"),
                    description.into(),
                );
            }
        }
    }

    /// Register a new asset. Anyone may call. Symbol must be unique.
    ///
    /// Returns the allocated `u16` asset id.
    #[action]
    fn add_asset(symbol: AccountNumber, precision: Precision, description: Memo) -> u16 {
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

    /// Create a Banx invite. Caller is the inviter; `invite_id` / `invite_payload`
    /// come from `invite:plugin` `prepare-new-invite`. `num_accounts` must be 1.
    /// The first [`onInvAccept`] extends a credit line to that claimee (no-op if
    /// a line already exists) and records `claimed_by`.
    #[action]
    fn cr_invite(
        invite_id: u32,
        invite_payload: Vec<u8>,
        num_accounts: u16,
        asset_id: u16,
        amount: Quantity,
        deplete_on_debit: bool,
        interest_rate: u32,
        grace_seconds: u32,
    ) {
        BanxInvite::add(
            invite_id,
            invite_payload,
            num_accounts,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate,
            grace_seconds,
        );
    }

    /// Delete a Banx invite. Inviter only. Refunds unused invite resources.
    #[action]
    fn rm_invite(invite_id: u32) {
        BanxInvite::get_assert(invite_id).delete();
    }

    /// Invite hook: apply the stored credit line to `accepter` if none exists
    /// and record `claimed_by`. Missing or already-claimed Banx rows are ignored.
    #[action]
    #[allow(non_snake_case)]
    fn onInvAccept(invite_id: u32, accepter: AccountNumber) {
        assert_eq!(
            get_sender(),
            psibase::services::invite::Wrapper::SERVICE,
            "sender must be invite"
        );
        if let Some(invite) = BanxInvite::get(invite_id) {
            invite.accept(accepter);
        }
    }

    /// Debtor (sender) lets `creditor` book deposits onto them in `asset_id`,
    /// up to `remaining`. Dual of a credit line: they may *write* that you
    /// owe them. The booked APR must sit in `min_interest_rate..=max_interest_rate`.
    /// A floor of 0 refuses decay. `expires_at` 0 = never. Replaces any existing
    /// row for this pair/asset.
    #[action]
    fn st_bk_ath(
        creditor: AccountNumber,
        asset_id: u16,
        remaining: Quantity,
        max_interest_rate: u32,
        min_interest_rate: i32,
        expires_at: TimePointSec,
    ) {
        let debtor = get_sender();
        BookAuth::upsert(
            debtor,
            creditor,
            asset_id,
            remaining,
            max_interest_rate,
            min_interest_rate,
            expires_at,
        );
        emit_pair_activity(
            debtor,
            debtor,
            creditor,
            asset_id,
            "book_auth",
            remaining,
            0.into(),
            asset_id,
            0,
            "",
        );
    }

    /// Revoke the sender's book-auth to `creditor` in `asset_id`.
    #[action]
    fn rm_bk_ath(creditor: AccountNumber, asset_id: u16) {
        let debtor = get_sender();
        BookAuth::get_assert(debtor, creditor, asset_id).remove();
        emit_pair_activity(
            debtor,
            debtor,
            creditor,
            asset_id,
            "rm_book_auth",
            Quantity::new(0),
            Quantity::new(0),
            asset_id,
            0,
            "",
        );
    }

    /// Creditor (sender) books `amount` onto `debtor` under their live
    /// book-auth. Same ledger as [`deposit`], spends remaining (row stays at
    /// 0 so it can be topped up), auto-nets. `interest_rate` must be within
    /// ±100% and inside the auth's min..=max. A negative rate decays the claim;
    /// the creditor signs it, and only after the debtor set a negative floor.
    /// Memo is stored on activity.
    #[action]
    fn book(
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        interest_rate: i32,
        memo: Memo,
    ) {
        let creditor = get_sender();
        let netted = BookAuth::get_assert(debtor, creditor, asset_id).book(amount, interest_rate);
        emit_pair_activity(
            creditor,
            creditor,
            debtor,
            asset_id,
            "book",
            amount,
            netted,
            asset_id,
            0,
            &memo.to_string(),
        );
    }

    /// Remove the sender's credit line to `debitor`. Limit 0 still counts as
    /// a line (consent to be a known counterparty); this erases the row.
    #[action]
    fn rm_crd_lne(debitor: AccountNumber, asset_id: u16) {
        let creditor = get_sender();
        CreditLine::get_assert(creditor, debitor, asset_id).remove();
        emit_pair_activity(
            creditor,
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
        ForwardOffer::get_assert(get_sender(), next_hop, asset_id).remove();
    }

    /// Remove a **global** path-forward offer.
    #[action]
    fn rm_glb_fwd(asset_id: u16) {
        ForwardOffer::get_assert(get_sender(), ForwardOffer::GLOBAL, asset_id).remove();
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
        remaining: Quantity,
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
            remaining,
            expires_at,
        );
    }

    /// Post/update a **global** buy offer (`debtor = 0`). Spread only.
    /// `remaining` is the face budget for every debtor; the buyer's line
    /// still caps each take.
    #[action]
    fn st_glb_buy(
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: i32,
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        ClaimOffer::upsert(
            get_sender(),
            ClaimOffer::GLOBAL,
            asset_id,
            ClaimOffer::BUY,
            fee_fixed,
            fee_percent,
            remaining,
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
        ClaimOffer::get_assert(get_sender(), debtor, asset_id, ClaimOffer::BUY).remove();
    }

    /// Remove a **global** buy offer.
    #[action]
    fn rm_glb_buy(asset_id: u16) {
        ClaimOffer::get_assert(get_sender(), ClaimOffer::GLOBAL, asset_id, ClaimOffer::BUY)
            .remove();
    }

    /// Post/update a **specific** sell offer (`debtor` ≠ 0). Takers call
    /// `buy_claim`.
    #[action]
    fn st_sell_clm(
        debtor: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: i32,
        remaining: Quantity,
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
            remaining,
            expires_at,
        );
    }

    /// Post/update a **global** sell offer (`debtor = 0`).
    #[action]
    fn st_glb_sell(
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: i32,
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        ClaimOffer::upsert(
            get_sender(),
            ClaimOffer::GLOBAL,
            asset_id,
            ClaimOffer::SELL,
            fee_fixed,
            fee_percent,
            remaining,
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
        ClaimOffer::get_assert(get_sender(), debtor, asset_id, ClaimOffer::SELL).remove();
    }

    /// Remove a **global** sell offer.
    #[action]
    fn rm_glb_sell(asset_id: u16) {
        ClaimOffer::get_assert(get_sender(), ClaimOffer::GLOBAL, asset_id, ClaimOffer::SELL)
            .remove();
    }

    /// Seller (sender) sells claims on `debtor` to `buyer` under the buyer's
    /// **buy** offer. Buyer becomes creditor of `debtor`; seller receives face
    /// after the offer spread. The debtor must know the buyer (line or
    /// live claim). New exposure requires the buyer's credit line to the
    /// debtor and is capped by that line's capacity.
    ///
    /// `min_proceeds` is the floor the seller signs. A positive bound rejects
    /// a replaced offer that pays less. Zero does not floor.
    #[action]
    fn sell_claim(
        buyer: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        min_proceeds: Quantity,
    ) {
        let seller = get_sender();
        ClaimOffer::get_live(buyer, debtor, asset_id, ClaimOffer::BUY).execute(
            seller,
            seller,
            buyer,
            debtor,
            amount,
            min_proceeds,
            "sell_claim",
        );
    }

    /// Buyer (sender) buys claims on `debtor` from `seller` under the seller's
    /// **sell** offer. Same books as `sell_claim`; the maker's ask applies.
    ///
    /// `max_cost` is the cap the buyer signs on the new claim they owe the
    /// seller. A positive bound rejects a replaced offer that costs more.
    /// Zero does not cap.
    #[action]
    fn buy_claim(
        seller: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        max_cost: Quantity,
    ) {
        let buyer = get_sender();
        ClaimOffer::get_live(seller, debtor, asset_id, ClaimOffer::SELL).execute(
            buyer,
            seller,
            buyer,
            debtor,
            amount,
            max_cost,
            "buy_claim",
        );
    }

    /// Poster posts one side of a from→to quote.
    ///
    /// `poster_is_creditor`: the quote applies when the poster is owed
    /// `from_asset`. The other direction is a separate post. On convert the
    /// fee is added on this side and subtracted when the poster owes the
    /// from-asset. Path pay uses only the creditor side, and subtracts the
    /// fee when sizing the next hop.
    ///
    /// `remaining` is from-asset still accepted on this side. Posting again
    /// replaces what is left.
    #[action]
    fn st_fx_ofr(
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
        fee_fixed: Quantity,
        fx_rate: u64,
        to_interest_rate: u32,
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        FxOffer::upsert(
            get_sender(),
            from_asset,
            to_asset,
            poster_is_creditor,
            fee_fixed,
            fx_rate,
            to_interest_rate,
            remaining,
            expires_at,
        );
    }

    /// Remove one side of a from→to quote.
    #[action]
    fn rm_fx_ofr(from_asset: u16, to_asset: u16, poster_is_creditor: bool) {
        FxOffer::get_assert(get_sender(), from_asset, to_asset, poster_is_creditor).remove();
    }

    /// Post a constant-product relay between two Banx assets.
    ///
    /// Both reserves are virtual weights, not a debt. One row prices both
    /// directions. Posting again replaces them. A path that changes asset
    /// on the sender uses this curve instead of an FX offer for the pair.
    /// The curve has no fee. A path that continues pays the forward fee.
    #[action]
    fn st_relay(asset_a: u16, reserve_a: Quantity, asset_b: u16, reserve_b: Quantity) {
        BanxRelay::upsert(get_sender(), asset_a, reserve_a, asset_b, reserve_b);
    }

    /// Delete the sender's relay for this pair. Claims already drawn stay.
    #[action]
    fn rm_relay(asset_a: u16, asset_b: u16) {
        BanxRelay::get(get_sender(), asset_a, asset_b)
            .expect("relay not found")
            .remove();
    }

    /// Post a Banx↔token relay. `reserve_banx` is the virtual Banx weight.
    /// `reserve_tokens` is pulled from shared(sender, Banx) into
    /// `{sender}/{asset_id}/{token_id}`. The same pair cannot be posted twice.
    /// The curve has no fee. A direct swap pays the owner's global forward
    /// on `asset_id`. A path that only delivers tokens does not.
    #[action]
    fn st_tok_relay(
        asset_id: u16,
        token_id: u32,
        reserve_banx: Quantity,
        reserve_tokens: Quantity,
    ) {
        TokenRelay::upsert(get_sender(), asset_id, token_id, reserve_banx, reserve_tokens);
    }

    /// Delete the sender's token relay. Tokens still in the pair return to the sender.
    #[action]
    fn rm_tok_relay(asset_id: u16, token_id: u32) {
        TokenRelay::get_assert(get_sender(), asset_id, token_id).remove();
    }

    /// Draw `amount_banx` on `owner` and receive tokens from their relay.
    /// The curve prices that amount. A live global forward on `asset_id`
    /// is extra Banx the sender owes. It is not taken from the tokens.
    #[action]
    fn tok_relay_out(
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_banx: Quantity,
        min_tokens: Quantity,
    ) {
        TokenRelay::cash_out(
            owner,
            get_sender(),
            asset_id,
            token_id,
            amount_banx,
            min_tokens,
        );
    }

    /// Send tokens from the sender's vault into `owner`'s relay.
    /// The curve prices the full amount. A live global forward on `asset_id`
    /// is taken off the Banx `owner` owes. Fund the vault first.
    #[action]
    fn tok_relay_in(
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_tokens: Quantity,
        min_banx: Quantity,
    ) {
        TokenRelay::cash_in(
            owner,
            get_sender(),
            asset_id,
            token_id,
            amount_tokens,
            min_banx,
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
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        CashQuote::upsert(
            get_sender(),
            asset_id,
            token_id,
            is_out,
            fee_fixed,
            fx_rate,
            remaining,
            expires_at,
        );
    }

    /// Remove a cash quote.
    #[action]
    fn rm_csh_qte(asset_id: u16, token_id: u32, is_out: bool) {
        CashQuote::get_assert(get_sender(), asset_id, token_id, is_out).remove();
    }

    /// Move tokens from shared(sender, Banx) into Banx's Tokens sub-account
    /// `{sender}/{token_id}`. Sender must `tokens.credit` Banx first.
    #[action]
    fn csh_fund(token_id: u32, amount: Quantity) {
        assert!(amount.value > 0, "csh_fund amount must be positive");
        Tokens::call().getToken(token_id);
        let poster = get_sender();
        CashQuote::take_tokens(poster, token_id, amount, "csh_fund");
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
        CashQuote::get_live(cashier, asset_id, token_id, true).cash_out(
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
        CashQuote::get_live(cashier, asset_id, token_id, false).cash_in(
            get_sender(),
            amount_tokens,
            min_banx,
        );
    }

    /// Take the **counterparty's** [`FxOffer`] for the leftover
    /// `from_asset` debt. Only the side that matches that debt is used.
    /// Sender does not use their own offer. Nets `from_asset` first when
    /// the quote exists and auto-nets `to_asset`.
    ///
    /// `min_to` bounds the new to-asset amount. When the sender owes the
    /// from-asset, that amount is new debt: a positive `min_to` caps it
    /// and zero does not. When the sender is owed the from-asset, `min_to`
    /// is a floor on what they receive. `interest_rate` is the APR they
    /// read. A replaced rate fails. The amount bound does not see it.
    #[action]
    fn convert(
        counterparty: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        amount_from: Quantity,
        min_to: Quantity,
        interest_rate: u32,
    ) {
        FxOffer::take(
            get_sender(),
            counterparty,
            from_asset,
            to_asset,
            amount_from,
            min_to,
            interest_rate,
        );
    }

    /// Take the clicked from→to order. `poster_is_creditor` selects the row.
    ///
    /// A buy rebooks from-asset the sender still owes the poster, then opens
    /// both legs for the rest of the click. If the poster already owes the
    /// sender that asset, the two legs still open and that claim nets as
    /// unwind. A sell only rebooks from-asset the poster owes the sender.
    /// `to_bound` is the sender's to-asset net for this call: receipt minus
    /// debt. It is checked and dropped. Positive floors a receipt, negative
    /// caps a debt, and zero rejects finishing in debt, including a buy that
    /// has become a pure rebook. A fresh buy only receives, so a debt cap
    /// fails. A sell receives, so zero and a debt cap both pass.
    /// `interest_rate` is the APR they read. A replaced rate fails, on a
    /// buy and on a sell. The amount bound does not see it.
    #[action]
    fn take_fx(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
        amount_from: Quantity,
        to_bound: i64,
        interest_rate: u32,
    ) {
        FxOffer::take_order(
            get_sender(),
            poster,
            from_asset,
            to_asset,
            poster_is_creditor,
            amount_from,
            to_bound,
            interest_rate,
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
        // Unsigned on purpose: the debtor signs `deposit` and the creditor
        // does not. A negative rate is only available through `book`.
        let req_memo = if request_id != 0 {
            PayRequest::fulfill_please_book(request_id, receiver, depositor, asset_id, amount)
        } else {
            String::new()
        };
        let netted =
            Connection::get_live(depositor, receiver, asset_id).deposit(amount, interest_rate);
        emit_pair_activity(
            receiver, depositor, receiver, asset_id, "deposit", amount, netted, asset_id,
            request_id, &req_memo,
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

    /// Write off claims the sender holds on `debtor` (one-sided
    /// [`Obligation::apply_reduction`]). Debtor does not sign.
    ///
    /// Capped at live exposure. Same waterfall as net. Partial does **not**
    /// reset an open grace cycle; emptying the pair (principal and interest)
    /// closes it. An already-zero balance succeeds so accrual's delete commits.
    #[action]
    fn forgive(debtor: AccountNumber, asset_id: u16, amount: Quantity) {
        let creditor = get_sender();
        assert_account_exists(debtor);
        Asset::get_assert(asset_id);
        let take = Obligation::forgive_pair(creditor, debtor, asset_id, amount);
        if take.value == 0 {
            return;
        }
        emit_pair_activity(
            creditor,
            creditor,
            debtor,
            asset_id,
            "forgive",
            take,
            Quantity::new(0),
            asset_id,
            0,
            "",
        );
    }

    /// Path payment along `hops`: each hop is `(account, asset_id)`.
    ///
    /// # Example
    ///
    /// `path_pay([(Gary, AUD), (Steve, USD)], amount_aud, min_return_usd)`:
    /// 1. **First hop** — sender draws `amount` on Gary in **AUD** (line and/or
    ///    reverse claim that auto-nets).
    /// 2. **Currency change** — if the previous hop posted a [`BanxRelay`]
    ///    for the pair, the curve sizes the next hop. Otherwise apply their
    ///    creditor-side [`FxOffer`]. Does **not** rebook the previous
    ///    claim: the payer still owes the middle man the full from-asset.
    /// 3. **Later hops** — intermediate's live [`ForwardOffer`] (fee + max
    ///    line APR); draw on next line.
    /// 4. **`min_return`** — final hop principal (in **last** asset) ≥ this.
    ///
    /// The sender may be the last hop when that asset differs from the first.
    /// A same-asset return, or any hop after the sender, is rejected.
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
        run_path(get_sender(), hops, amount, min_return, request_id, "");
    }

    /// Path-pay that ends by selling the last hop's Banx for that account's tokens.
    ///
    /// The last hop must have posted a token relay for that asset and
    /// `token_id`. The path draws the Banx amount on them, then their vault
    /// pays `recipient`. They do not also owe `recipient` the Banx asset.
    /// `min_tokens` floors the token output.
    #[action]
    fn path_cash(
        hops: Vec<PathHop>,
        amount: Quantity,
        token_id: u32,
        recipient: AccountNumber,
        min_tokens: Quantity,
    ) {
        assert!(!hops.is_empty(), "path_cash must include at least one hop");
        assert!(amount.value > 0, "path_cash amount must be positive");
        assert_account_exists(recipient);
        let sender = get_sender();
        let last = hops[hops.len() - 1];
        let banx_in = run_path(sender, hops, amount, Quantity::new(1), 0, "");
        TokenRelay::pay_tokens_for_banx(
            last.account,
            last.asset_id,
            token_id,
            banx_in,
            recipient,
            min_tokens,
        );
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
        run_path(get_sender(), hops, required, remaining, request_id, "");
    }

    /// Repeating path payment. Sender is the payer. Returns the series id.
    ///
    /// `ends_at` of 0 means no scheduled end. A period is payable when
    /// `next_due <= now` and (`ends_at` is 0 or `next_due < ends_at`).
    #[action]
    fn st_pay_ath(
        payee: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        max_spend: Quantity,
        max_interest_rate: u32,
        period_seconds: u32,
        next_due: TimePointSec,
        ends_at: TimePointSec,
    ) -> u32 {
        PayAuth::create(
            get_sender(),
            payee,
            asset_id,
            amount,
            max_spend,
            max_interest_rate,
            period_seconds,
            next_due,
            ends_at,
        )
    }

    /// Pay the oldest due period. Sender is the payer or the payee.
    /// The stored payer is drawn. This does not fulfill an invoice.
    #[action]
    fn run_pay_ath(id: u32, hops: Vec<PathHop>) {
        PayAuth::run(id, hops, get_sender());
    }

    /// Delete a repeating payment. Payer or payee.
    ///
    /// `force_cancel` false throws when a period is payable. True deletes
    /// the row anyway and does not pay that period.
    #[action]
    fn rm_pay_ath(id: u32, force_cancel: bool) {
        PayAuth::cancel(id, get_sender(), force_cancel);
    }

    /// Post an invoice (`1`) or please-book (`2`).
    ///
    /// Invoice: poster is payee; `counterparty` is who was billed (`0` = anyone).
    /// Please-book: poster asks `counterparty` (creditor) to deposit them.
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

    /// Activity history, one row per party as `account`. The same account
    /// on both sides is one row.
    ///
    /// - `kind`: `path_draw` | `path_pay` | `deposit` | `book` | `net` |
    ///   `convert` | `credit_line` | `rm_credit_line` | `book_auth` |
    ///   `rm_book_auth` | `sell_claim` | `buy_claim` | `invoice` |
    ///   `please_book` | `fulfill` | `req_cancel` |
    ///   `forgive` | `cash_out` | `cash_in` | `relay` | `take`
    /// - `amount`: primary quantity (human decimal at `asset_id` precision)
    /// - `netted`: auto-net cancelled; convert/`path_pay` output at `other_asset_id`.
    ///   On `convert` this is the new debt, and `actor` is who owes it.
    /// - `other_asset_id`: convert/`path_pay` destination asset; else same as `asset_id`
    /// - `request_id`: linked request (`0` = none)
    /// - `memo`: request memo when linked; debtor account on `sell_claim` /
    ///   `buy_claim`; hop debtor on `path_draw` (not the path payer)
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
