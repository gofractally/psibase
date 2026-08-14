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

    /// Interest math: simple APR on principal, path-independent under subdivision.
    ///
    /// # Rate
    ///
    /// `interest_rate` is **ppm per year** (parts per million): `10_000` = 1% APR,
    /// [`PPM_SCALE`] = 100% APR. Year length is fixed at [`SECONDS_PER_YEAR`] (365
    /// days) so results do not depend on leap years or wall-clock calendars.
    ///
    /// # Accrual (simple, not compounded into principal)
    ///
    /// Interest accrues on `remaining_principal` only; `accrued_interest` is a
    /// separate bucket. Between principal changes:
    ///
    /// ```text
    /// product   = principal * rate_ppm * dt_seconds + remainder
    /// interest  = product / (PPM_SCALE * SECONDS_PER_YEAR)
    /// remainder = product % (PPM_SCALE * SECONDS_PER_YEAR)
    /// ```
    ///
    /// Carrying `remainder` makes accrual **path-independent**: any sequence of
    /// accruals over an interval with fixed principal and rate yields the same
    /// total interest and final remainder as one accrual over the whole
    /// interval. Calling accrue twice in the same second is a no-op.
    pub mod interest {
        use super::PPM_SCALE;

        /// 365 * 24 * 60 * 60 — fixed, no leap seconds / leap years.
        pub const SECONDS_PER_YEAR: u128 = 31_536_000;
        pub const RATE_PPM_DENOM: u128 = PPM_SCALE as u128;
        pub const ACCRUAL_DENOM: u128 = RATE_PPM_DENOM * SECONDS_PER_YEAR;

        /// Returns `(interest_units, new_remainder)`.
        pub fn accrue_delta(
            principal: u64,
            rate_ppm: u32,
            dt_seconds: u64,
            remainder: u64,
        ) -> (u64, u64) {
            if principal == 0 || rate_ppm == 0 || dt_seconds == 0 {
                return (0, remainder);
            }
            let product = (principal as u128)
                .checked_mul(rate_ppm as u128)
                .expect("interest: principal * rate overflow")
                .checked_mul(dt_seconds as u128)
                .expect("interest: * dt overflow")
                .checked_add(remainder as u128)
                .expect("interest: + remainder overflow");
            let interest = product / ACCRUAL_DENOM;
            let new_remainder = product % ACCRUAL_DENOM;
            (
                u64::try_from(interest).expect("interest: accrued amount exceeds u64"),
                u64::try_from(new_remainder).expect("interest: remainder exceeds u64"),
            )
        }
    }

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        /// Next primary key for [`Obligation`] rows.
        pub next_obligation_id: u32,
        /// Next primary key for [`Asset`] rows (u16 space).
        pub next_asset_id: u16,
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

    pub fn assert_policy_live(expires_at: TimePointSec) {
        if expires_at.seconds == 0 {
            return;
        }
        let now = psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds();
        assert!(now.seconds <= expires_at.seconds, "policy expired");
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

    /// Path routing fees: fixed + percent, same-asset only (no FX).
    ///
    /// Stored in one table. **`creditor = AccountNumber::new(0)`** means
    /// **global** for this `(debtor, asset_id)` — applies to any next-hop line.
    /// A non-zero `creditor` is a per-line override (takes precedence).
    ///
    /// # Alice → Gary (AUD) → Steve (USD)
    ///
    /// Standing clearing offer: path forward (optional) and claim takeout (always
    /// while the row exists). Posted by `poster`.
    ///
    /// - **Path** (`forward_enabled`): poster is path-debtor; `counterparty` is
    ///   next hop or [`Self::GLOBAL`] for any next hop that lined them.
    /// - **Take claim**: seller moves obligations (debtor → seller) onto poster
    ///   as new creditor, for face minus fees; `counterparty` is that debtor or
    ///   [`Self::GLOBAL`] for any debtor poster has a line on.
    #[table(name = "ClearingOfferTab", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ClearingOffer {
        pub poster: AccountNumber,
        /// Next hop (path) / underlying debtor (take), or [`Self::GLOBAL`].
        pub counterparty: AccountNumber,
        pub asset_id: u16,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%); must be `< PPM_SCALE`.
        pub fee_percent: u32,
        /// Max APR ppm on a line poster **draws** when forwarding.
        pub max_line_apr: u32,
        /// When true, usable as a path hop; takeout is always on if row exists.
        pub forward_enabled: bool,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl ClearingOffer {
        pub const GLOBAL: AccountNumber = AccountNumber::new(0);

        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.poster, self.counterparty, self.asset_id)
        }

        fn save(&self) {
            ClearingOfferTab::read_write().put(self).unwrap();
        }

        fn get(poster: AccountNumber, counterparty: AccountNumber, asset_id: u16) -> Option<Self> {
            ClearingOfferTab::read()
                .get_index_pk()
                .get(&(poster, counterparty, asset_id))
        }

        pub fn is_global(&self) -> bool {
            self.counterparty == Self::GLOBAL
        }

        pub fn upsert(
            poster: AccountNumber,
            counterparty: AccountNumber,
            asset_id: u16,
            fee_fixed: Quantity,
            fee_percent: u32,
            max_line_apr: u32,
            forward_enabled: bool,
            expires_at: TimePointSec,
        ) {
            assert!(
                max_line_apr <= PPM_SCALE,
                "max_line_apr exceeds 100% (PPM_SCALE)"
            );
            assert!(fee_percent < PPM_SCALE, "fee must be under 100%");
            // Path specific: next hop must have lined the poster.
            // Take residual is checked at sell_claim time (poster must line debtor).
            if counterparty != Self::GLOBAL && forward_enabled {
                let _ = CreditLine::get_assert(counterparty, poster, asset_id);
            }
            Self {
                poster,
                counterparty,
                asset_id,
                fee_fixed,
                fee_percent,
                max_line_apr,
                forward_enabled,
                expires_at,
            }
            .save();
        }

        pub fn remove(poster: AccountNumber, counterparty: AccountNumber, asset_id: u16) {
            assert!(
                Self::get(poster, counterparty, asset_id).is_some(),
                "clearing offer not found"
            );
            ClearingOfferTab::read_write().erase(&(poster, counterparty, asset_id));
        }

        pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
            apply_hop_fee(amount_in, self.fee_fixed, self.fee_percent)
        }

        /// Path draw: fee then debit next hop's line to poster. Requires
        /// `forward_enabled`.
        pub fn path_draw(&self, next_creditor: AccountNumber, amount_in: Quantity) -> Quantity {
            assert!(self.forward_enabled, "clearing offer does not allow path forward");
            assert_policy_live(self.expires_at);
            let creditor = if self.is_global() {
                next_creditor
            } else {
                assert!(
                    next_creditor == self.counterparty,
                    "clearing offer counterparty mismatch"
                );
                self.counterparty
            };
            let line = CreditLine::get_assert(creditor, self.poster, self.asset_id);
            assert!(
                line.interest_rate <= self.max_line_apr,
                "next hop interest rate exceeds max_line_apr"
            );
            let draw = self.apply_fees(amount_in);
            CreditLine::debit(creditor, self.poster, self.asset_id, draw);
            draw
        }
    }

    /// Specific next-hop offer, else global, for path forward.
    pub fn resolve_clearing_forward(
        next_creditor: AccountNumber,
        poster: AccountNumber,
        asset_id: u16,
    ) -> ClearingOffer {
        if let Some(p) = ClearingOffer::get(poster, next_creditor, asset_id) {
            assert!(p.forward_enabled, "clearing offer does not allow path forward");
            return p;
        }
        if let Some(g) = ClearingOffer::get(poster, ClearingOffer::GLOBAL, asset_id) {
            assert!(g.forward_enabled, "clearing offer does not allow path forward");
            return g;
        }
        panic!("ClearingOffer not found (no specific or global forward for this asset)");
    }

    /// Specific debtor takeout offer, else global (must exist — take is always on).
    pub fn resolve_clearing_take(
        buyer: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
    ) -> ClearingOffer {
        if let Some(p) = ClearingOffer::get(buyer, debtor, asset_id) {
            return p;
        }
        if let Some(g) = ClearingOffer::get(buyer, ClearingOffer::GLOBAL, asset_id) {
            return g;
        }
        panic!("ClearingOffer not found (buyer has no takeout offer for this asset)");
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
        /// `from_asset` into `to_asset`. Returns units created in `to_asset`.
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
            emit_pair_activity(
                creditor,
                self.debtor,
                self.from_asset,
                "convert",
                Quantity::new(take),
                to_qty,
                self.to_asset,
            );
            to_qty
        }
    }

    /// A directed claim: `debtor` owes `creditor` principal + accrued interest
    /// of `asset_id`. Total owed = `remaining_principal + accrued_interest`.
    ///
    /// # Layering
    ///
    /// - **Obligation** owns claim state: create/merge by rate, grow principal
    ///   ([`Self::credit`]), interest ([`Self::accrue`]), and pair exposure.
    /// - **CreditLine** gates *draws* (limit / deplete / line rate) then calls
    ///   into obligation credit — used by every `path_pay` leg.
    /// - **ClearingOffer** (poster-owned) gates same-asset path hops after the
    ///   first when `forward_enabled`, and enables claim takeout while the row
    ///   exists (fixed + percent fee; no FX).
    /// - **CurrencyPolicy** (debtor-posted) re-denominates existing debt and is
    ///   applied automatically in `path_pay` on currency changes.
    /// - **deposit** credits an obligation with no line check (receiver books a
    ///   liability to the depositor).
    ///
    /// # Interest
    ///
    /// See [`interest`]: simple APR in ppm/year on principal only, with a
    /// carried `interest_remainder` so frequent accruals match a single long
    /// accrual. Accrue **before** any principal change and before exposure
    /// checks that must include up-to-date interest.
    ///
    /// # Deposit
    ///
    /// A **deposit** is how external value (cash, goods, off-chain transfer)
    /// enters the graph: the **receiver** books a liability to the
    /// **depositor**, same as a bank taking $5 and crediting your account.
    /// On-chain that is an obligation with `creditor = depositor` and
    /// `debtor = receiver` (the account that called `deposit`). There is still
    /// no local balance row — the depositor's "credit" *is* this obligation.
    ///
    /// # Repayment (deposit, which auto-nets)
    ///
    /// There is no Banx cash balance and no separate "repay with money" ledger
    /// entry. **Repayment is a deposit** that books a counter-obligation and
    /// immediately **nets** against existing claims for the pair/asset.
    ///
    /// ## Physical / off-chain cash (or any external transfer)
    ///
    /// Example: Alice already owes Bob 100 (obligation O1: Bob creditor, Alice
    /// debtor). Alice hands Bob $100 cash off-chain.
    ///
    /// Bob calls `deposit(depositor = Alice, …)`: books O2 (Alice creditor, Bob
    /// debtor) then **auto-nets** against O1. Equal amounts cancel; a remainder
    /// stays as a single direction of net debt.
    ///
    /// Cash never becomes a local balance: it becomes a deposit claim that is
    /// immediately netted against opposite exposure when possible.
    ///
    /// ## On-graph repayment
    ///
    /// If the payer already has (or draws) a claim the other way — or obtains
    /// one via routing — that obligation is likewise **netted**, not "spent as
    /// balance." Every [`CreditLine::debit`] (including each `path_pay` hop)
    /// auto-calls [`Obligation::net_pair`] after crediting. Netting is the only
    /// settlement primitive inside Banx.
    ///
    /// # Netting
    ///
    /// [`Obligation::net_pair`] cancels equal value both ways after accruing.
    /// Reduction is fixed protocol policy: **accrued interest first, then
    /// principal**; across obligations, **highest `interest_rate` first**
    /// (then older `created_at`, then lower `id` for ties).
    #[table(name = "ObligationTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Obligation {
        #[primary_key]
        pub id: u32,

        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        pub remaining_principal: Quantity,
        pub accrued_interest: Quantity,
        /// Simple APR in ppm per year (`10_000` = 1%). See [`interest`].
        pub interest_rate: u32,

        /// Fractional interest not yet large enough for one unit; see [`interest`].
        pub interest_remainder: u64,

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

        /// Total exposure creditor←debtor for asset: Σ(principal + accrued interest).
        /// Does **not** accrue; call [`accrue_pair`] first when freshness matters.
        pub fn exposure(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Quantity {
            Self::obligations(creditor, debtor, asset_id)
                .into_iter()
                .fold(Quantity::new(0), |acc, o| {
                    acc + o.remaining_principal + o.accrued_interest
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

        fn now() -> TimePointSec {
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
                interest_remainder: 0,
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

        /// Accrue simple interest from `last_interest_accrual` to now.
        ///
        /// Path-independent for fixed principal/rate (see [`interest`]). No-op
        /// if `now <= last_interest_accrual`. Persists when anything changes
        /// (including advancing the timestamp with zero interest).
        pub fn accrue(&mut self) {
            let now = Self::now();
            let last = self.last_interest_accrual.seconds;
            if now.seconds <= last {
                return;
            }
            let dt = (now.seconds - last) as u64;

            if self.remaining_principal.value == 0 || self.interest_rate == 0 {
                // No charge while principal or rate is zero; do not "owe" for
                // idle time after principal returns — just move the watermark.
                self.last_interest_accrual = now;
                self.save();
                return;
            }

            let (delta, new_rem) = interest::accrue_delta(
                self.remaining_principal.value,
                self.interest_rate,
                dt,
                self.interest_remainder,
            );

            if delta > 0 {
                self.accrued_interest = self
                    .accrued_interest
                    .value
                    .checked_add(delta)
                    .expect("accrued interest overflow")
                    .into();
            }
            self.interest_remainder = new_rem;
            self.last_interest_accrual = now;
            self.save();
        }

        /// Accrue every obligation on this directed pair/asset.
        pub fn accrue_pair(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
            for mut pair in Self::obligations(creditor, debtor, asset_id) {
                pair.accrue();
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
            let mut obs = Self::obligations(creditor, debtor, asset_id);
            if obs.is_empty() {
                return;
            }

            Self::sort_for_net(&mut obs);
            Self::apply_reduction_waterfall(&mut obs, amount);

            for o in &obs {
                o.persist_or_delete();
            }
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
                if o.remaining_principal.value == 0 {
                    o.interest_remainder = 0;
                }
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
                    if o.remaining_principal.value == 0 {
                        o.interest_remainder = 0;
                    }
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
            self.accrue();
            self.remaining_principal = self
                .remaining_principal
                .value
                .checked_add(amount.value)
                .expect("obligation principal overflow")
                .into();
            self.save();
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

    /// Bilateral credit facility: `creditor` is willing to be owed by `debtor`
    /// up to `limit` of `asset_id`, at `interest_rate` on new draws.
    ///
    /// # Limit semantics (revolving exposure cap)
    ///
    /// `limit` is a cap on **total outstanding exposure**, not a lifetime draw
    /// budget and not a spendable balance. Same idea as a revolving credit card:
    /// the debtor may draw, repay, and draw again so long as exposure stays
    /// at or under `limit`.
    ///
    /// **Exposure** for this (creditor, debtor, asset_id) is
    /// [`Obligation::exposure`] (principal + accrued interest on all related
    /// obligations). Accrued interest **counts against the limit**. A draw of
    /// `amount` is allowed only when:
    /// `exposure + amount <= limit`.
    ///
    /// When `deplete_on_debit` is false (normal revolving facility), settlement
    /// frees capacity under the same `limit` without the creditor resetting it.
    /// Settlement is **deposit + net** (see [`Obligation`]): after mutual
    /// claims cancel, exposure drops and revolving room reopens.
    /// When `deplete_on_debit` is true, each draw also reduces `limit` itself
    /// (one-shot / grant-style capacity); that is an additional constraint on
    /// top of the exposure cap.
    ///
    /// # Draw path
    ///
    /// [`CreditLine::debit`] enforces capacity and line terms, then
    /// [`Obligation::credit_pair`] grows the claim (merge by same interest rate).
    /// Used by every `path_pay` leg (first leg direct; later legs after routing).
    #[table(name = "CreditLineTable", index = 3)]
    #[derive(
        Default, Clone, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        /// Max total outstanding exposure (principal + accrued interest across
        /// all obligations for this pair and asset). See struct docs.
        pub limit: Quantity,
        /// If true, also shrink `limit` by each draw (non-revolving grant).
        /// If false, `limit` stays fixed and only outstanding exposure binds.
        pub deplete_on_debit: bool,
        /// Rate applied to new draws on this line (ppm APR); see [`interest`].
        pub interest_rate: u32,
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
            }
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
        ) {
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

        /// Draw `amount` of new principal on this line (debtor owes creditor more).
        ///
        /// Loads the line, applies the draw, and persists any limit change.
        /// Callers should use this associated function rather than mutating a
        /// temporary from [`get_assert`].
        ///
        /// 1. Enforce revolving exposure cap (interest included).
        /// 2. Optionally deplete `limit` and save.
        /// 3. Credit the obligation bucket at this line's `interest_rate`.
        /// 4. **Auto-net** the pair for this asset
        ///    ([`Obligation::net_pair`] with unlimited max) so mutual claims
        ///    cancel immediately — high-frequency path corridors stay bilaterally
        ///    compressed without a separate `net` action.
        ///
        /// Used by `path_pay` legs (after any routing checks on multi-hop).
        pub fn debit(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            amount: Quantity,
        ) {
            let mut line = Self::get_assert(creditor, debtor, asset_id);

            // Fresh interest against the revolving cap before measuring exposure.
            Obligation::accrue_pair(line.creditor, line.debtor, line.asset_id);
            let exposure = Obligation::exposure(line.creditor, line.debtor, line.asset_id);
            if exposure + amount > line.limit {
                panic!("total outstanding exceeds max limit");
            }

            if line.deplete_on_debit {
                line.limit = line
                    .limit
                    .value
                    .checked_sub(amount.value)
                    .expect("insufficient credit line limit")
                    .into();
                line.save();
            }

            Obligation::credit_pair(
                line.creditor,
                line.debtor,
                line.asset_id,
                line.interest_rate,
                amount,
            );
            // Cancel mutual exposure for this pair/asset (no-op if reverse is 0).
            let netted = Obligation::net_pair(
                line.creditor,
                line.debtor,
                line.asset_id,
                u64::MAX.into(),
            );
            emit_pair_activity(
                line.creditor,
                line.debtor,
                line.asset_id,
                "path_draw",
                amount,
                netted,
                line.asset_id,
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
    ) {
        let actor = psibase::get_sender();
        let amount_s = amount.value.to_string();
        let netted_s = netted.value.to_string();
        let kind_s = kind.to_string();
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
            );
        }
    }
}

#[psibase::service(name = "banx", tables = "tables")]
pub mod service {
    use crate::tables::{
        emit_pair_activity, resolve_clearing_forward, resolve_clearing_take, Asset, ClearingOffer,
        CreditLine, CurrencyPolicy, InitRow, InitTable, Obligation, PathHop,
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
    ) {
        let creditor = get_sender();
        CreditLine::upsert_credit_line(
            creditor,
            debitor,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate,
        );
        emit_pair_activity(
            creditor,
            debitor,
            asset_id,
            "credit_line",
            amount,
            Quantity::new(0),
            asset_id,
        );
    }

    /// Post/update a **specific** clearing offer (`counterparty` ≠ 0).
    ///
    /// Path: next hop = `counterparty` when `forward_enabled`.
    /// Takeout: buy claims on that debtor while the row exists.
    /// Fees: Stripe-style `out = in * (1 - fee_percent) - fee_fixed`.
    #[action]
    fn st_clr_ofr(
        counterparty: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        max_line_apr: u32,
        forward_enabled: bool,
        expires_at: TimePointSec,
    ) {
        assert!(
            counterparty != ClearingOffer::GLOBAL,
            "use st_glb_clr for global clearing offer (counterparty 0)"
        );
        ClearingOffer::upsert(
            get_sender(),
            counterparty,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            forward_enabled,
            expires_at,
        );
    }

    /// Post/update a **global** clearing offer (`counterparty = 0`).
    #[action]
    fn st_glb_clr(
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        max_line_apr: u32,
        forward_enabled: bool,
        expires_at: TimePointSec,
    ) {
        ClearingOffer::upsert(
            get_sender(),
            ClearingOffer::GLOBAL,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            forward_enabled,
            expires_at,
        );
    }

    /// Remove a **specific** clearing offer.
    #[action]
    fn rm_clr_ofr(counterparty: AccountNumber, asset_id: u16) {
        assert!(
            counterparty != ClearingOffer::GLOBAL,
            "use rm_glb_clr for global clearing offer"
        );
        ClearingOffer::remove(get_sender(), counterparty, asset_id);
    }

    /// Remove a **global** clearing offer.
    #[action]
    fn rm_glb_clr(asset_id: u16) {
        ClearingOffer::remove(get_sender(), ClearingOffer::GLOBAL, asset_id);
    }

    /// Seller (sender) sells claims on `debtor` to `buyer` under buyer's clearing
    /// offer. Buyer becomes creditor of `debtor` for `amount`; seller receives
    /// a claim on buyer for face after fees. Requires buyer's line residual to
    /// `debtor` and a live clearing offer (specific or global).
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

        let offer = resolve_clearing_take(buyer, debtor, asset_id);
        crate::tables::assert_policy_live(offer.expires_at);

        let line = CreditLine::get_assert(buyer, debtor, asset_id);
        Obligation::accrue_pair(buyer, debtor, asset_id);
        let buyer_exp = Obligation::exposure(buyer, debtor, asset_id).value;
        assert!(
            buyer_exp.saturating_add(amount.value) <= line.limit.value,
            "buyer credit line residual insufficient for claim takeout"
        );

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
    /// `to_asset` for that pair; requires output ≥ `min_to`.
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

        // Debtor owns the policy; resolve who is debtor vs creditor on this claim.
        let (creditor, debtor) = if CurrencyPolicy::get(sender, from_asset, to_asset).is_some() {
            // Sender posted the policy → sender is debtor; counterparty is creditor.
            (counterparty, sender)
        } else if CurrencyPolicy::get(counterparty, from_asset, to_asset).is_some() {
            // Counterparty is debtor; sender is creditor holding the claim.
            (sender, counterparty)
        } else {
            panic!("CurrencyPolicy not found for debtor/assets");
        };

        let policy = CurrencyPolicy::get_assert(debtor, from_asset, to_asset);
        policy.convert(creditor, amount_from, min_to);
    }

    /// Book a **deposit**: sender receives value and credits `depositor`, then
    /// **auto-nets** mutual obligations for this asset.
    #[action]
    fn deposit(depositor: AccountNumber, asset_id: u16, amount: Quantity, interest_rate: u32) {
        let receiver = get_sender();
        let netted = Obligation::deposit(depositor, receiver, asset_id, amount, interest_rate);
        emit_pair_activity(
            depositor,
            receiver,
            asset_id,
            "deposit",
            amount,
            netted,
            asset_id,
        );
    }

    /// Accrue interest on all obligations for a directed pair/asset.
    #[action]
    fn accrue(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
        Obligation::accrue_pair(creditor, debtor, asset_id);
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
            );
        }
    }

    /// Path payment along `hops`: each hop is `(account, asset_id)`.
    ///
    /// # Example
    ///
    /// `path_pay([(Gary, AUD), (Steve, USD)], amount_aud, min_return_usd)`:
    /// 1. **First hop** — sender draws `amount` on Gary in **AUD** (line only).
    /// 2. **Currency change** — rebook previous edge (sender owes Gary AUD) via
    ///    sender's [`CurrencyPolicy`] AUD→USD.
    /// 3. **Later hops** — intermediate's [`ClearingOffer`] with
    ///    `forward_enabled` (fee + max line APR); draw on next line.
    /// 4. **`min_return`** — final hop principal (in **last** asset) ≥ this.
    ///
    /// Atomic: all legs succeed or none stick.
    ///
    /// Each draw **auto-nets** that pair/asset (via [`CreditLine::debit`]).
    #[action]
    fn path_pay(hops: Vec<PathHop>, amount: Quantity, min_return: Quantity) {
        assert!(!hops.is_empty(), "path_pay must include at least one hop");
        assert!(amount.value > 0, "path_pay amount must be positive");

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
                CreditLine::debit(next_creditor, path_debtor, asset_id, forward);
                prev_edge_debtor = path_debtor;
                prev_edge_creditor = next_creditor;
                prev_asset = asset_id;
                path_debtor = next_creditor;
                continue;
            }

            // Currency change ⇒ convert previous edge (debtor-owned FX quote).
            if asset_id != prev_asset {
                let cpol =
                    CurrencyPolicy::get_assert(prev_edge_debtor, prev_asset, asset_id);
                forward = cpol.convert(prev_edge_creditor, forward, Quantity::new(0));
            }

            // Same-asset forward hop: specific clearing offer, else global.
            let offer = resolve_clearing_forward(next_creditor, path_debtor, asset_id);
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
    }

    /// Bilateral activity history (emitted once per party as `account`).
    ///
    /// - `kind`: `path_draw` | `deposit` | `net` | `convert` | `credit_line`
    /// - `amount`: primary quantity (raw units)
    /// - `netted`: amount cancelled by auto-net (or convert output for `convert`)
    /// - `other_asset_id`: convert destination asset; otherwise same as `asset_id`
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
