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

    pub fn policy_is_live(expires_at: TimePointSec) -> bool {
        if expires_at.seconds == 0 {
            return true;
        }
        let now = psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds();
        now.seconds <= expires_at.seconds
    }

    pub fn assert_policy_live(expires_at: TimePointSec) {
        assert!(policy_is_live(expires_at), "policy expired");
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
        assert!(
            fee_percent_ppm < PPM_SCALE,
            "hop fee must be under 100%"
        );
        let keep_ppm = (PPM_SCALE - fee_percent_ppm) as u128;
        let after_pct = (amount_in.value as u128)
            .checked_mul(keep_ppm)
            .expect("hop fee overflow")
            / (PPM_SCALE as u128);
        let after_pct = u64::try_from(after_pct).expect("hop fee out exceeds u64");
        assert!(
            fee_fixed.value < after_pct,
            "fixed hop fee consumes entire amount after percent fee"
        );
        let out = after_pct - fee_fixed.value;
        assert!(out > 0, "hop fee reduced amount to zero");
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
    /// has lined the poster.
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
        /// Max APR ppm on a line poster **draws** when forwarding.
        pub max_line_apr: u32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
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
        ) {
            assert!(
                max_line_apr <= PPM_SCALE,
                "max_line_apr exceeds 100% (PPM_SCALE)"
            );
            assert!(fee_percent < PPM_SCALE, "fee must be under 100%");
            if next_hop != Self::GLOBAL {
                let _ = CreditLine::get_assert(next_hop, poster, asset_id);
            }
            Self {
                poster,
                next_hop,
                asset_id,
                fee_fixed,
                fee_percent,
                max_line_apr,
                expires_at,
            }
            .save();
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
            assert_policy_live(self.expires_at);
            let creditor = if self.is_global() {
                next_creditor
            } else {
                assert!(
                    next_creditor == self.next_hop,
                    "forward offer next hop mismatch"
                );
                self.next_hop
            };
            if let Some(line) = CreditLine::get(creditor, self.poster, self.asset_id) {
                assert!(
                    line.interest_rate <= self.max_line_apr,
                    "next hop interest rate exceeds max_line_apr"
                );
            }
            let draw = self.apply_fees(amount_in);
            CreditLine::path_debit(creditor, self.poster, self.asset_id, draw);
            draw
        }
    }

    /// Claim-takeout offer: `poster` will buy claims via `sell_claim`.
    /// `debtor = 0` is global (any debtor the poster has lined). Residual
    /// is checked at `sell_claim` time, not at post.
    #[table(name = "TakeoutOfferTab", index = 6)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct TakeoutOffer {
        pub poster: AccountNumber,
        /// Underlying debtor, or [`Self::GLOBAL`].
        pub debtor: AccountNumber,
        pub asset_id: u16,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%); must be `< PPM_SCALE`.
        pub fee_percent: u32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl TakeoutOffer {
        pub const GLOBAL: AccountNumber = AccountNumber::new(0);

        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.poster, self.debtor, self.asset_id)
        }

        fn save(&self) {
            TakeoutOfferTab::read_write().put(self).unwrap();
        }

        fn get(poster: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Option<Self> {
            TakeoutOfferTab::read()
                .get_index_pk()
                .get(&(poster, debtor, asset_id))
        }

        pub fn is_global(&self) -> bool {
            self.debtor == Self::GLOBAL
        }

        pub fn upsert(
            poster: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            fee_fixed: Quantity,
            fee_percent: u32,
            expires_at: TimePointSec,
        ) {
            assert!(fee_percent < PPM_SCALE, "fee must be under 100%");
            Self {
                poster,
                debtor,
                asset_id,
                fee_fixed,
                fee_percent,
                expires_at,
            }
            .save();
        }

        pub fn remove(poster: AccountNumber, debtor: AccountNumber, asset_id: u16) {
            assert!(
                Self::get(poster, debtor, asset_id).is_some(),
                "takeout offer not found"
            );
            TakeoutOfferTab::read_write().erase(&(poster, debtor, asset_id));
        }

        pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
            apply_hop_fee(amount_in, self.fee_fixed, self.fee_percent)
        }
    }

    /// Invoice (`INVOICE`): poster is the payee; counterparty should `path_pay`
    /// so the last hop is the poster. Does **not** shrink an existing debt to
    /// the poster.
    ///
    /// Please-book (`PLEASE_BOOK`): poster asked the counterparty (creditor)
    /// to `deposit` them — off-graph value received. Only the creditor can
    /// fulfill; the poster cannot clear their own debt.
    #[table(name = "RequestTab", index = 8)]
    #[derive(Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PayRequest {
        pub id: u32,
        /// [`Self::INVOICE`] or [`Self::PLEASE_BOOK`].
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

        fn assert_live(&self) {
            assert!(self.remaining.value > 0, "request already fulfilled");
            assert_policy_live(self.expires_at);
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
                kind == Self::INVOICE || kind == Self::PLEASE_BOOK,
                "request kind must be invoice (1) or please-book (2)"
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
            let kind_s = if kind == Self::INVOICE {
                "invoice"
            } else {
                "please_book"
            };
            emit_pair_activity(
                poster,
                counterparty,
                asset_id,
                kind_s,
                amount,
                Quantity::new(0),
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
    }

    fn offer_live(expires_at: TimePointSec) -> bool {
        policy_is_live(expires_at)
    }

    /// Live specific forward, else live global.
    pub fn resolve_forward(
        next_creditor: AccountNumber,
        poster: AccountNumber,
        asset_id: u16,
    ) -> ForwardOffer {
        if let Some(p) = ForwardOffer::get(poster, next_creditor, asset_id) {
            if offer_live(p.expires_at) {
                return p;
            }
        }
        if let Some(g) = ForwardOffer::get(poster, ForwardOffer::GLOBAL, asset_id) {
            if offer_live(g.expires_at) {
                return g;
            }
        }
        panic!("ForwardOffer not found (no specific or global forward for this asset)");
    }

    /// Live specific takeout, else live global.
    pub fn resolve_take(
        buyer: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
    ) -> TakeoutOffer {
        if let Some(p) = TakeoutOffer::get(buyer, debtor, asset_id) {
            if offer_live(p.expires_at) {
                return p;
            }
        }
        if let Some(g) = TakeoutOffer::get(buyer, TakeoutOffer::GLOBAL, asset_id) {
            if offer_live(g.expires_at) {
                return g;
            }
        }
        panic!("TakeoutOffer not found (buyer has no takeout offer for this asset)");
    }

    /// Debtor-posted quote: re-denominate **any** claim against this debtor
    /// from `from_asset` → `to_asset` at `fx_rate` (plus optional fixed fee).
    ///
    /// No creditor in the key — one policy covers every holder of the debtor's
    /// obligations in `from_asset`. Convert names the **creditor** whose claim
    /// is rebooked.
    ///
    /// Also used **inside** `path_pay` when consecutive hops change asset:
    /// the previous edge is rebooked before the next same-asset routing hop.
    /// Prefer short `expires_at` for FX-sensitive pairs.
    #[table(name = "CurrencyPolicyTab", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CurrencyPolicy {
        /// Debtor who posts the quote (and whose debts may be re-denominated).
        pub debtor: AccountNumber,
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
            (self.debtor, self.from_asset, self.to_asset)
        }

        fn save(&self) {
            CurrencyPolicyTab::read_write().put(self).unwrap();
        }

        pub fn get(debtor: AccountNumber, from_asset: u16, to_asset: u16) -> Option<Self> {
            CurrencyPolicyTab::read()
                .get_index_pk()
                .get(&(debtor, from_asset, to_asset))
        }

        pub fn get_assert(debtor: AccountNumber, from_asset: u16, to_asset: u16) -> Self {
            Self::get(debtor, from_asset, to_asset).expect("CurrencyPolicy not found")
        }

        /// Debtor posts a convert quote applying to all their creditors.
        pub fn upsert(
            debtor: AccountNumber,
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
                debtor,
                from_asset,
                to_asset,
                fee_fixed,
                fx_rate,
                to_interest_rate,
                expires_at,
            }
            .save();
        }

        /// Rebook up to `amount_from` of what `self.debtor` owes `creditor` in
        /// `from_asset` into `to_asset`. Auto-nets the pair in `to_asset`.
        /// Returns units created in `to_asset` (before that net).
        pub fn convert(
            &self,
            creditor: AccountNumber,
            amount_from: Quantity,
            min_to: Quantity,
        ) -> Quantity {
            assert_policy_live(self.expires_at);
            assert!(amount_from.value > 0, "convert amount must be positive");
            assert!(creditor != self.debtor, "creditor must differ from debtor");

            Obligation::accrue_pair(creditor, self.debtor, self.from_asset);
            let available = Obligation::exposure(creditor, self.debtor, self.from_asset).value;
            let take = amount_from.value.min(available);
            assert!(take > 0, "nothing to convert in from_asset");

            Obligation::apply_reduction(creditor, self.debtor, self.from_asset, take);

            let to_qty = apply_rate(Quantity::new(take), self.fee_fixed, self.fx_rate);
            assert!(to_qty.value >= min_to.value, "convert output below min_to");

            Obligation::credit_pair(
                creditor,
                self.debtor,
                self.to_asset,
                self.to_interest_rate,
                to_qty,
            );
            Obligation::net_pair(creditor, self.debtor, self.to_asset, u64::MAX.into());
            emit_pair_activity(
                creditor,
                self.debtor,
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
        /// During a grace window, interest stays 0 and the cycle start is kept
        /// so post-grace compound still runs from origination.
        pub fn lock_interest(&mut self) {
            let now = Self::now();
            if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
                if self.accrued_interest.value != 0 {
                    self.accrued_interest = Quantity::new(0);
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
            assert!(from_creditor != to_creditor, "cannot transfer claims to self");
            assert!(amount > 0, "transfer amount must be positive");
            Self::accrue_pair(from_creditor, debtor, asset_id);
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
                        o.interest_rate,
                        Quantity::new(take_p),
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
            let before =
                Self::directed_principal(self.creditor, self.debtor, self.asset_id);
            self.accrue();
            self.remaining_principal = self
                .remaining_principal
                .value
                .checked_add(amount.value)
                .expect("obligation principal overflow")
                .into();
            self.save();
            let after = Self::directed_principal(self.creditor, self.debtor, self.asset_id);
            PairCycle::sync_cycle(
                self.creditor,
                self.debtor,
                self.asset_id,
                before,
                after,
            );
        }

        /// Credit the (creditor, debtor, rate) bucket, creating it if needed.
        pub fn credit_pair(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            interest_rate: u32,
            amount: Quantity,
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
            Self::credit_pair(depositor, receiver, asset_id, interest_rate, amount);
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
    #[derive(
        Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
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

        pub fn get(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
        ) -> Option<Self> {
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
            if before_principal == 0
                && after_principal > 0
                && c.cycle_started_at.seconds == 0
            {
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
    }

    /// Bilateral credit facility: `creditor` will be owed by `debtor` up to
    /// `limit` of `asset_id`, at `interest_rate` on new draws.
    ///
    /// `limit` is a stable cap on outstanding exposure (principal + interest).
    /// A draw of `amount` requires `exposure + amount <= limit`.
    /// When `deplete_on_debit`, `remaining` is unused grant (shrinks on draw /
    /// takeout; not restored by repayment). Revolving lines ignore `remaining`.
    ///
    /// Interest-free grace lives on [`PairCycle`], not this row.
    #[table(name = "CreditLineTable", index = 3)]
    #[derive(
        Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        /// Stable cap on outstanding exposure (principal + accrued interest).
        pub limit: Quantity,
        /// If true, draws/takeout also consume [`Self::remaining`].
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
                line.limit = amount;
                line.deplete_on_debit = deplete_on_debit;
                line.interest_rate = interest_rate;
                line.remaining = if deplete_on_debit {
                    amount
                } else {
                    Quantity::new(0)
                };
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

        /// Line headroom plus reverse claim (`creditor` already owes `debtor`).
        /// That reverse book can be unwound by a path draw + auto-net without
        /// the opposite credit line existing. Live (no persist).
        pub fn path_capacity_live(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
        ) -> u64 {
            let reverse = Obligation::exposure(debtor, creditor, asset_id).value;
            let line_cap = Self::get(creditor, debtor, asset_id)
                .map(|l| l.draw_headroom())
                .unwrap_or(0);
            reverse.saturating_add(line_cap)
        }

        pub fn path_capacity(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
        ) -> u64 {
            Obligation::accrue_pair(creditor, debtor, asset_id);
            Obligation::accrue_pair(debtor, creditor, asset_id);
            Self::path_capacity_live(creditor, debtor, asset_id)
        }

        /// Draw for `path_pay`: uses a credit line and/or an existing reverse
        /// claim (auto-net). Grant is consumed only for the portion that is
        /// new line capacity.
        pub fn path_debit(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
        ) {
            assert!(amount.value > 0, "path debit amount must be positive");
            let cap = Self::path_capacity(creditor, debtor, asset_id);
            assert!(
                amount.value <= cap,
                "insufficient path capacity (line + reverse claim)"
            );

            let reverse = Obligation::exposure(debtor, creditor, asset_id).value;
            let new_draw = amount.value.saturating_sub(reverse);
            let line = Self::get(creditor, debtor, asset_id);
            let rate = if new_draw > 0 {
                let mut line = line.expect("credit line required for new path draw");
                line.consume_grant(Quantity::new(new_draw));
                line.interest_rate
            } else {
                line.map(|l| l.interest_rate).unwrap_or(0)
            };

            Obligation::credit_pair(creditor, debtor, asset_id, rate, amount);
            let netted = Obligation::net_pair(creditor, debtor, asset_id, u64::MAX.into());
            emit_pair_activity(
                creditor,
                debtor,
                asset_id,
                "path_draw",
                amount,
                netted,
                asset_id,
                0,
                "",
            );
        }

        /// Draw `amount` of new principal: check `exposure + amount <= limit`,
        /// consume `remaining` if depleting, credit the line-rate bucket, auto-net.
        pub fn debit(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
        ) {
            Self::path_debit(creditor, debtor, asset_id, amount);
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
        emit_pair_activity, resolve_forward, resolve_take, Asset, CreditLine, CurrencyPolicy,
        ForwardOffer, InitRow, InitTable, Obligation, PathHop, PayRequest, TakeoutOffer,
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
            Asset::add(
                account!("btc"),
                crypto8,
                "1.00000000 = 1 Bitcoin".into(),
            );
            Asset::add(
                account!("eth"),
                crypto8,
                "1.00000000 = 1 Ethereum".into(),
            );
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
    ) {
        ForwardOffer::upsert(
            get_sender(),
            ForwardOffer::GLOBAL,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            expires_at,
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

    /// Post/update a **specific** takeout offer (`debtor` ≠ 0).
    ///
    /// Poster will buy claims on that debtor via `sell_claim`.
    #[action]
    fn st_tko_ofr(
        debtor: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        expires_at: TimePointSec,
    ) {
        assert!(
            debtor != TakeoutOffer::GLOBAL,
            "use st_glb_tko for global takeout offer (debtor 0)"
        );
        TakeoutOffer::upsert(
            get_sender(),
            debtor,
            asset_id,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Post/update a **global** takeout offer (`debtor = 0`).
    #[action]
    fn st_glb_tko(
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        expires_at: TimePointSec,
    ) {
        TakeoutOffer::upsert(
            get_sender(),
            TakeoutOffer::GLOBAL,
            asset_id,
            fee_fixed,
            fee_percent,
            expires_at,
        );
    }

    /// Remove a **specific** takeout offer.
    #[action]
    fn rm_tko_ofr(debtor: AccountNumber, asset_id: u16) {
        assert!(
            debtor != TakeoutOffer::GLOBAL,
            "use rm_glb_tko for global takeout offer"
        );
        TakeoutOffer::remove(get_sender(), debtor, asset_id);
    }

    /// Remove a **global** takeout offer.
    #[action]
    fn rm_glb_tko(asset_id: u16) {
        TakeoutOffer::remove(get_sender(), TakeoutOffer::GLOBAL, asset_id);
    }

    /// Seller (sender) sells claims on `debtor` to `buyer` under buyer's takeout
    /// offer. Buyer becomes creditor of `debtor` for `amount`; seller receives
    /// a claim on buyer for face after fees. Requires buyer's line residual to
    /// `debtor` and a live takeout offer (specific or global).
    #[action]
    fn sell_claim(
        buyer: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
    ) {
        let seller = get_sender();
        assert!(seller != buyer, "cannot sell claim to self");
        assert!(seller != debtor, "cannot sell claim on self as debtor");
        assert!(buyer != debtor, "buyer cannot be the debtor");
        assert!(amount.value > 0, "sell_claim amount must be positive");

        let offer = resolve_take(buyer, debtor, asset_id);
        crate::tables::assert_policy_live(offer.expires_at);

        let mut line = CreditLine::get_assert(buyer, debtor, asset_id);
        Obligation::accrue_pair(buyer, debtor, asset_id);
        let buyer_exp = Obligation::exposure(buyer, debtor, asset_id).value;
        assert!(
            buyer_exp.saturating_add(amount.value) <= line.limit.value,
            "buyer credit line residual insufficient for claim takeout"
        );
        line.consume_grant(amount);

        let proceeds = offer.apply_fees(amount);
        Obligation::transfer_claims(seller, buyer, debtor, asset_id, amount.value);
        // Proceeds: buyer owes seller (0% obligation).
        Obligation::credit_pair(seller, buyer, asset_id, 0, proceeds);
        Obligation::net_pair(seller, buyer, asset_id, u64::MAX.into());
        Obligation::net_pair(buyer, debtor, asset_id, u64::MAX.into());

        emit_pair_activity(
            seller,
            buyer,
            asset_id,
            "sell_claim",
            amount,
            proceeds,
            asset_id,
            0,
            "",
        );
    }

    /// Debtor posts a convert quote for **all** holders of their `from_asset`
    /// obligations → `to_asset`. See [`CurrencyPolicy`].
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

    /// Convert existing debt using the **debtor's** [`CurrencyPolicy`].
    ///
    /// `counterparty` is the other party on the obligation. Sender must be
    /// creditor or debtor. Rebooks up to `amount_from` of `from_asset` into
    /// `to_asset` for that pair; requires output ≥ `min_to`. Auto-nets
    /// `to_asset` after the rebook.
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

        Obligation::accrue_pair(sender, counterparty, from_asset);
        Obligation::accrue_pair(counterparty, sender, from_asset);
        let sender_owes = Obligation::exposure(counterparty, sender, from_asset).value;
        let counterparty_owes = Obligation::exposure(sender, counterparty, from_asset).value;
        let (creditor, debtor) = match (sender_owes > 0, counterparty_owes > 0) {
            (true, false) => (counterparty, sender),
            (false, true) => (sender, counterparty),
            (true, true) => panic!("both directions have from_asset claims; net first"),
            (false, false) => panic!("nothing to convert in from_asset"),
        };

        let policy = CurrencyPolicy::get_assert(debtor, from_asset, to_asset);
        policy.convert(creditor, amount_from, min_to);
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
        let _ = Asset::get_assert(asset_id);
        assert!(
            interest_rate <= crate::tables::PPM_SCALE,
            "interest_rate exceeds 100% (PPM_SCALE)"
        );
        let req_memo = if request_id != 0 {
            PayRequest::fulfill_please_book(
                request_id,
                receiver,
                depositor,
                asset_id,
                amount,
            )
        } else {
            String::new()
        };
        let netted = Obligation::deposit(depositor, receiver, asset_id, amount, interest_rate);
        emit_pair_activity(
            depositor,
            receiver,
            asset_id,
            "deposit",
            amount,
            netted,
            asset_id,
            request_id,
            &req_memo,
        );
    }

    /// Live pair exposure (principal + interest since last principal/rate change).
    #[action]
    fn get_exposure(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
    ) -> Quantity {
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
    /// 2. **Currency change** — rebook previous edge (sender owes Gary AUD) via
    ///    sender's [`CurrencyPolicy`] AUD→USD.
    /// 3. **Later hops** — intermediate's live [`ForwardOffer`] (fee + max
    ///    line APR); draw on next line.
    /// 4. **`min_return`** — final hop principal (in **last** asset) ≥ this.
    ///
    /// Atomic: all legs succeed or none stick.
    ///
    /// Each draw **auto-nets** that pair/asset (via [`CreditLine::debit`]).
    ///
    /// `request_id` 0 = none. Non-zero must be a live invoice naming the
    /// sender as payer; last hop must be the invoice poster in that asset.
    #[action]
    fn path_pay(
        hops: Vec<PathHop>,
        amount: Quantity,
        min_return: Quantity,
        request_id: u32,
    ) {
        assert!(!hops.is_empty(), "path_pay must include at least one hop");
        assert!(amount.value > 0, "path_pay amount must be positive");
        let last_hop = hops[hops.len() - 1];

        let mut path_debtor = get_sender();
        let mut forward = amount;
        let mut prev_edge_debtor = get_sender();
        let mut prev_edge_creditor = get_sender(); // overwritten after hop 0
        let mut prev_asset = hops[0].asset_id;

        for (i, hop) in hops.into_iter().enumerate() {
            let PathHop {
                account: next_creditor,
                asset_id,
            } = hop;
            assert!(next_creditor != path_debtor, "path_pay cannot draw on self");

            if i == 0 {
                CreditLine::path_debit(next_creditor, path_debtor, asset_id, forward);
                prev_edge_debtor = path_debtor;
                prev_edge_creditor = next_creditor;
                prev_asset = asset_id;
                path_debtor = next_creditor;
                continue;
            }

            // Currency change ⇒ convert remaining previous-edge claim (post-net).
            if asset_id != prev_asset {
                Obligation::accrue_pair(prev_edge_creditor, prev_edge_debtor, prev_asset);
                let available =
                    Obligation::exposure(prev_edge_creditor, prev_edge_debtor, prev_asset);
                let take = Quantity::new(forward.value.min(available.value));
                if take.value == 0 {
                    forward = Quantity::new(0);
                } else {
                    let cpol =
                        CurrencyPolicy::get_assert(prev_edge_debtor, prev_asset, asset_id);
                    forward = cpol.convert(prev_edge_creditor, take, Quantity::new(0));
                }
            }

            if forward.value == 0 {
                break;
            }

            // Same-asset forward hop: live specific, else live global.
            let offer = resolve_forward(next_creditor, path_debtor, asset_id);
            forward = offer.path_draw(next_creditor, forward);
            prev_edge_debtor = path_debtor;
            prev_edge_creditor = next_creditor;
            path_debtor = next_creditor;
            prev_asset = asset_id;
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

    /// Post an invoice (`kind` = 1) or please-book (`kind` = 2).
    ///
    /// Invoice: poster is payee; `counterparty` should path-pay ending at poster.
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

    /// Bilateral activity history (emitted once per party as `account`).
    ///
    /// - `kind`: `path_draw` | `deposit` | `net` | `convert` | `credit_line` |
    ///   `sell_claim` | `invoice` | `please_book` | `fulfill` | `req_cancel`
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
