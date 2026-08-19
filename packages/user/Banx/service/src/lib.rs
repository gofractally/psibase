/// Daily compound interest (path-independent closed form).
pub mod interest;
/// Off-chain path discovery for multi-hop `path_pay` (TokenSwap-style search).
pub mod path_find;

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        services::tokens::{Precision, Quantity},
        AccountNumber, Fracpack, Memo, ServiceWrapper, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    /// Parts-per-million scale: `PPM_SCALE` = 100%.
    ///
    /// Used for interest APR, FX/`fx_rate`, and max accept rates so one unit
    /// system covers “percent-like” quantities (`10_000` = 1%, full scale = 100%).
    pub const PPM_SCALE: u32 = 1_000_000;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        /// Next primary key for [`Obligation`] rows.
        pub next_obligation_id: u32,
        /// Next primary key for [`Asset`] rows (u16 space).
        pub next_asset_id: u16,
        /// Next primary key for [`PayRequest`] rows.
        pub next_request_id: u32,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}

        fn get_assert() -> Self {
            InitTable::read()
                .get_index_pk()
                .get(&())
                .expect("service not inited")
        }

        fn save(&self) {
            InitTable::read_write().put(self).unwrap();
        }

        /// Allocate a unique obligation primary key.
        pub fn alloc_obligation_id() -> u32 {
            let mut row = Self::get_assert();
            let id = row.next_obligation_id;
            row.next_obligation_id = row
                .next_obligation_id
                .checked_add(1)
                .expect("obligation id overflow");
            row.save();
            id
        }

        /// Allocate a unique asset id (supports a few thousand assets).
        pub fn alloc_asset_id() -> u16 {
            let mut row = Self::get_assert();
            let id = row.next_asset_id;
            row.next_asset_id = row.next_asset_id.checked_add(1).expect("asset id overflow");
            row.save();
            id
        }

        /// Allocate a unique request primary key.
        pub fn alloc_request_id() -> u32 {
            let mut row = Self::get_assert();
            let id = row.next_request_id;
            row.next_request_id = row
                .next_request_id
                .checked_add(1)
                .expect("request id overflow");
            row.save();
            id
        }
    }

    /// Registered currency / asset. Compact `id` is used everywhere else;
    /// `symbol` is the human/name identity.
    #[table(name = "AssetTable", index = 5)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Asset {
        #[primary_key]
        pub id: u16,
        pub symbol: AccountNumber,
        pub precision: Precision,
        /// Human-readable description (max 80 bytes).
        pub description: Memo,
    }

    impl Asset {
        #[secondary_key(1)]
        fn by_symbol(&self) -> AccountNumber {
            self.symbol
        }

        fn save(&self) {
            AssetTable::read_write().put(self).unwrap();
        }

        pub fn get(id: u16) -> Option<Self> {
            AssetTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u16) -> Self {
            Self::get(id).expect("asset not found")
        }

        pub fn get_by_symbol(symbol: AccountNumber) -> Option<Self> {
            AssetTable::read().get_index_by_symbol().get(&symbol)
        }

        pub fn get_by_symbol_assert(symbol: AccountNumber) -> Self {
            Self::get_by_symbol(symbol).expect("asset symbol not found")
        }

        /// Register a new asset; allocates the next `id` from [`InitRow`].
        pub fn add(symbol: AccountNumber, precision: Precision, description: Memo) -> Self {
            assert!(
                Self::get_by_symbol(symbol).is_none(),
                "asset symbol already exists"
            );
            let asset = Self {
                id: InitRow::alloc_asset_id(),
                symbol,
                precision,
                description,
            };
            asset.save();
            asset
        }
    }

    /// Scale for rates/takes: `out = in * rate / RATE_SCALE`.
    /// Equal to [`PPM_SCALE`]; `RATE_SCALE` = identity (1:1).
    pub const RATE_SCALE: u64 = PPM_SCALE as u64;

    pub const FX_RATE_SCALE: u64 = RATE_SCALE;

    fn expires_live(expires_at: TimePointSec) -> bool {
        if expires_at.seconds == 0 {
            return true;
        }
        let now = psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds();
        now.seconds <= expires_at.seconds
    }

    /// `out = (in - fee_fixed) * rate / RATE_SCALE`.
    fn apply_rate(amount_in: Quantity, fee_fixed: Quantity, rate: u64) -> Quantity {
        assert!(fee_fixed < amount_in, "fixed fee consumes entire amount");
        let after = amount_in - fee_fixed;
        let out = (after.value as u128)
            .checked_mul(rate as u128)
            .expect("rate convert overflow")
            / (RATE_SCALE as u128);
        let out = u64::try_from(out).expect("rate out exceeds u64");
        assert!(out > 0, "rate conversion rounded to zero");
        out.into()
    }

    /// Same-asset hop fee (Stripe-style): percent of gross, then fixed.
    ///
    /// `out = in * (PPM_SCALE - percent_ppm) / PPM_SCALE - fee_fixed`
    fn apply_hop_fee(amount_in: Quantity, fee_fixed: Quantity, fee_percent_ppm: u32) -> Quantity {
        assert!(fee_percent_ppm < PPM_SCALE, "hop fee must be under 100%");
        apply_spread(amount_in, fee_fixed, fee_percent_ppm as i32)
    }

    /// Claim-sale spread: `out = in * (1 - spread_ppm) - fee_fixed`.
    ///
    /// `spread_ppm > 0` haircuts the seller (discount). `spread_ppm < 0` is a
    /// premium (`-50_000` = seller gets 5% over face). Must be in
    /// `(-PPM_SCALE, PPM_SCALE)`.
    fn apply_spread(amount_in: Quantity, fee_fixed: Quantity, spread_ppm: i32) -> Quantity {
        let scale = PPM_SCALE as i64;
        assert!(
            (spread_ppm as i64) > -scale && (spread_ppm as i64) < scale,
            "spread must be between -100% and 100%"
        );
        let keep_ppm = (scale - spread_ppm as i64) as u128;
        let after_pct = (amount_in.value as u128)
            .checked_mul(keep_ppm)
            .expect("spread overflow")
            / (PPM_SCALE as u128);
        let after_pct = u64::try_from(after_pct).expect("spread out exceeds u64");
        assert!(
            fee_fixed.value < after_pct,
            "fixed fee consumes entire amount after spread"
        );
        let out = after_pct - fee_fixed.value;
        assert!(out > 0, "spread reduced amount to zero");
        out.into()
    }

    /// One hop in [`service::path_pay`]: draw on `account` in `asset_id`.
    ///
    /// Example: `[(Gary, AUD), (Steve, USD)]` — currency change implies convert
    /// on the previous edge via [`CurrencyPolicy`], then same-asset routing.
    #[derive(
        Default, Copy, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct PathHop {
        pub account: AccountNumber,
        pub asset_id: u16,
    }

    /// Path-forward offer: `poster` will sit in the middle of `path_pay`.
    /// `next_hop = 0` is global (any next hop). Specific requires that hop
    /// already knows the poster (a credit line to them, or a live tab).
    #[table(name = "ForwardOfferTab", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ForwardOffer {
        pub poster: AccountNumber,
        /// Next hop creditor, or [`Self::GLOBAL`].
        pub next_hop: AccountNumber,
        pub asset_id: u16,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%); must be `< PPM_SCALE`.
        pub fee_percent: u32,
        /// Max APR ppm on a **new** draw when forwarding. Not applied to a
        /// hop that only unwinds a reverse tab.
        pub max_line_apr: u32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
        /// If false, poster must already know the next hop (a line to them,
        /// or a live tab). If true, anyone who lined the poster can become
        /// their creditor.
        pub allow_unknown: bool,
    }

    impl ForwardOffer {
        pub const GLOBAL: AccountNumber = AccountNumber::new(0);

        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.poster, self.next_hop, self.asset_id)
        }

        fn save(&self) {
            ForwardOfferTab::read_write().put(self).unwrap();
        }

        fn get(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) -> Option<Self> {
            ForwardOfferTab::read()
                .get_index_pk()
                .get(&(poster, next_hop, asset_id))
        }

        pub fn is_live(&self) -> bool {
            expires_live(self.expires_at)
        }

        fn assert_live(&self) {
            assert!(self.is_live(), "forward offer expired");
        }

        /// Closed: poster already knows `next_creditor` (lined them, or a
        /// live tab either way). Limit 0 is enough.
        fn assert_known(&self, next_creditor: AccountNumber) {
            if self.allow_unknown {
                return;
            }
            assert!(
                Connection::knows(self.poster, next_creditor, self.asset_id),
                "unknown counterparty (no credit line or obligation; set allow_unknown or post a 0-limit line)"
            );
        }

        /// Live specific offer, else live global. Panics if neither is live.
        pub fn get_assert(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) -> Self {
            if let Some(p) = Self::get(poster, next_hop, asset_id) {
                if p.is_live() {
                    return p;
                }
            }
            if let Some(g) = Self::get(poster, Self::GLOBAL, asset_id) {
                if g.is_live() {
                    return g;
                }
            }
            panic!("ForwardOffer not found (no specific or global forward for this asset)");
        }

        pub fn is_global(&self) -> bool {
            self.next_hop == Self::GLOBAL
        }

        pub fn upsert(
            poster: AccountNumber,
            next_hop: AccountNumber,
            asset_id: u16,
            fee_fixed: Quantity,
            fee_percent: u32,
            max_line_apr: u32,
            expires_at: TimePointSec,
            allow_unknown: bool,
        ) {
            assert!(
                max_line_apr <= PPM_SCALE,
                "max_line_apr exceeds 100% (PPM_SCALE)"
            );
            assert!(fee_percent < PPM_SCALE, "fee must be under 100%");
            if next_hop != Self::GLOBAL {
                assert!(
                    Connection::knows(next_hop, poster, asset_id),
                    "next hop does not know poster (no credit line or live obligation)"
                );
            }
            let allow_unknown = Self::get(poster, next_hop, asset_id)
                .map(|p| p.allow_unknown)
                .unwrap_or(allow_unknown);
            Self {
                poster,
                next_hop,
                asset_id,
                fee_fixed,
                fee_percent,
                max_line_apr,
                expires_at,
                allow_unknown,
            }
            .save();
        }

        pub fn set_allow_unknown(
            poster: AccountNumber,
            next_hop: AccountNumber,
            asset_id: u16,
            allow_unknown: bool,
        ) {
            let mut row = Self::get(poster, next_hop, asset_id)
                .unwrap_or_else(|| panic!("forward offer not found"));
            row.allow_unknown = allow_unknown;
            row.save();
        }

        pub fn remove(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) {
            assert!(
                Self::get(poster, next_hop, asset_id).is_some(),
                "forward offer not found"
            );
            ForwardOfferTab::read_write().erase(&(poster, next_hop, asset_id));
        }

        pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
            apply_hop_fee(amount_in, self.fee_fixed, self.fee_percent)
        }

        /// Fee then debit next hop's line to poster.
        pub fn path_draw(&self, next_creditor: AccountNumber, amount_in: Quantity) -> Quantity {
            self.assert_live();
            let creditor = if self.is_global() {
                next_creditor
            } else {
                assert!(
                    next_creditor == self.next_hop,
                    "forward offer next hop mismatch"
                );
                self.next_hop
            };
            self.assert_known(creditor);
            let conn = Connection::get(creditor, self.poster, self.asset_id);
            let draw = self.apply_fees(amount_in);
            // APR cap is only on new line capacity, not a pure unwind.
            if conn.new_draw(draw) > 0 {
                if let Some(line) = conn.line() {
                    assert!(
                        line.interest_rate <= self.max_line_apr,
                        "next hop interest rate exceeds max_line_apr"
                    );
                }
            }
            conn.draw(draw);
            draw
        }
    }

    /// Standing claim offer. `side` is [`Self::BUY`] (poster will buy via
    /// `sell_claim`) or [`Self::SELL`] (poster will sell via `buy_claim`).
    /// `debtor = 0` is global. Residual and debtor-line checks run at take
    /// time, not at post.
    #[table(name = "ClaimOfferTab", index = 6)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ClaimOffer {
        pub poster: AccountNumber,
        /// Underlying debtor, or [`Self::GLOBAL`].
        pub debtor: AccountNumber,
        pub asset_id: u16,
        /// [`Self::BUY`] or [`Self::SELL`].
        pub side: u8,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%). Buy: positive haircuts the seller, negative
        /// is a premium the buyer pays. Sell: positive is the seller's
        /// profit, negative is a discount. `|fee_percent| < PPM_SCALE`.
        pub fee_percent: i32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl ClaimOffer {
        pub const GLOBAL: AccountNumber = AccountNumber::new(0);
        pub const BUY: u8 = 1;
        pub const SELL: u8 = 2;

        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16, u8) {
            (self.poster, self.debtor, self.asset_id, self.side)
        }

        fn save(&self) {
            ClaimOfferTab::read_write().put(self).unwrap();
        }

        fn get(
            poster: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            side: u8,
        ) -> Option<Self> {
            ClaimOfferTab::read()
                .get_index_pk()
                .get(&(poster, debtor, asset_id, side))
        }

        pub fn is_live(&self) -> bool {
            expires_live(self.expires_at)
        }

        pub fn is_buy(&self) -> bool {
            self.side == Self::BUY
        }

        pub fn is_sell(&self) -> bool {
            self.side == Self::SELL
        }

        /// Live specific offer, else live global, same `side`.
        pub fn get_assert(
            poster: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            side: u8,
        ) -> Self {
            if let Some(p) = Self::get(poster, debtor, asset_id, side) {
                if p.is_live() {
                    return p;
                }
            }
            if let Some(g) = Self::get(poster, Self::GLOBAL, asset_id, side) {
                if g.is_live() {
                    return g;
                }
            }
            panic!("ClaimOffer not found (no live specific or global offer on this side)");
        }

        pub fn is_global(&self) -> bool {
            self.debtor == Self::GLOBAL
        }

        fn assert_side(side: u8) {
            assert!(
                side == Self::BUY || side == Self::SELL,
                "claim offer side must be buy (1) or sell (2)"
            );
        }

        pub fn upsert(
            poster: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            side: u8,
            fee_fixed: Quantity,
            fee_percent: i32,
            expires_at: TimePointSec,
        ) {
            Self::assert_side(side);
            let scale = PPM_SCALE as i64;
            assert!(
                (fee_percent as i64) > -scale && (fee_percent as i64) < scale,
                "claim-offer spread must be between -100% and 100%"
            );
            Self {
                poster,
                debtor,
                asset_id,
                side,
                fee_fixed,
                fee_percent,
                expires_at,
            }
            .save();
        }

        pub fn remove(poster: AccountNumber, debtor: AccountNumber, asset_id: u16, side: u8) {
            Self::assert_side(side);
            assert!(
                Self::get(poster, debtor, asset_id, side).is_some(),
                "claim offer not found"
            );
            ClaimOfferTab::read_write().erase(&(poster, debtor, asset_id, side));
        }

        /// Seller proceeds. Buy posts use the raw spread (positive haircuts
        /// the seller). Sell posts flip the sign so **positive is the
        /// poster's profit** (`+10_000` = 1% over face).
        pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
            let spread = if self.is_sell() {
                self.fee_percent.checked_neg().expect("sell spread negate")
            } else {
                self.fee_percent
            };
            apply_spread(amount_in, self.fee_fixed, spread)
        }

        /// Move `amount` of seller's claim on `debtor` to `buyer`; seller
        /// receives face after this offer's spread as a claim on buyer.
        pub fn execute(
            &self,
            seller: AccountNumber,
            buyer: AccountNumber,
            debtor: AccountNumber,
            amount: Quantity,
            kind: &str,
        ) {
            assert!(seller != buyer, "cannot transfer claim to self");
            assert!(seller != debtor, "cannot transfer claim on self as debtor");
            assert!(buyer != debtor, "buyer cannot be the debtor");
            assert!(amount.value > 0, "claim transfer amount must be positive");

            assert!(
                Connection::knows(debtor, buyer, self.asset_id),
                "debtor does not know buyer (no credit line or live tab)"
            );

            // Buyer→debtor line is only a cap if they posted one. The take
            // itself is acceptance; the claim keeps its existing APR.
            if let Some(mut line) = CreditLine::get(buyer, debtor, self.asset_id) {
                Obligation::accrue_pair(buyer, debtor, self.asset_id);
                let buyer_exp = Obligation::exposure(buyer, debtor, self.asset_id).value;
                assert!(
                    buyer_exp.saturating_add(amount.value) <= line.limit.value,
                    "buyer credit line residual insufficient for claim"
                );
                line.consume_grant(amount);
            }

            let proceeds = self.apply_fees(amount);
            Obligation::transfer_claims(seller, buyer, debtor, self.asset_id, amount.value);
            Obligation::credit_pair(seller, buyer, self.asset_id, proceeds, 0);
            Obligation::net_pair(seller, buyer, self.asset_id, u64::MAX.into());
            Obligation::net_pair(buyer, debtor, self.asset_id, u64::MAX.into());

            emit_pair_activity(
                seller,
                buyer,
                self.asset_id,
                kind,
                amount,
                proceeds,
                self.asset_id,
                0,
                "",
            );
        }
    }

    /// Invoice (`INVOICE`): poster is the payee; counterparty should `path_pay`
    /// so the last hop is the poster. Does **not** shrink an existing debt to
    /// the poster.
    ///
    /// Please-book (`PLEASE_BOOK`): poster asked the counterparty (creditor)
    /// to `deposit` them — off-graph value received. Only the creditor can
    /// fulfill; the poster cannot clear their own debt.
    ///
    /// Settle-auth (`SETTLE_AUTH`): poster is the creditor; counterparty
    /// (debtor) may pull a deposit-equivalent up to remaining, capped by live
    /// exposure. Does not create a claim on the creditor.
    #[table(name = "RequestTab", index = 8)]
    #[derive(Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PayRequest {
        pub id: u32,
        /// [`Self::INVOICE`], [`Self::PLEASE_BOOK`], or [`Self::SETTLE_AUTH`].
        pub kind: u8,
        pub poster: AccountNumber,
        pub counterparty: AccountNumber,
        pub asset_id: u16,
        pub amount: Quantity,
        pub remaining: Quantity,
        pub memo: Memo,
        pub expires_at: TimePointSec,
        pub created_at: TimePointSec,
    }

    impl PayRequest {
        pub const INVOICE: u8 = 1;
        pub const PLEASE_BOOK: u8 = 2;
        pub const SETTLE_AUTH: u8 = 3;

        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }

        fn save(&self) {
            RequestTab::read_write().put(self).unwrap();
        }

        pub fn get(id: u32) -> Option<Self> {
            RequestTab::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            Self::get(id).unwrap_or_else(|| panic!("request {id} not found"))
        }

        pub fn is_live(&self) -> bool {
            expires_live(self.expires_at)
        }

        fn assert_live(&self) {
            assert!(self.remaining.value > 0, "request already fulfilled");
            assert!(self.is_live(), "request expired");
        }

        pub fn create(
            kind: u8,
            poster: AccountNumber,
            counterparty: AccountNumber,
            asset_id: u16,
            amount: Quantity,
            memo: Memo,
            expires_at: TimePointSec,
        ) -> u32 {
            assert!(
                kind == Self::INVOICE || kind == Self::PLEASE_BOOK || kind == Self::SETTLE_AUTH,
                "request kind must be invoice (1), please-book (2), or settle-auth (3)"
            );
            assert!(poster != counterparty, "cannot request to self");
            assert!(
                counterparty != AccountNumber::new(0),
                "request counterparty required"
            );
            assert!(amount.value > 0, "request amount must be positive");
            let _ = Asset::get_assert(asset_id);
            let id = InitRow::alloc_request_id();
            let row = Self {
                id,
                kind,
                poster,
                counterparty,
                asset_id,
                amount,
                remaining: amount,
                memo,
                expires_at,
                created_at: Obligation::now(),
            };
            row.save();
            let kind_s = match kind {
                Self::INVOICE => "invoice",
                Self::PLEASE_BOOK => "please_book",
                _ => "settle_auth",
            };
            emit_pair_activity(
                poster,
                counterparty,
                asset_id,
                kind_s,
                amount,
                0.into(),
                asset_id,
                id,
                &row.memo.to_string(),
            );
            id
        }

        pub fn cancel(id: u32, sender: AccountNumber) {
            let row = Self::get_assert(id);
            assert!(row.poster == sender, "only the poster can cancel a request");
            assert!(row.remaining.value > 0, "request already fulfilled");
            emit_pair_activity(
                row.poster,
                row.counterparty,
                row.asset_id,
                "req_cancel",
                row.remaining,
                Quantity::new(0),
                row.asset_id,
                row.id,
                &row.memo.to_string(),
            );
            RequestTab::read_write().erase(&id);
        }

        /// After a successful path_pay: last hop must be the payee (poster).
        pub fn fulfill_invoice(
            id: u32,
            payer: AccountNumber,
            last_hop: AccountNumber,
            last_asset: u16,
            residual: Quantity,
        ) {
            let mut row = Self::get_assert(id);
            assert!(row.kind == Self::INVOICE, "request is not an invoice");
            row.assert_live();
            assert!(
                payer == row.counterparty,
                "only the named payer can fulfill this invoice"
            );
            assert!(
                last_hop == row.poster,
                "invoice path must end at the payee (poster)"
            );
            assert!(
                last_asset == row.asset_id,
                "invoice last hop asset mismatch"
            );
            assert!(residual.value > 0, "invoice fulfill residual is zero");
            let take = Quantity::new(row.remaining.value.min(residual.value));
            row.remaining = (row.remaining.value - take.value).into();
            row.save();
            emit_pair_activity(
                row.poster,
                payer,
                row.asset_id,
                "fulfill",
                take,
                Quantity::new(0),
                row.asset_id,
                row.id,
                &row.memo.to_string(),
            );
        }

        /// Before deposit: creditor (sender) books the poster as depositor.
        pub fn fulfill_please_book(
            id: u32,
            creditor: AccountNumber,
            depositor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
        ) -> String {
            let mut row = Self::get_assert(id);
            assert!(
                row.kind == Self::PLEASE_BOOK,
                "request is not a please-book"
            );
            row.assert_live();
            assert!(
                creditor == row.counterparty,
                "only the named creditor can book this request"
            );
            assert!(
                depositor == row.poster,
                "depositor must be the please-book poster"
            );
            assert!(asset_id == row.asset_id, "please-book asset mismatch");
            assert!(
                amount.value > 0 && amount.value <= row.remaining.value,
                "please-book amount exceeds remaining"
            );
            row.remaining = (row.remaining.value - amount.value).into();
            row.save();
            row.memo.to_string()
        }

        /// Debtor pulls a deposit-equivalent the creditor already authorized.
        /// `take` = min(amount, remaining, live exposure). Never flips the book.
        pub fn fulfill_settle(
            id: u32,
            debtor: AccountNumber,
            amount: Quantity,
        ) -> (Quantity, String, AccountNumber, u16) {
            let mut row = Self::get_assert(id);
            assert!(
                row.kind == Self::SETTLE_AUTH,
                "request is not a settle-auth"
            );
            row.assert_live();
            assert!(
                debtor == row.counterparty,
                "only the named debtor can fulfill this settle-auth"
            );
            assert!(amount.value > 0, "settle amount must be positive");
            let exposure = Obligation::exposure(row.poster, row.counterparty, row.asset_id).value;
            let take = amount.value.min(row.remaining.value).min(exposure);
            assert!(take > 0, "nothing to settle (no exposure on this pair)");
            row.remaining = (row.remaining.value - take).into();
            row.save();
            (take.into(), row.memo.to_string(), row.poster, row.asset_id)
        }
    }

    /// Standing from→to quote posted by `poster`.
    ///
    /// `convert`: the other party takes this offer and rebooks a leftover
    /// tab at this rate. The poster does not re-denominate their own claims.
    ///
    /// `path_pay`: the previous hop's **creditor** (middle man) applies their
    /// quote to size the next hop only. Does not rebook.
    #[table(name = "CurrencyPolicyTab", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CurrencyPolicy {
        /// Who posted the from→to offer.
        pub poster: AccountNumber,
        pub from_asset: u16,
        pub to_asset: u16,

        /// Flat fee in **from_asset** before FX (0 = none).
        pub fee_fixed: Quantity,
        /// `to = (from - fee_fixed) * fx_rate / RATE_SCALE`.
        pub fx_rate: u64,
        /// Interest rate (ppm APR) for the new `to_asset` obligation bucket.
        pub to_interest_rate: u32,
        /// Absolute expiry (`seconds == 0` → never). Prefer short TTL for FX.
        pub expires_at: TimePointSec,
    }

    impl CurrencyPolicy {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u16) {
            (self.poster, self.from_asset, self.to_asset)
        }

        fn save(&self) {
            CurrencyPolicyTab::read_write().put(self).unwrap();
        }

        pub fn get(poster: AccountNumber, from_asset: u16, to_asset: u16) -> Option<Self> {
            CurrencyPolicyTab::read()
                .get_index_pk()
                .get(&(poster, from_asset, to_asset))
        }

        pub fn get_assert(poster: AccountNumber, from_asset: u16, to_asset: u16) -> Self {
            Self::get(poster, from_asset, to_asset).expect("CurrencyPolicy not found")
        }

        pub fn is_live(&self) -> bool {
            expires_live(self.expires_at)
        }

        fn assert_live(&self) {
            assert!(self.is_live(), "currency policy expired");
        }

        /// `to = (from - fee_fixed) * fx_rate / RATE_SCALE`. Does not touch books.
        pub fn apply(&self, amount_from: Quantity) -> Quantity {
            self.assert_live();
            apply_rate(amount_from, self.fee_fixed, self.fx_rate)
        }

        /// Poster posts a from→to offer (path hop sizing, or a convert take).
        pub fn upsert(
            poster: AccountNumber,
            from_asset: u16,
            to_asset: u16,
            fee_fixed: Quantity,
            fx_rate: u64,
            to_interest_rate: u32,
            expires_at: TimePointSec,
        ) {
            assert!(
                from_asset != to_asset,
                "currency convert requires different assets"
            );
            assert!(fx_rate > 0, "fx_rate must be positive");
            assert!(
                to_interest_rate <= PPM_SCALE,
                "to_interest_rate exceeds 100% (PPM_SCALE)"
            );
            Self {
                poster,
                from_asset,
                to_asset,
                fee_fixed,
                fx_rate,
                to_interest_rate,
                expires_at,
            }
            .save();
        }

        /// Rebook up to `amount_from` of what `debtor` owes `creditor` in
        /// `from_asset` into `to_asset` at this poster's rate. Poster must be
        /// one of the two parties (the maker). Nets `from_asset` first, then
        /// auto-nets `to_asset`.
        pub fn convert(
            &self,
            creditor: AccountNumber,
            debtor: AccountNumber,
            amount_from: Quantity,
            min_to: Quantity,
        ) -> Quantity {
            self.assert_live();
            assert!(amount_from.value > 0, "convert amount must be positive");
            assert!(
                self.poster == creditor || self.poster == debtor,
                "FX policy poster must be a party to the tab"
            );
            assert!(creditor != debtor, "creditor must differ from debtor");

            Obligation::net_pair(creditor, debtor, self.from_asset, u64::MAX.into());
            let available = Obligation::exposure(creditor, debtor, self.from_asset).value;
            let take = amount_from.value.min(available);
            assert!(take > 0, "nothing to convert in from_asset");

            Obligation::apply_reduction(creditor, debtor, self.from_asset, take);

            let to_qty = apply_rate(Quantity::new(take), self.fee_fixed, self.fx_rate);
            assert!(to_qty.value >= min_to.value, "convert output below min_to");

            Obligation::credit_pair(
                creditor,
                debtor,
                self.to_asset,
                to_qty,
                self.to_interest_rate,
            );
            Obligation::net_pair(creditor, debtor, self.to_asset, u64::MAX.into());
            emit_pair_activity(
                creditor,
                debtor,
                self.from_asset,
                "convert",
                Quantity::new(take),
                to_qty,
                self.to_asset,
                0,
                "",
            );
            to_qty
        }
    }

    /// Directed claim: `debtor` owes `creditor` principal + accrued interest of
    /// `asset_id`. Accrue before any principal change. [`net_pair`] cancels both
    /// directions: interest first, then principal; highest rate first.
    #[table(name = "ObligationTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Obligation {
        #[primary_key]
        pub id: u32,

        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        pub remaining_principal: Quantity,
        /// Interest finalized at the last principal/rate change. Compounds
        /// with principal (see [`crate::interest`]).
        pub accrued_interest: Quantity,
        /// Compound APR in ppm per year (`10_000` = 1%). See [`crate::interest`].
        pub interest_rate: u32,

        /// Start of the current principal/rate epoch.
        pub last_interest_accrual: TimePointSec,
        pub created_at: TimePointSec,
    }

    impl Obligation {
        #[secondary_key(1)]
        fn by_set(&self) -> (AccountNumber, AccountNumber, u16, u32) {
            (self.creditor, self.debtor, self.asset_id, self.id)
        }

        pub fn get(id: u32) -> Option<Self> {
            ObligationTable::read().get_index_pk().get(&(id))
        }

        pub fn get_assert(id: u32) -> Self {
            Self::get(id).expect("obligation does not exist")
        }

        fn obligations(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Vec<Self> {
            ObligationTable::read()
                .get_index_by_set()
                .range((creditor, debtor, asset_id, 0)..(creditor, debtor, asset_id, u32::MAX))
                .collect()
        }

        /// Total exposure: Σ(principal + live accrued interest).
        pub fn exposure(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Quantity {
            Self::obligations(creditor, debtor, asset_id)
                .into_iter()
                .fold(Quantity::new(0), |acc, o| {
                    acc + o.remaining_principal + o.live_accrued()
                })
        }

        pub fn get_by_interest_rate(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            interest_rate: u32,
        ) -> Option<Self> {
            Self::obligations(creditor, debtor, asset_id)
                .into_iter()
                .find(|obligation| obligation.interest_rate == interest_rate)
        }

        pub fn get_existing_or_new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            interest_rate: u32,
        ) -> Self {
            Self::get_by_interest_rate(creditor, debtor, asset_id, interest_rate)
                .unwrap_or_else(|| Self::new(creditor, debtor, asset_id, interest_rate))
        }

        pub fn now() -> TimePointSec {
            psibase::services::transact::Wrapper::call()
                .currentBlock()
                .time
                .seconds()
        }

        fn new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            interest_rate: u32,
        ) -> Self {
            let now = Self::now();
            Self {
                id: InitRow::alloc_obligation_id(),
                creditor,
                debtor,
                asset_id,
                remaining_principal: 0.into(),
                interest_rate,
                accrued_interest: 0.into(),
                last_interest_accrual: now,
                created_at: now,
            }
        }

        fn is_clear(&self) -> bool {
            self.remaining_principal.value == 0 && self.accrued_interest.value == 0
        }

        fn delete(&self) {
            ObligationTable::read_write().erase(&self.id);
        }

        fn persist_or_delete(&self) {
            if self.is_clear() {
                self.delete();
            } else {
                self.save();
            }
        }

        fn dt_since_epoch(&self, now: TimePointSec) -> u64 {
            let last = self.last_interest_accrual.seconds;
            if now.seconds <= last {
                0
            } else {
                (now.seconds - last) as u64
            }
        }

        /// Accrued interest including this epoch (does not persist).
        pub fn live_accrued(&self) -> Quantity {
            self.live_accrued_at(Self::now())
        }

        pub fn live_accrued_at(&self, now: TimePointSec) -> Quantity {
            if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
                return Quantity::new(0);
            }
            let base = self
                .remaining_principal
                .value
                .checked_add(self.accrued_interest.value)
                .expect("interest base overflow");
            let total = crate::interest::compound_amount(
                base,
                self.interest_rate,
                self.dt_since_epoch(now),
            );
            total
                .checked_sub(self.remaining_principal.value)
                .expect("compound total below principal")
                .into()
        }

        /// Write live interest and start a new epoch. Only for principal/rate
        /// changes — not for a lone accrue, so 5s vs 5y stays identical.
        /// During grace, interest stays 0 and the epoch moves to now so
        /// post-grace compound runs from this principal change, not origination.
        pub fn lock_interest(&mut self) {
            let now = Self::now();
            if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
                let dirty = self.accrued_interest.value != 0
                    || now.seconds != self.last_interest_accrual.seconds;
                self.accrued_interest = Quantity::new(0);
                self.last_interest_accrual = now;
                if dirty && !self.is_clear() {
                    self.save();
                }
                return;
            }
            let live = self.live_accrued_at(now);
            if live == self.accrued_interest && now.seconds <= self.last_interest_accrual.seconds {
                return;
            }
            self.accrued_interest = live;
            self.last_interest_accrual = now;
            if !self.is_clear() {
                self.save();
            }
        }

        pub fn directed_principal(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
        ) -> u64 {
            Self::obligations(creditor, debtor, asset_id)
                .into_iter()
                .map(|o| o.remaining_principal.value)
                .sum()
        }

        /// Lock interest before a principal change on this row.
        pub fn accrue(&mut self) {
            self.lock_interest();
        }

        /// Lock every obligation on this directed pair/asset.
        pub fn accrue_pair(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
            for mut pair in Self::obligations(creditor, debtor, asset_id) {
                pair.lock_interest();
            }
        }

        /// Highest rate first; ties by older `created_at`, then lower `id`.
        fn sort_for_net(obs: &mut [Self]) {
            obs.sort_by(|a, b| {
                b.interest_rate
                    .cmp(&a.interest_rate)
                    .then_with(|| a.created_at.seconds.cmp(&b.created_at.seconds))
                    .then_with(|| a.id.cmp(&b.id))
            });
        }

        /// Reduce claims on this directed pair by `amount`.
        ///
        /// Protocol policy (not caller-configurable): sort by highest rate,
        /// then clear **all interest** in that order, then **principal**.
        pub fn apply_reduction(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: u64,
        ) {
            if amount == 0 {
                return;
            }
            let before = Self::directed_principal(creditor, debtor, asset_id);
            let mut obs = Self::obligations(creditor, debtor, asset_id);
            if obs.is_empty() {
                return;
            }

            Self::sort_for_net(&mut obs);
            Self::apply_reduction_waterfall(&mut obs, amount);

            for o in &obs {
                o.persist_or_delete();
            }
            let after = Self::directed_principal(creditor, debtor, asset_id);
            PairCycle::sync_cycle(creditor, debtor, asset_id, before, after);
        }

        /// Interest first (globally, highest-rate order), then principal.
        fn apply_reduction_waterfall(obs: &mut [Self], amount: u64) {
            let mut left = amount;
            for o in obs.iter_mut() {
                if left == 0 {
                    break;
                }
                let take = left.min(o.accrued_interest.value);
                o.accrued_interest = (o.accrued_interest.value - take).into();
                left -= take;
            }
            for o in obs.iter_mut() {
                if left == 0 {
                    break;
                }
                let take = left.min(o.remaining_principal.value);
                o.remaining_principal = (o.remaining_principal.value - take).into();
                left -= take;
            }
        }

        /// Move `amount` of claims (interest then principal, highest rate first)
        /// from `from_creditor` to `to_creditor` on the same `debtor` / asset,
        /// preserving each obligation's interest rate.
        pub fn transfer_claims(
            from_creditor: AccountNumber,
            to_creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: u64,
        ) {
            assert!(
                from_creditor != to_creditor,
                "cannot transfer claims to self"
            );
            assert!(amount > 0, "transfer amount must be positive");
            Self::accrue_pair(from_creditor, debtor, asset_id);
            let now = Self::now();
            let src_cycle = PairCycle::get(from_creditor, debtor, asset_id);
            let dest_before = Self::directed_principal(to_creditor, debtor, asset_id);
            let before_from = Self::directed_principal(from_creditor, debtor, asset_id);
            let available = Self::exposure(from_creditor, debtor, asset_id).value;
            assert!(
                available >= amount,
                "insufficient claim exposure to transfer"
            );

            let mut obs = Self::obligations(from_creditor, debtor, asset_id);
            Self::sort_for_net(&mut obs);
            let mut left = amount;

            for o in obs.iter_mut() {
                if left == 0 {
                    break;
                }
                let take_i = left.min(o.accrued_interest.value);
                if take_i > 0 {
                    o.accrued_interest = (o.accrued_interest.value - take_i).into();
                    let mut dest =
                        Self::get_existing_or_new(to_creditor, debtor, asset_id, o.interest_rate);
                    dest.accrue();
                    dest.accrued_interest = dest
                        .accrued_interest
                        .value
                        .checked_add(take_i)
                        .expect("accrued overflow")
                        .into();
                    dest.save();
                    left -= take_i;
                }
            }
            for o in obs.iter_mut() {
                if left == 0 {
                    break;
                }
                let take_p = left.min(o.remaining_principal.value);
                if take_p > 0 {
                    o.remaining_principal = (o.remaining_principal.value - take_p).into();
                    Self::credit_pair(
                        to_creditor,
                        debtor,
                        asset_id,
                        Quantity::new(take_p),
                        o.interest_rate,
                    );
                    left -= take_p;
                }
            }
            assert!(left == 0, "transfer claims underflow");
            for o in &obs {
                o.persist_or_delete();
            }
            let after_from = Self::directed_principal(from_creditor, debtor, asset_id);
            PairCycle::sync_cycle(from_creditor, debtor, asset_id, before_from, after_from);
            PairCycle::inherit_on_transfer(
                to_creditor,
                debtor,
                asset_id,
                src_cycle.as_ref(),
                dest_before,
                now,
            );
        }

        /// Net mutual obligations between `a` and `b` for `asset_id`.
        ///
        /// 1. Accrue both directions.
        /// 2. `cancel = min(exposure each way, max_amount)`.
        /// 3. Reduce each direction by `cancel` (interest then principal;
        ///    highest rate first).
        ///
        /// Either party may call; only reduces claims.
        pub fn net_pair(
            a: AccountNumber,
            b: AccountNumber,
            asset_id: u16,
            max_amount: Quantity,
        ) -> Quantity {
            assert!(a != b, "cannot net with self");

            Self::accrue_pair(a, b, asset_id);
            Self::accrue_pair(b, a, asset_id);

            // exposure(creditor, debtor) = what debtor owes creditor.
            let a_owed_by_b = Self::exposure(a, b, asset_id).value; // b owes a
            let b_owed_by_a = Self::exposure(b, a, asset_id).value; // a owes b
            let cancel = a_owed_by_b.min(b_owed_by_a).min(max_amount.value);
            if cancel == 0 {
                return 0.into();
            }

            Self::apply_reduction(a, b, asset_id, cancel);
            Self::apply_reduction(b, a, asset_id, cancel);
            cancel.into()
        }

        /// Grow principal on this claim (shared by deposit and line draws).
        /// Accrues first so interest is finalized on the prior principal balance.
        fn credit(&mut self, amount: Quantity) {
            let before = Self::directed_principal(self.creditor, self.debtor, self.asset_id);
            self.accrue();
            self.remaining_principal = self
                .remaining_principal
                .value
                .checked_add(amount.value)
                .expect("obligation principal overflow")
                .into();
            self.save();
            let after = Self::directed_principal(self.creditor, self.debtor, self.asset_id);
            PairCycle::sync_cycle(self.creditor, self.debtor, self.asset_id, before, after);
        }

        /// Credit the (creditor, debtor, rate) bucket, creating it if needed.
        pub fn credit_pair(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
            interest_rate: u32,
        ) {
            Self::get_existing_or_new(creditor, debtor, asset_id, interest_rate).credit(amount);
        }

        /// Book a deposit: `receiver` owes `depositor` (bank-liability style),
        /// then **auto-net** the pair so mutual claims cancel as far as possible.
        ///
        /// 1. Credit the reverse obligation (depositor creditor, receiver debtor).
        /// 2. [`net_pair`] with unlimited `max_amount` (interest first, highest
        ///    rate first). Remainder stays one-way if exposures were unequal.
        ///
        /// Returns the amount netted away (may be less than `amount`).
        pub fn deposit(
            depositor: AccountNumber,
            receiver: AccountNumber,
            asset_id: u16,
            amount: Quantity,
            interest_rate: u32,
        ) -> Quantity {
            Self::credit_pair(depositor, receiver, asset_id, amount, interest_rate);
            Self::net_pair(depositor, receiver, asset_id, u64::MAX.into())
        }

        fn save(&self) {
            ObligationTable::read_write().put(&self).unwrap()
        }
    }

    /// Posted grace + open-cycle snapshot for a directed pair/asset.
    ///
    /// Creditor writes `grace_seconds` via `st_crd_lne`. Principal-changing
    /// actions write the cycle clock via [`Self::sync_cycle`]. Same key as
    /// [`CreditLine`]; separate row so a line upsert cannot clobber the clock.
    #[table(name = "PairCycleTab", index = 7)]
    #[derive(Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PairCycle {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,
        /// Posted interest-free window for the *next* 0→positive cycle.
        pub grace_seconds: u32,
        /// When the current cycle opened (`0` = none).
        pub cycle_started_at: TimePointSec,
        /// Grace snapshotted at cycle open. Later posted-grace edits do not change it.
        pub cycle_grace_seconds: u32,
    }

    impl PairCycle {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.creditor, self.debtor, self.asset_id)
        }

        fn save(&self) {
            PairCycleTab::read_write().put(self).unwrap();
        }

        fn erase(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
            PairCycleTab::read_write().erase(&(creditor, debtor, asset_id));
        }

        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Option<Self> {
            PairCycleTab::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        /// Update posted grace only. Never touches an open cycle snapshot.
        pub fn set_posted_grace(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            grace_seconds: u32,
        ) {
            if let Some(mut c) = Self::get(creditor, debtor, asset_id) {
                c.grace_seconds = grace_seconds;
                if grace_seconds == 0 && c.cycle_started_at.seconds == 0 {
                    Self::erase(creditor, debtor, asset_id);
                } else {
                    c.save();
                }
            } else if grace_seconds > 0 {
                Self {
                    creditor,
                    debtor,
                    asset_id,
                    grace_seconds,
                    cycle_started_at: TimePointSec { seconds: 0 },
                    cycle_grace_seconds: 0,
                }
                .save();
            }
        }

        pub fn in_grace_at(&self, now: TimePointSec) -> bool {
            if self.cycle_started_at.seconds == 0 || self.cycle_grace_seconds == 0 {
                return false;
            }
            let end = self
                .cycle_started_at
                .seconds
                .saturating_add(i64::from(self.cycle_grace_seconds));
            now.seconds < end
        }

        pub fn pair_in_grace(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            now: TimePointSec,
        ) -> bool {
            Self::get(creditor, debtor, asset_id)
                .map(|c| c.in_grace_at(now))
                .unwrap_or(false)
        }

        /// Open a cycle on 0→positive (if posted grace > 0); close when
        /// principal returns to 0. No-op when there is no row.
        pub fn sync_cycle(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            before_principal: u64,
            after_principal: u64,
        ) {
            let Some(mut c) = Self::get(creditor, debtor, asset_id) else {
                return;
            };
            if before_principal == 0 && after_principal > 0 && c.cycle_started_at.seconds == 0 {
                if c.grace_seconds == 0 {
                    return;
                }
                c.cycle_started_at = Obligation::now();
                c.cycle_grace_seconds = c.grace_seconds;
                c.save();
            } else if after_principal == 0 && c.cycle_started_at.seconds != 0 {
                c.cycle_started_at = TimePointSec { seconds: 0 };
                c.cycle_grace_seconds = 0;
                if c.grace_seconds == 0 {
                    Self::erase(creditor, debtor, asset_id);
                } else {
                    c.save();
                }
            }
        }

        fn cycle_end(started: TimePointSec, grace_seconds: u32) -> i64 {
            started.seconds.saturating_add(i64::from(grace_seconds))
        }

        /// After a claim moves to a new creditor: keep the source remaining
        /// window (same end). Do not start the dest's posted grace — that
        /// would reset an already-aged tab.
        pub fn inherit_on_transfer(
            to_creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            src: Option<&Self>,
            dest_before_principal: u64,
            now: TimePointSec,
        ) {
            let src_in_grace = src.map(|c| c.in_grace_at(now)).unwrap_or(false);

            if dest_before_principal > 0 {
                if !src_in_grace {
                    return;
                }
                let src = src.unwrap();
                let src_end = Self::cycle_end(src.cycle_started_at, src.cycle_grace_seconds);
                let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) else {
                    return;
                };
                if !dest.in_grace_at(now) {
                    return;
                }
                let dest_end = Self::cycle_end(dest.cycle_started_at, dest.cycle_grace_seconds);
                if src_end <= dest_end {
                    return;
                }
                dest.cycle_grace_seconds = u32::try_from(
                    src_end.saturating_sub(dest.cycle_started_at.seconds),
                )
                .unwrap_or(u32::MAX);
                dest.save();
                return;
            }

            if src_in_grace {
                let src = src.unwrap();
                if let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) {
                    dest.cycle_started_at = src.cycle_started_at;
                    dest.cycle_grace_seconds = src.cycle_grace_seconds;
                    dest.save();
                } else {
                    Self {
                        creditor: to_creditor,
                        debtor,
                        asset_id,
                        grace_seconds: 0,
                        cycle_started_at: src.cycle_started_at,
                        cycle_grace_seconds: src.cycle_grace_seconds,
                    }
                    .save();
                }
            } else if let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) {
                if dest.cycle_started_at.seconds != 0 {
                    dest.cycle_started_at = TimePointSec { seconds: 0 };
                    dest.cycle_grace_seconds = 0;
                    if dest.grace_seconds == 0 {
                        Self::erase(to_creditor, debtor, asset_id);
                    } else {
                        dest.save();
                    }
                }
            }
        }
    }

    /// Bilateral credit facility: `creditor` will be owed by `debtor` up to
    /// `limit` of `asset_id`, at `interest_rate` on new draws.
    ///
    /// `limit` is a stable cap on outstanding exposure (principal + interest).
    /// A draw of `amount` requires `exposure + amount <= limit`.
    /// When `deplete_on_debit`, `remaining` is unused grant (shrinks on draw /
    /// buy-claim; not restored by repayment). Revolving lines ignore `remaining`.
    ///
    /// Interest-free grace lives on [`PairCycle`], not this row.
    #[table(name = "CreditLineTable", index = 3)]
    #[derive(Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        /// Stable cap on outstanding exposure (principal + accrued interest).
        pub limit: Quantity,
        /// If true, draws/buy-claim also consume [`Self::remaining`].
        pub deplete_on_debit: bool,
        /// Rate applied to new draws on this line (ppm APR); see [`crate::interest`].
        pub interest_rate: u32,
        /// Unused grant when `deplete_on_debit`. Ignored for revolving lines.
        pub remaining: Quantity,
    }

    impl CreditLine {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.creditor, self.debtor, self.asset_id)
        }

        fn save(&self) {
            CreditLineTable::read_write().put(&self).unwrap();
        }

        fn new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            limit: Quantity,
            deplete_on_debit: bool,
            interest_rate: u32,
        ) -> Self {
            Self {
                creditor,
                debtor,
                asset_id,
                limit,
                deplete_on_debit,
                interest_rate,
                remaining: if deplete_on_debit {
                    limit
                } else {
                    Quantity::new(0)
                },
            }
        }

        /// Drawable headroom: `limit - exposure`, also capped by `remaining`
        /// when depleting.
        pub fn draw_headroom(&self) -> u64 {
            let exposure = Obligation::exposure(self.creditor, self.debtor, self.asset_id).value;
            let vs_limit = self.limit.value.saturating_sub(exposure);
            if self.deplete_on_debit {
                vs_limit.min(self.remaining.value)
            } else {
                vs_limit
            }
        }

        pub fn consume_grant(&mut self, amount: Quantity) {
            if !self.deplete_on_debit {
                return;
            }
            assert!(
                amount.value <= self.remaining.value,
                "insufficient remaining grant"
            );
            self.remaining = (self.remaining.value - amount.value).into();
            self.save();
        }

        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Option<Self> {
            CreditLineTable::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Self {
            Self::get(creditor, debtor, asset_id).unwrap_or_else(|| {
                panic!(
                    "credit line not found: creditor={}, debtor={}, asset_id={}",
                    creditor, debtor, asset_id
                )
            })
        }

        pub fn upsert_credit_line(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
            deplete_on_debit: bool,
            interest_rate: u32,
            grace_seconds: u32,
        ) {
            assert!(creditor != debtor, "cannot set credit line to self");
            let _ = Asset::get_assert(asset_id);
            assert!(
                interest_rate <= PPM_SCALE,
                "interest_rate exceeds 100% (PPM_SCALE)"
            );
            if let Some(mut line) = Self::get(creditor, debtor, asset_id) {
                let was_depleting = line.deplete_on_debit;
                line.limit = amount;
                line.deplete_on_debit = deplete_on_debit;
                line.interest_rate = interest_rate;
                if !deplete_on_debit {
                    line.remaining = Quantity::new(0);
                } else if !was_depleting {
                    line.remaining = amount;
                } else if line.remaining.value > amount.value {
                    line.remaining = amount;
                }
                line.save();
            } else {
                CreditLine::new(
                    creditor,
                    debtor,
                    asset_id,
                    amount,
                    deplete_on_debit,
                    interest_rate,
                )
                .save();
            }
            PairCycle::set_posted_grace(creditor, debtor, asset_id, grace_seconds);
        }

        /// Erase the line. Posted grace is cleared if no cycle is open.
        /// Outstanding obligations are untouched.
        pub fn remove(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
            assert!(
                Self::get(creditor, debtor, asset_id).is_some(),
                "credit line not found"
            );
            CreditLineTable::read_write().erase(&(creditor, debtor, asset_id));
            PairCycle::set_posted_grace(creditor, debtor, asset_id, 0);
        }
    }

    /// Directed pair in one asset: the creditor's line to the debtor (if any)
    /// plus both tabs. Virtual — not a table.
    ///
    /// A path hop is this object: `debtor` draws on `creditor`. The reverse
    /// tab (creditor already owes debtor) is unwind capacity and does not
    /// need a line. Sending 1000 against a 400 reverse tab is unwind 400 +
    /// new 600; after net the debtor owes 600.
    #[derive(Clone, Debug)]
    pub struct Connection {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,
        line: Option<CreditLine>,
        /// Debtor already owes creditor.
        forward: Quantity,
        /// Creditor already owes debtor (unwind).
        reverse: Quantity,
    }

    impl Connection {
        /// Accrue both tabs, then snapshot.
        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Self {
            Obligation::accrue_pair(creditor, debtor, asset_id);
            Obligation::accrue_pair(debtor, creditor, asset_id);
            Self::get_live(creditor, debtor, asset_id)
        }

        /// Snapshot without locking interest (queries, `knows`).
        pub fn get_live(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Self {
            Self {
                creditor,
                debtor,
                asset_id,
                line: CreditLine::get(creditor, debtor, asset_id),
                forward: Obligation::exposure(creditor, debtor, asset_id),
                reverse: Obligation::exposure(debtor, creditor, asset_id),
            }
        }

        pub fn line(&self) -> Option<&CreditLine> {
            self.line.as_ref()
        }

        pub fn forward(&self) -> Quantity {
            self.forward
        }

        pub fn reverse(&self) -> Quantity {
            self.reverse
        }

        pub fn line_headroom(&self) -> u64 {
            let Some(line) = &self.line else {
                return 0;
            };
            let vs_limit = line.limit.value.saturating_sub(self.forward.value);
            if line.deplete_on_debit {
                vs_limit.min(line.remaining.value)
            } else {
                vs_limit
            }
        }

        /// Reverse tab plus unused line headroom.
        pub fn capacity(&self) -> u64 {
            self.reverse.value.saturating_add(self.line_headroom())
        }

        /// Slice of `amount` that is new line capacity (not unwind).
        pub fn new_draw(&self, amount: Quantity) -> u64 {
            amount.value.saturating_sub(self.reverse.value)
        }

        /// `who` lined `them`, or they already have a live tab either way.
        pub fn knows(who: AccountNumber, them: AccountNumber, asset_id: u16) -> bool {
            let c = Self::get_live(who, them, asset_id);
            c.line.is_some() || c.forward.value > 0 || c.reverse.value > 0
        }

        /// Draw for `path_pay`: unwind the reverse tab, then new line
        /// capacity. Grant is consumed only for the new slice.
        pub fn draw(mut self, amount: Quantity) {
            assert!(amount.value > 0, "path debit amount must be positive");
            assert!(
                amount.value <= self.capacity(),
                "insufficient path capacity (line + reverse claim)"
            );

            let new_draw = self.new_draw(amount);
            let rate = if new_draw > 0 {
                let line = self
                    .line
                    .as_mut()
                    .expect("credit line required for new path draw");
                line.consume_grant(Quantity::new(new_draw));
                line.interest_rate
            } else {
                self.line.as_ref().map(|l| l.interest_rate).unwrap_or(0)
            };

            Obligation::credit_pair(self.creditor, self.debtor, self.asset_id, amount, rate);
            let netted =
                Obligation::net_pair(self.creditor, self.debtor, self.asset_id, u64::MAX.into());
            emit_pair_activity(
                self.creditor,
                self.debtor,
                self.asset_id,
                "path_draw",
                amount,
                netted,
                self.asset_id,
                0,
                "",
            );
        }
    }

    /// Emit bilateral history (once per party as `account`) via service events.
    pub fn emit_pair_activity(
        party_a: AccountNumber,
        party_b: AccountNumber,
        asset_id: u16,
        kind: &str,
        amount: Quantity,
        netted: Quantity,
        other_asset_id: u16,
        request_id: u32,
        memo: &str,
    ) {
        let actor = psibase::get_sender();
        let amount_s = amount.value.to_string();
        let netted_s = netted.value.to_string();
        let kind_s = kind.to_string();
        let memo_s = memo.to_string();
        for (account, counterparty) in [(party_a, party_b), (party_b, party_a)] {
            crate::Wrapper::emit().history().activity(
                account,
                counterparty,
                asset_id,
                kind_s.clone(),
                amount_s.clone(),
                netted_s.clone(),
                other_asset_id,
                actor,
                request_id,
                memo_s.clone(),
            );
        }
    }
}

