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
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    /// Opt-in that the (creditor, debtor, asset) edge may be used in a multi-hop
    /// path. Same party orientation as [`CreditLine`]: debtor draws on creditor.
    ///
    /// Hop requires this policy, draws the current path amount on the line via
    /// [`CreditLine::debit`], then (if more hops remain) reduces the amount
    /// forwarded by this edge's fee — the intermediate keeps the spread.
    ///
    /// # Fee (skim, not inflate)
    ///
    /// Intermediate fee is **additive**:
    /// `fee = hop_fee_fixed + amount * hop_fee_percent / 1_000_000`
    /// (either field may be zero).
    ///
    /// - `hop_fee_fixed` — absolute quantity in this `asset_id`
    /// - `hop_fee_percent` — **ppm** (`10_000` = 1%, `500_000` = 50%)
    ///
    /// Example: Alice sends 500 to Charlie via Bob; Bob's policy is fixed `5` +
    /// `20_000` ppm (2%):
    /// - fee = 5 + 500×2% = 15
    /// - Alice draws **500** on Bob (Bob creditor, Alice debtor)
    /// - Bob forwards **485** to Charlie (Charlie creditor, Bob debtor)
    /// - Bob keeps **15** net
    ///
    /// Fee is taken by **reducing what is forwarded**, not by increasing what
    /// the prior debtor draws. Applied only when this creditor is an
    /// intermediate (more hops after them). The final payee receives the
    /// residual after all intermediate skims. Direct `debit` ignores this.
    #[table(name = "RoutingPolicyTab", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RoutingPolicy {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,

        /// Flat routing fee in asset units (0 = none). Added to the ppm fee.
        pub hop_fee_fixed: Quantity,
        /// Proportional routing fee in ppm (`500_000` = 50%). Added to fixed.
        pub hop_fee_percent: u32,
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

        /// Creditor opts this edge into routing. Requires an existing credit line.
        pub fn upsert(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            hop_fee_fixed: Quantity,
            hop_fee_percent: u32,
        ) {
            assert!(
                hop_fee_percent <= 1_000_000,
                "hop_fee_percent exceeds 100% (1_000_000 ppm)"
            );
            // Edge must already be a funded facility.
            let _ = CreditLine::get_assert(creditor, debtor, asset_id);
            Self {
                creditor,
                debtor,
                asset_id,
                hop_fee_fixed,
                hop_fee_percent,
            }
            .save();
        }

        /// Amount kept as this intermediate's fee on `amount` received:
        /// `fixed + amount * ppm / 1_000_000`.
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
            self.hop_fee_fixed
                + Quantity::new(pct)
        }

        /// Amount to forward after this intermediate skims fixed + percent fees.
        pub fn amount_after_fee(&self, amount: Quantity) -> Quantity {
            let fee = self.fee_on(amount);
            assert!(
                fee < amount,
                "hop fee consumes entire amount; nothing left to forward"
            );
            amount - fee
        }

        /// Draw `amount` on this routed edge (full amount; fee is applied by
        /// [`service::hop`] when reducing the forward amount for later hops).
        pub fn debit(&self, amount: Quantity) {
            CreditLine::debit(self.creditor, self.debtor, self.asset_id, amount);
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
    ///   into obligation credit — used by both `debit` and `hop`.
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
    /// # Repayment (deposit + net)
    ///
    /// There is no Banx cash balance and no separate "repay with money" ledger
    /// entry. **Repayment is a deposit (counter-obligation) then netting**
    /// against existing claims between the same pair (and asset).
    ///
    /// ## Physical / off-chain cash (or any external transfer)
    ///
    /// Example: Alice already owes Bob 100 (obligation O1: Bob creditor, Alice
    /// debtor). Alice hands Bob $100 cash off-chain.
    ///
    /// 1. **Bob books a deposit** for Alice: `deposit(depositor = Alice, …)`
    ///    creates O2 — Alice creditor, Bob debtor for 100 (Bob's liability to
    ///    Alice, like a bank credit in Alice's favour).
    /// 2. **Net** O2 against O1 (and any other mutual obligations in that
    ///    pair/asset). Equal amounts cancel; a remainder stays as a single
    ///    direction of net debt.
    ///
    /// Cash never becomes a local balance: it becomes a **deposit obligation**
    /// booked by the receiver, then netted against what was owed. Same pattern
    /// for any external value.
    ///
    /// ## On-graph repayment
    ///
    /// If the payer already has (or draws) a claim the other way — or obtains
    /// one via routing — that obligation is likewise **netted**, not "spent as
    /// balance." Netting is the only settlement primitive inside Banx.
    ///
    /// Implementation of net (waterfall across rates/interest vs principal,
    /// partial nets, who may trigger net) is separate; this type is the
    /// claim being created and reduced.
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
                id: 1,
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

        /// Book a deposit: `receiver` owes `depositor` (bank-liability style).
        pub fn deposit(
            depositor: AccountNumber,
            receiver: AccountNumber,
            asset_id: u32,
            amount: Quantity,
            interest_rate: u32,
        ) {
            Self::credit_pair(depositor, receiver, asset_id, interest_rate, amount);
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
    /// # Draw path (shared by `debit` and `hop`)
    ///
    /// [`CreditLine::debit`] only enforces capacity and line terms, then
    /// [`Obligation::credit_pair`] grows the claim. Direct `debit` and multi-hop
    /// `hop` both end here so path payments cannot bypass the revolving cap.
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
        /// Used by the `debit` action and by each edge of `hop` (via
        /// [`RoutingPolicy::debit`]).
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
            table.put(&InitRow {}).unwrap();
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

    /// Opt this credit edge into multi-hop routing. Sender is **creditor**;
    /// `debitor` may draw on sender's line as a hop step.
    ///
    /// Intermediate skim when forwarding: `fee = hop_fee_fixed + amount *
    /// hop_fee_percent / 1e6` (either may be zero; ppm: `500_000` = 50%).
    /// Requires an existing credit line.
    #[action]
    fn st_rte_pol(
        debitor: AccountNumber,
        asset_id: u32,
        hop_fee_fixed: Quantity,
        hop_fee_percent: u32,
    ) {
        RoutingPolicy::upsert(
            get_sender(),
            debitor,
            asset_id,
            hop_fee_fixed,
            hop_fee_percent,
        );
    }

    /// Book a **deposit**: sender receives value and credits `depositor`.
    ///
    /// Like a bank taking cash: sender becomes **debtor**, `depositor` becomes
    /// **creditor** for `amount` (an [`Obligation`], not a local balance).
    /// Typical cash repay path: old creditor calls `deposit` for the payer,
    /// then **net** against the prior debt (see [`Obligation`]).
    ///
    /// Not a credit-line draw — that is [`debit`].
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

    /// Draw on a credit line: sender is **debtor**, grows obligation to `creditor`.
    ///
    /// No routing policy or hop fee. For multi-hop path payments use [`hop`].
    /// To repay: counterparty **deposits** then **net** (see [`Obligation`]).
    #[action]
    fn debit(creditor: AccountNumber, asset_id: u32, amount: Quantity) {
        CreditLine::debit(creditor, get_sender(), asset_id, amount);
    }

    /// Multi-hop path payment: sender pays `amount` of `asset_id` along
    /// `creditors`.
    ///
    /// # Path
    ///
    /// `sender → c0 → c1 → … → cN`. At each step the current party is
    /// **debtor** and draws the **current forward amount** on the next
    /// **creditor**'s line (requires [`RoutingPolicy`] + [`CreditLine`]).
    ///
    /// After each intermediate hop, that creditor's fees **skim** the forward
    /// amount (`fixed + ppm`; see [`RoutingPolicy`]): they keep a larger claim
    /// on the prior debtor than the liability they take to the next creditor.
    /// The final payee gets the residual after all intermediate fees.
    ///
    /// # Example
    ///
    /// Alice `hop([bob, charlie], asset, 500)` with Bob fixed `5` + `20_000` ppm:
    /// - Alice owes Bob **500**
    /// - Bob owes Charlie **485** (fee 5 + 10)
    /// - Bob keeps **15** net
    #[action]
    fn hop(creditors: Vec<AccountNumber>, asset_id: u32, amount: Quantity) {
        assert!(!creditors.is_empty(), "hop path must include at least one creditor");
        assert!(amount.value > 0, "hop amount must be positive");

        let mut debtor = get_sender();
        let mut forward = amount;
        let last = creditors.len() - 1;

        for (i, creditor) in creditors.into_iter().enumerate() {
            assert!(creditor != debtor, "hop path cannot draw on self");

            let policy = RoutingPolicy::get_assert(creditor, debtor, asset_id);
            // Full forward amount lands as claim on this edge.
            policy.debit(forward);

            // Intermediates skim before the next hop; final payee gets residual.
            if i < last {
                forward = policy.amount_after_fee(forward);
                assert!(forward.value > 0, "nothing left to forward after hop fee");
            }

            debtor = creditor;
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        table.get_index_pk().get(&()).expect("service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn getString() -> String {
        "".to_string()
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
