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
            // No new compounding. Keep finalized interest already on the row
            // (e.g. transferred from an aged claim).
            return self.accrued_interest;
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

    /// Finalize live interest and start a new epoch.
    ///
    /// No-op during grace. A touch must not move the epoch, or post-grace
    /// compound starts at the touch instead of the last balance change.
    /// Callers that change principal or stored interest slide the epoch
    /// via [`Self::note_grace_change`].
    pub fn accrue(&mut self) {
        let now = Self::now();
        if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
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

    /// This row's balance changed during grace. Later compound runs from now,
    /// so principal added or removed is not back-dated to the old epoch.
    fn note_grace_change(&mut self) {
        let now = Self::now();
        if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now)
            && now.seconds != self.last_interest_accrual.seconds
        {
            self.last_interest_accrual = now;
        }
    }

    fn pair_clear(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> bool {
        Self::obligations(creditor, debtor, asset_id)
            .iter()
            .all(|o| o.is_clear())
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
        let before_clear = Self::pair_clear(creditor, debtor, asset_id);
        let mut obs = Self::obligations(creditor, debtor, asset_id);
        if obs.is_empty() {
            return;
        }

        Self::sort_for_net(&mut obs);
        Self::apply_reduction_waterfall(&mut obs, amount);

        for o in &obs {
            o.persist_or_delete();
        }
        let after_clear = Self::pair_clear(creditor, debtor, asset_id);
        PairCycle::sync_cycle(creditor, debtor, asset_id, before_clear, after_clear);
    }

    /// Interest first (globally, highest-rate order), then principal.
    fn apply_reduction_waterfall(obs: &mut [Self], amount: u64) {
        let mut left = amount;
        for o in obs.iter_mut() {
            if left == 0 {
                break;
            }
            let take = left.min(o.accrued_interest.value);
            if take == 0 {
                continue;
            }
            o.accrued_interest = (o.accrued_interest.value - take).into();
            o.note_grace_change();
            left -= take;
        }
        for o in obs.iter_mut() {
            if left == 0 {
                break;
            }
            let take = left.min(o.remaining_principal.value);
            if take == 0 {
                continue;
            }
            o.remaining_principal = (o.remaining_principal.value - take).into();
            o.note_grace_change();
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
        let dest_occupied = !Self::pair_clear(to_creditor, debtor, asset_id);
        let before_from_clear = Self::pair_clear(from_creditor, debtor, asset_id);
        let available = Self::exposure(from_creditor, debtor, asset_id).value;
        assert!(
            available >= amount,
            "insufficient claim exposure to transfer"
        );

        let mut obs = Self::obligations(from_creditor, debtor, asset_id);
        Self::sort_for_net(&mut obs);
        let mut left = amount;
        let mut dest_delta: Vec<(u32, u64, u64)> = Vec::new();

        for o in obs.iter_mut() {
            if left == 0 {
                break;
            }
            let take_i = left.min(o.accrued_interest.value);
            if take_i > 0 {
                o.accrued_interest = (o.accrued_interest.value - take_i).into();
                o.note_grace_change();
                Self::add_rate_delta(&mut dest_delta, o.interest_rate, take_i, 0);
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
                o.note_grace_change();
                Self::add_rate_delta(&mut dest_delta, o.interest_rate, 0, take_p);
                left -= take_p;
            }
        }
        assert!(left == 0, "transfer claims underflow");
        for &(rate, interest, principal) in &dest_delta {
            Self::apply_claim_delta(to_creditor, debtor, asset_id, rate, interest, principal);
        }
        for o in &obs {
            o.persist_or_delete();
        }
        let after_from_clear = Self::pair_clear(from_creditor, debtor, asset_id);
        PairCycle::sync_cycle(
            from_creditor,
            debtor,
            asset_id,
            before_from_clear,
            after_from_clear,
        );
        PairCycle::inherit_on_transfer(
            to_creditor,
            debtor,
            asset_id,
            src_cycle.as_ref(),
            dest_occupied,
            now,
        );
    }

    fn add_rate_delta(deltas: &mut Vec<(u32, u64, u64)>, rate: u32, interest: u64, principal: u64) {
        if interest == 0 && principal == 0 {
            return;
        }
        if let Some((_, i, p)) = deltas.iter_mut().find(|(r, _, _)| *r == rate) {
            *i = i.checked_add(interest).expect("accrued overflow");
            *p = p
                .checked_add(principal)
                .expect("obligation principal overflow");
        } else {
            deltas.push((rate, interest, principal));
        }
    }

    /// Add transferred interest and principal. Does not open a dest cycle.
    fn apply_claim_delta(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        rate: u32,
        interest: u64,
        principal: u64,
    ) {
        let mut dest = Self::get_existing_or_new(creditor, debtor, asset_id, rate);
        dest.accrue();
        let mut changed = false;
        if interest > 0 {
            dest.accrued_interest = dest
                .accrued_interest
                .value
                .checked_add(interest)
                .expect("accrued overflow")
                .into();
            changed = true;
        }
        if principal > 0 {
            dest.remaining_principal = dest
                .remaining_principal
                .value
                .checked_add(principal)
                .expect("obligation principal overflow")
                .into();
            changed = true;
        }
        if changed {
            dest.note_grace_change();
        }
        dest.save();
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

    /// Creditor write-off: reduce claims `debtor` owes `creditor` by
    /// `min(amount, exposure)`. Does not touch the reverse direction.
    ///
    /// Same waterfall as net (interest, then principal, highest APR).
    /// Partial leaves an open grace snapshot; pair empty closes the cycle
    /// via [`apply_reduction`] → [`PairCycle::sync_cycle`].
    pub fn forgive_pair(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
    ) -> Quantity {
        assert!(creditor != debtor, "cannot forgive self");
        assert!(amount.value > 0, "forgive amount must be positive");

        Self::accrue_pair(creditor, debtor, asset_id);
        let take = Self::exposure(creditor, debtor, asset_id)
            .value
            .min(amount.value);
        assert!(take > 0, "nothing to forgive");
        Self::apply_reduction(creditor, debtor, asset_id, take);
        take.into()
    }

    /// Grow principal on this claim (shared by deposit and line draws).
    /// Accrues first so interest is finalized on the prior principal balance.
    fn credit(&mut self, amount: Quantity) {
        self.accrue();
        let before_clear = Self::pair_clear(self.creditor, self.debtor, self.asset_id);
        self.remaining_principal = self
            .remaining_principal
            .value
            .checked_add(amount.value)
            .expect("obligation principal overflow")
            .into();
        self.note_grace_change();
        self.save();
        let after_clear = Self::pair_clear(self.creditor, self.debtor, self.asset_id);
        PairCycle::sync_cycle(
            self.creditor,
            self.debtor,
            self.asset_id,
            before_clear,
            after_clear,
        );
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