#[psibase::service(name = "banx", tables = "tables")]
pub mod service {
    use crate::tables::{
        emit_pair_activity, Asset, ClaimOffer, Connection, CreditLine, CurrencyPolicy,
        ForwardOffer, InitRow, InitTable, Obligation, PathHop, PayRequest,
    };
    use psibase::{
        services::events,
        services::tokens::{Precision, Quantity},
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
            Quantity::new(0),
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
    /// live tab). A buyer line to the debtor is optional (cap only).
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

        Obligation::net_pair(sender, counterparty, from_asset, u64::MAX.into());
        let they_owe = Obligation::exposure(sender, counterparty, from_asset).value;
        let i_owe = Obligation::exposure(counterparty, sender, from_asset).value;
        let (creditor, debtor) = if they_owe > 0 {
            (sender, counterparty)
        } else if i_owe > 0 {
            (counterparty, sender)
        } else {
            panic!("nothing to convert in from_asset");
        };

        CurrencyPolicy::get_assert(counterparty, from_asset, to_asset).convert(
            creditor,
            debtor,
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
        let netted = Obligation::deposit(depositor, receiver, asset_id, amount, interest_rate);
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
    ///    previous tab: the payer still owes the middle man in the from-asset;
    ///    the middle man takes the to-asset liability onward.
    /// 3. **Later hops** — intermediate's live [`ForwardOffer`] (fee + max
    ///    line APR); draw on next line.
    /// 4. **`min_return`** — final hop principal (in **last** asset) ≥ this.
    ///
    /// Atomic: all legs succeed or none stick.
    ///
    /// Each draw **auto-nets** that pair/asset (via [`Connection::draw`]).
    ///
    /// `request_id` 0 = none. Non-zero must be a live invoice naming the
    /// sender as payer; last hop must be the invoice poster in that asset.
    #[action]
    fn path_pay(hops: Vec<PathHop>, amount: Quantity, min_return: Quantity, request_id: u32) {
        assert!(!hops.is_empty(), "path_pay must include at least one hop");
        assert!(amount.value > 0, "path_pay amount must be positive");
        let last_hop = hops[hops.len() - 1];

        let mut path_debtor = get_sender();
        let mut forward = amount;
        let mut prev_edge_creditor = get_sender(); // overwritten after hop 0
        let mut prev_asset = hops[0].asset_id;

        for (i, hop) in hops.into_iter().enumerate() {
            let PathHop {
                account: next_creditor,
                asset_id,
            } = hop;
            assert!(next_creditor != path_debtor, "path_pay cannot draw on self");

            if i == 0 {
                Connection::get(next_creditor, path_debtor, asset_id).draw(forward);
                prev_edge_creditor = next_creditor;
                prev_asset = asset_id;
                path_debtor = next_creditor;
                continue;
            }

            // FX sizes the next hop only. Previous tab stays in from-asset.
            if asset_id != prev_asset {
                forward = CurrencyPolicy::get_assert(prev_edge_creditor, prev_asset, asset_id)
                    .apply(forward);
            }

            assert!(
                forward.value > 0,
                "path_pay hop produced nothing to forward"
            );

            // Same-asset forward hop: live specific, else live global.
            forward = ForwardOffer::get_assert(path_debtor, next_creditor, asset_id)
                .path_draw(next_creditor, forward);
            prev_edge_creditor = next_creditor;
            prev_asset = asset_id;
            path_debtor = next_creditor;
        }

        assert!(
            forward.value >= min_return.value,
            "path_pay final amount below min_return"
        );

        if request_id != 0 {
            PayRequest::fulfill_invoice(
                request_id,
                get_sender(),
                last_hop.account,
                last_hop.asset_id,
                forward,
            );
        }
    }

    /// Post an invoice (`1`), please-book (`2`), or settle-auth (`3`).
    ///
    /// Invoice: poster is payee; `counterparty` should path-pay ending at poster.
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
        let netted = Obligation::deposit(debtor, creditor, asset_id, take, 0);
        emit_pair_activity(
            debtor, creditor, asset_id, "deposit", take, netted, asset_id, request_id, &memo,
        );
    }

    /// Bilateral activity history (emitted once per party as `account`).
    ///
    /// - `kind`: `path_draw` | `deposit` | `net` | `convert` | `credit_line` |
    ///   `rm_credit_line` | `sell_claim` | `invoice` | `please_book` |
    ///   `settle_auth` | `fulfill` | `req_cancel`
    /// - `amount`: primary quantity (raw units)
    /// - `netted`: amount cancelled by auto-net (or convert output for `convert`)
    /// - `other_asset_id`: convert destination asset; otherwise same as `asset_id`
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
