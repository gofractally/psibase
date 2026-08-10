#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        services::tokens::Quantity, AccountNumber, Fracpack, ServiceWrapper, Table, TimePointSec,
        ToSchema,
    };
    use serde::{Deserialize, Serialize};

    /// Interest math: simple APR on principal, path-independent under subdivision.
    ///
    /// # Rate
    ///
    /// `interest_rate` is **ppm per year** (parts per million): `10_000` = 1% APR,
    /// `1_000_000` = 100% APR. Year length is fixed at [`SECONDS_PER_YEAR`] (365
    /// days) so results do not depend on leap years or wall-clock calendars.
    ///
    /// # Accrual (simple, not compounded into principal)
    ///
    /// Interest accrues on `remaining_principal` only; `accrued_interest` is a
    /// separate bucket. Between principal changes:
    ///
    /// ```text
    /// product   = principal * rate_ppm * dt_seconds + remainder
    /// interest  = product / (1_000_000 * SECONDS_PER_YEAR)
    /// remainder = product % (1_000_000 * SECONDS_PER_YEAR)
    /// ```
    ///
    /// Carrying `remainder` makes accrual **path-independent**: any sequence of
    /// accruals over an interval with fixed principal and rate yields the same
    /// total interest and final remainder as one accrual over the whole
    /// interval. Calling accrue twice in the same second is a no-op.
    pub mod interest {
        /// 365 * 24 * 60 * 60 — fixed, no leap seconds / leap years.
        pub const SECONDS_PER_YEAR: u128 = 31_536_000;
        pub const RATE_PPM_DENOM: u128 = 1_000_000;
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
    }

    /// Outbound path routing: **debtor-owned** opt-in to draw on `creditor` in a
    /// `path_pay` (after the first leg).
    ///
    /// # Roles (Alice → Gary → Steve)
    ///
    /// 1. **Gary** extends a **credit line** to Alice (Gary creditor, Alice debtor).
    /// 2. **Steve** extends a **credit line** to Gary (Steve creditor, Gary debtor)
    ///    — capacity for Gary to owe Steve.
    /// 3. **Gary** sets this **routing policy** with Steve (`creditor=Steve`,
    ///    `debtor=Gary`): fee + max rate he will accept if a path forces him to
    ///    draw on Steve.
    ///
    /// Alice `path_pay([Gary, Steve], 5)`:
    /// - Alice draws **5** on Gary's line → Alice owes Gary 5 (line only; no
    ///   routing policy on this first leg).
    /// - Gary's policy with Steve applies: if Steve's line rate ≤
    ///   `max_accept_rate`, open **Gary owes Steve** for `5 - fee` (e.g. 4.90).
    /// - Gary keeps the fee as spread (long Alice 5, short Steve 4.90).
    ///
    /// Without Gary's routing policy toward Steve, the second leg **fails** even
    /// if Steve has a huge line to Gary. Direct [`CreditLine::debit`] never uses
    /// this table.
    ///
    /// # Fee (skim into smaller next-leg draw)
    ///
    /// `fee = hop_fee_fixed + amount * hop_fee_percent / 1_000_000` (ppm).
    /// Next obligation size is `amount - fee`, not `amount + fee`.
    #[table(name = "RoutingPolicyTab", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RoutingPolicy {
        /// Next hop: who the debtor may path-draw on (must have extended a line).
        pub creditor: AccountNumber,
        /// Policy owner: intermediate who may be forced to draw on `creditor`.
        pub debtor: AccountNumber,
        pub asset_id: u32,

        /// Flat fee in asset units when path-drawing on `creditor` (0 = none).
        pub hop_fee_fixed: Quantity,
        /// Proportional fee in ppm (`20_000` = 2%). Added to fixed.
        pub hop_fee_percent: u32,
        /// Max `CreditLine.interest_rate` (ppm APR) this debtor accepts on a
        /// path draw to `creditor`. Higher → path_pay fails.
        pub max_accept_rate: u32,
    }

    impl RoutingPolicy {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debtor, self.asset_id)
        }

        fn save(&self) {
            RoutingPolicyTab::read_write().put(self).unwrap();
        }

        fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Option<Self> {
            RoutingPolicyTab::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Self {
            Self::get(creditor, debtor, asset_id).expect("RoutingPolicy not found")
        }

        /// Debtor opts into path-drawing on `creditor`. Requires creditor's line
        /// to this debtor already exists.
        pub fn upsert(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            hop_fee_fixed: Quantity,
            hop_fee_percent: u32,
            max_accept_rate: u32,
        ) {
            assert!(
                hop_fee_percent < 1_000_000,
                "hop_fee_percent must be < 100% so a positive amount can be forwarded"
            );
            assert!(
                max_accept_rate <= 1_000_000,
                "max_accept_rate exceeds 100% (1_000_000 ppm)"
            );
            let _ = CreditLine::get_assert(creditor, debtor, asset_id);
            Self {
                creditor,
                debtor,
                asset_id,
                hop_fee_fixed,
                hop_fee_percent,
                max_accept_rate,
            }
            .save();
        }

        /// Fee skimmed by the intermediate: `fixed + amount * ppm / 1e6`.
        fn fee_on(&self, amount: Quantity) -> Quantity {
            let pct = if self.hop_fee_percent == 0 || amount.value == 0 {
                0u64
            } else {
                amount
                    .value
                    .checked_mul(self.hop_fee_percent as u64)
                    .expect("hop fee percent overflow")
                    / 1_000_000
            };
            self.hop_fee_fixed + Quantity::new(pct)
        }

        /// Next-leg principal after this intermediate's fee.
        pub fn amount_after_fee(&self, amount: Quantity) -> Quantity {
            let fee = self.fee_on(amount);
            assert!(
                fee < amount,
                "routing fee consumes entire amount; nothing left for next hop"
            );
            amount - fee
        }

        /// Path draw on `creditor` by `debtor`: rate cap, then draw `amount_in`
        /// minus fee. Returns the principal drawn on the next hop.
        ///
        /// Creates/grows obligation at the **line's** rate (merge same rate).
        pub fn path_draw(&self, amount_in: Quantity) -> Quantity {
            let line_rate = CreditLine::get_assert(self.creditor, self.debtor, self.asset_id)
                .interest_rate;
            assert!(
                line_rate <= self.max_accept_rate,
                "next hop interest rate exceeds routing max_accept_rate"
            );
            let draw = self.amount_after_fee(amount_in);
            assert!(draw.value > 0, "nothing left to draw after routing fee");
            CreditLine::debit(self.creditor, self.debtor, self.asset_id, draw);
            draw
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
    /// - **RoutingPolicy** (debtor-owned) gates **path hops after the first**:
    ///   fee + max accept rate when the intermediate path-draws on the next
    ///   creditor (see [`RoutingPolicy`]).
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
    /// balance." Netting is the only settlement primitive inside Banx.
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
        pub asset_id: u32,

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
        fn by_set(&self) -> (AccountNumber, AccountNumber, u32, u32) {
            (self.creditor, self.debtor, self.asset_id, self.id)
        }

        pub fn get(id: u32) -> Option<Self> {
            ObligationTable::read().get_index_pk().get(&(id))
        }

        pub fn get_assert(id: u32) -> Self {
            Self::get(id).expect("obligation does not exist")
        }

        fn for_pair(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Vec<Self> {
            ObligationTable::read()
                .get_index_by_set()
                .range((creditor, debtor, asset_id, 0)..(creditor, debtor, asset_id, u32::MAX))
                .collect()
        }

        /// Total exposure creditor←debtor for asset: Σ(principal + accrued interest).
        /// Does **not** accrue; call [`accrue_pair`] first when freshness matters.
        pub fn exposure(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
        ) -> Quantity {
            Self::for_pair(creditor, debtor, asset_id)
                .into_iter()
                .fold(Quantity::new(0), |acc, o| {
                    acc + o.remaining_principal + o.accrued_interest
                })
        }

        pub fn get_by_interest_rate(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            interest_rate: u32,
        ) -> Option<Self> {
            Self::for_pair(creditor, debtor, asset_id)
                .into_iter()
                .find(|obligation| obligation.interest_rate == interest_rate)
        }

        pub fn get_existing_or_new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
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
            asset_id: u32,
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
        pub fn accrue_pair(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) {
            for mut o in Self::for_pair(creditor, debtor, asset_id) {
                o.accrue();
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
            asset_id: u32,
            amount: u64,
        ) {
            if amount == 0 {
                return;
            }
            let mut obs = Self::for_pair(creditor, debtor, asset_id);
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
            asset_id: u32,
            max_amount: Quantity,
        ) -> Quantity {
            assert!(a != b, "cannot net with self");

            Self::accrue_pair(a, b, asset_id);
            Self::accrue_pair(b, a, asset_id);

            // exposure(creditor, debtor) = what debtor owes creditor.
            let a_owed_by_b = Self::exposure(a, b, asset_id).value; // b owes a
            let b_owed_by_a = Self::exposure(b, a, asset_id).value; // a owes b
            let cancel = a_owed_by_b
                .min(b_owed_by_a)
                .min(max_amount.value);
            if cancel == 0 {
                return Quantity::new(0);
            }

            Self::apply_reduction(a, b, asset_id, cancel);
            Self::apply_reduction(b, a, asset_id, cancel);
            Quantity::new(cancel)
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
            asset_id: u32,
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
        pub fn deposit(
            depositor: AccountNumber,
            receiver: AccountNumber,
            asset_id: u32,
            amount: Quantity,
            interest_rate: u32,
        ) {
            Self::credit_pair(depositor, receiver, asset_id, interest_rate, amount);
            Self::net_pair(depositor, receiver, asset_id, Quantity::new(u64::MAX));
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
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,

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
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debtor, self.asset_id)
        }

        fn save(&self) {
            CreditLineTable::read_write().put(&self).unwrap();
        }

        fn new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
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

        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Option<Self> {
            CreditLineTable::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Self {
            Self::get(creditor, debtor, asset_id).expect("credit line not found")
        }

        pub fn upsert_credit_line(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
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
        ///
        /// Used by `path_pay` legs (after any routing checks on multi-hop).
        pub fn debit(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
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
        }
    }
}

#[psibase::service(name = "banx", tables = "tables")]
pub mod service {
    use crate::tables::{CreditLine, InitRow, InitTable, Obligation, RoutingPolicy};
    use psibase::{services::tokens::Quantity, AccountNumber, *};

    #[action]
    fn init() {
        let table = InitTable::new();
        if InitTable::read().get_index_pk().get(&()).is_none() {
            table
                .put(&InitRow {
                    next_obligation_id: 1,
                })
                .unwrap();
        }
    }

    /// Set a credit line for the sender as creditor, offering capacity to `debitor`.
    ///
    /// `amount` is the exposure `limit`: max outstanding principal + accrued
    /// interest (revolving cap), not a deposited balance. See [`CreditLine`].
    #[action]
    fn st_crd_lne(
        debitor: AccountNumber,
        asset_id: u32,
        amount: Quantity,
        deplete_on_debit: bool,
        interest_rate: u32,
    ) {
        CreditLine::upsert_credit_line(
            get_sender(),
            debitor,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate,
        );
    }

    /// Sender (path intermediate) opts into **path-drawing on `creditor`**.
    ///
    /// Requires `creditor` already extended a credit line to sender. Sets fee
    /// (`hop_fee_fixed` + `hop_fee_percent` ppm) and `max_accept_rate` (ppm APR
    /// cap on that line when used in `path_pay`). See [`RoutingPolicy`].
    #[action]
    fn st_rte_pol(
        creditor: AccountNumber,
        asset_id: u32,
        hop_fee_fixed: Quantity,
        hop_fee_percent: u32,
        max_accept_rate: u32,
    ) {
        RoutingPolicy::upsert(
            creditor,
            get_sender(),
            asset_id,
            hop_fee_fixed,
            hop_fee_percent,
            max_accept_rate,
        );
    }

    /// Book a **deposit**: sender receives value and credits `depositor`, then
    /// **auto-nets** mutual obligations for this asset.
    ///
    /// Like a bank taking cash: sender books a liability to `depositor`, then
    /// cancels against anything the depositor already owed sender (and any
    /// pre-existing reverse claim). Remainder is one-way net debt.
    ///
    /// Not a path draw — that is [`path_pay`]. Explicit [`net`] remains for
    /// settling without a new deposit.
    #[action]
    fn deposit(depositor: AccountNumber, asset_id: u32, amount: Quantity, interest_rate: u32) {
        Obligation::deposit(depositor, get_sender(), asset_id, amount, interest_rate);
    }

    /// Accrue interest on all obligations for a directed pair/asset.
    /// Permissionless: only advances time-based interest (see [`tables::interest`]).
    #[action]
    fn accrue(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) {
        Obligation::accrue_pair(creditor, debtor, asset_id);
    }

    /// Net mutual obligations between sender and `counterparty` for `asset_id`.
    ///
    /// Accrues both ways, then cancels `min(exposure each way, max_amount)`.
    /// Reduction policy is fixed: **interest then principal**, **highest rate
    /// first**. Either party may call; only reduces claims.
    #[action]
    fn net(counterparty: AccountNumber, asset_id: u32, max_amount: Quantity) {
        Obligation::net_pair(get_sender(), counterparty, asset_id, max_amount);
    }

    /// Path payment: sender pays `amount` of `asset_id` along `creditors`.
    ///
    /// # Alice → Gary → Steve for 5.00
    ///
    /// Setup:
    /// - Gary: credit line to Alice
    /// - Steve: credit line to Gary (capacity for Gary to owe Steve)
    /// - Gary: [`st_rte_pol`] toward Steve (fee + max accept rate)
    ///
    /// `Alice.path_pay([Gary, Steve], 5, min_return)`:
    /// 1. **First leg** — Alice draws **5** on Gary's line only (no routing
    ///    policy). Obligation: Alice owes Gary 5.
    /// 2. **Later legs** — current party is intermediate. Requires **their**
    ///    routing policy with the next creditor. Opens next obligation at
    ///    `amount_in - fee` (e.g. Gary owes Steve **4.90**). Fails if policy
    ///    missing or next line rate &gt; `max_accept_rate`.
    /// 3. **`min_return`** — after all fees, the last creditor must receive at
    ///    least this much principal on their leg (slippage guard if an
    ///    intermediate raises fees between UI quote and execution). Else the
    ///    whole tx fails and no legs stick.
    ///
    /// Single-hop `path_pay([Steve], 5, min_return)` is a direct line draw;
    /// typically `min_return == amount` (or ≤ amount).
    #[action]
    fn path_pay(
        creditors: Vec<AccountNumber>,
        asset_id: u32,
        amount: Quantity,
        min_return: Quantity,
    ) {
        assert!(
            !creditors.is_empty(),
            "path_pay must include at least one creditor"
        );
        assert!(amount.value > 0, "path_pay amount must be positive");
        assert!(
            min_return.value <= amount.value,
            "min_return cannot exceed path amount"
        );

        let mut debtor = get_sender();
        let mut forward = amount;

        for (i, creditor) in creditors.into_iter().enumerate() {
            assert!(creditor != debtor, "path_pay cannot draw on self");

            if i == 0 {
                // Origin draws on first hop: credit line only.
                CreditLine::debit(creditor, debtor, asset_id, forward);
            } else {
                // Intermediate: rate cap + fee once inside path_draw.
                let policy = RoutingPolicy::get_assert(creditor, debtor, asset_id);
                forward = policy.path_draw(forward);
            }

            debtor = creditor;
        }

        // `forward` is what the last creditor was drawn for (after all skims).
        assert!(
            forward.value >= min_return.value,
            "path_pay final amount below min_return"
        );
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        table.get_index_pk().get(&()).expect("service not inited");
    }
}

#[cfg(test)]
mod tests;
