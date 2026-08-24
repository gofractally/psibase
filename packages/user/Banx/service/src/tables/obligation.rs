use psibase::{services::tokens::Quantity, AccountNumber, ServiceWrapper, Table, TimePointSec};

use crate::tables::tables::{InitRow, Obligation, ObligationTable, PairCycle};

impl Obligation {
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
        let total =
            crate::interest::compound_amount(base, self.interest_rate, self.dt_since_epoch(now));
        total
            .checked_sub(self.remaining_principal.value)
            .expect("compound total below principal")
            .into()
    }

    /// Write live interest and start a new epoch. Only for principal/rate
    /// changes — not for a lone accrue, so 5s vs 5y stays identical.
    /// During grace, interest stays 0 and the epoch moves to now so
    /// post-grace compound runs from this principal change, not origination.
    pub fn accrue(&mut self) {
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

    fn save(&self) {
        ObligationTable::read_write().put(&self).unwrap()
    }
}
