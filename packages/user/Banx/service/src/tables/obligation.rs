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

    /// Total exposure: Σ live balance (principal + interest, after decay).
    ///
    /// Each bucket already caps at `u64::MAX`. Two of those can still sum
    /// past it after interest. A panicking add freezes forgive, net, draw,
    /// and sale, which all size from this total. The reported value is the
    /// largest amount one settle can take; a later call clears what did not fit.
    pub fn exposure(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Quantity {
        let total = Self::obligations(creditor, debtor, asset_id)
            .into_iter()
            .fold(0u64, |acc, o| {
                let (principal, accrued) = o.live_parts();
                acc.saturating_add(principal.value)
                    .saturating_add(accrued.value)
            });
        total.into()
    }

    pub fn get_by_interest_rate(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        interest_rate: i32,
    ) -> Option<Self> {
        Self::obligations(creditor, debtor, asset_id)
            .into_iter()
            .find(|obligation| obligation.interest_rate == interest_rate)
    }

    pub fn get_existing_or_new(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        interest_rate: i32,
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
        interest_rate: i32,
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

    /// `(principal, accrued interest)` after this epoch. Decay below the
    /// stored principal is returned as a smaller principal and zero interest.
    pub fn live_parts(&self) -> (Quantity, Quantity) {
        let (principal, accrued) = self.live_parts_at(Self::now());
        (principal.into(), accrued.into())
    }

    fn live_parts_at(&self, now: TimePointSec) -> (u64, u64) {
        // A stored split past u64::MAX trims accrued so forgive and net can
        // still reduce the row. The cap is the largest settleable balance.
        let (principal, accrued) =
            Self::capped_parts(self.remaining_principal.value, self.accrued_interest.value);
        if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
            // No new compounding. Keep finalized interest already on the row
            // (e.g. transferred from an aged claim).
            return (principal, accrued);
        }
        let base = principal.saturating_add(accrued);
        let total =
            crate::interest::compound_amount(base, self.interest_rate, self.dt_since_epoch(now));
        if total >= principal {
            (principal, total - principal)
        } else {
            (total, 0)
        }
    }

    /// Stored principal and accrued that sum to at most `u64::MAX`.
    /// Principal is kept; accrued is what still fits under the cap.
    fn capped_parts(principal: u64, accrued: u64) -> (u64, u64) {
        let base = principal.saturating_add(accrued);
        (principal, base - principal)
    }

    /// Finalize the live balance and start a new epoch.
    ///
    /// During grace, compound does not run and the epoch does not move.
    /// An over-cap split is still written down to the settleable cap, so a
    /// later forgive or net spends that balance. Callers that change
    /// principal or stored interest slide the epoch via
    /// [`Self::note_grace_change`]. A negative rate may shrink principal
    /// once stored interest is gone; a zero balance deletes the row.
    pub fn accrue(&mut self) {
        let now = Self::now();
        if PairCycle::pair_in_grace(self.creditor, self.debtor, self.asset_id, now) {
            // The trim is not a balance change. Moving the epoch would drop
            // the deferred charge grace is supposed to bill later.
            let (principal, accrued) =
                Self::capped_parts(self.remaining_principal.value, self.accrued_interest.value);
            if principal != self.remaining_principal.value || accrued != self.accrued_interest.value
            {
                self.remaining_principal = principal.into();
                self.accrued_interest = accrued.into();
                self.save();
            }
            return;
        }
        let (principal, accrued) = self.live_parts_at(now);
        let unchanged =
            principal == self.remaining_principal.value && accrued == self.accrued_interest.value;
        if unchanged && now.seconds <= self.last_interest_accrual.seconds {
            return;
        }
        self.remaining_principal = principal.into();
        self.accrued_interest = accrued.into();
        self.last_interest_accrual = now;
        if self.is_clear() {
            self.delete();
            PairCycle::sync_cycle(
                self.creditor,
                self.debtor,
                self.asset_id,
                false,
                Self::pair_clear(self.creditor, self.debtor, self.asset_id),
            );
        } else {
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

    /// Delete rows whose live balance has reached zero.
    ///
    /// [`Self::pair_clear`] reads stored principal. A negative-rate row keeps
    /// that principal until accrue deletes it, so a later credit at another
    /// rate still looks occupied and posted grace does not open. Live rows
    /// stay untouched: accruing them would move an epoch whose floored
    /// balance did not change.
    fn delete_decayed(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
        let now = Self::now();
        if PairCycle::pair_in_grace(creditor, debtor, asset_id, now) {
            return;
        }
        for mut row in Self::obligations(creditor, debtor, asset_id) {
            let (principal, accrued) = row.live_parts_at(now);
            if principal == 0 && accrued == 0 && !row.is_clear() {
                row.accrue();
            }
        }
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
        Self::reduce_sorted(&mut obs, amount, |_, _, _| {});

        for o in &obs {
            o.persist_or_delete();
        }
        let after_clear = Self::pair_clear(creditor, debtor, asset_id);
        PairCycle::sync_cycle(creditor, debtor, asset_id, before_clear, after_clear);
    }

    /// `obs` is already [`Self::sort_for_net`] order. Interest, then principal.
    /// `on_take(rate, interest, principal)` runs only for a positive take.
    /// Returns the unconsumed remainder.
    fn reduce_sorted(obs: &mut [Self], amount: u64, mut on_take: impl FnMut(i32, u64, u64)) -> u64 {
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
            on_take(o.interest_rate, take, 0);
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
            on_take(o.interest_rate, 0, take);
            left -= take;
        }
        left
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
        // A live-zero destination still stores principal. Sample occupancy
        // only after that row is gone, or the source window is not inherited.
        Self::delete_decayed(to_creditor, debtor, asset_id);
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
        let mut dest_delta: Vec<(i32, u64, u64)> = Vec::new();
        let left = Self::reduce_sorted(&mut obs, amount, |rate, interest, principal| {
            Self::add_rate_delta(&mut dest_delta, rate, interest, principal);
        });
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

    fn add_rate_delta(deltas: &mut Vec<(i32, u64, u64)>, rate: i32, interest: u64, principal: u64) {
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
        rate: i32,
        interest: u64,
        principal: u64,
    ) {
        let mut dest = Self::get_existing_or_new(creditor, debtor, asset_id, rate);
        dest.accrue();
        let mut changed = false;
        if interest > 0 || principal > 0 {
            let next_interest = dest
                .accrued_interest
                .value
                .checked_add(interest)
                .expect("obligation balance overflow");
            let next_principal = dest
                .remaining_principal
                .value
                .checked_add(principal)
                .expect("obligation balance overflow");
            assert!(
                next_principal.checked_add(next_interest).is_some(),
                "obligation balance overflow"
            );
            if interest > 0 {
                dest.accrued_interest = next_interest.into();
                changed = true;
            }
            if principal > 0 {
                dest.remaining_principal = next_principal.into();
                changed = true;
            }
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
        // Nothing left, including a claim that just decayed to zero.
        // Returning commits that delete; failing the action would roll it back.
        if take == 0 {
            return 0.into();
        }
        Self::apply_reduction(creditor, debtor, asset_id, take);
        take.into()
    }

    /// Grow principal on this claim (shared by deposit and line draws).
    /// Decayed rows on the pair are removed first, then this bucket is
    /// accrued, so new principal is not back-dated and occupancy is sampled
    /// after a zero balance is gone.
    fn credit(&mut self, amount: Quantity) {
        Self::delete_decayed(self.creditor, self.debtor, self.asset_id);
        // Accrue deleted this row on a copy. Drop the pre-decay principal
        // before accruing again, or the stale balance is written back.
        match Self::get(self.id) {
            Some(row) => *self = row,
            None if !self.is_clear() => {
                self.remaining_principal = 0.into();
                self.accrued_interest = 0.into();
                self.last_interest_accrual = Self::now();
            }
            None => {}
        }
        self.accrue();
        let before_clear = Self::pair_clear(self.creditor, self.debtor, self.asset_id);
        let next_principal = self
            .remaining_principal
            .value
            .checked_add(amount.value)
            .expect("obligation balance overflow");
        assert!(
            next_principal
                .checked_add(self.accrued_interest.value)
                .is_some(),
            "obligation balance overflow"
        );
        self.remaining_principal = next_principal.into();
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
        interest_rate: i32,
    ) {
        let bound = crate::math::PPM_SCALE as i32;
        assert!(
            (-bound..=bound).contains(&interest_rate),
            "interest_rate outside ±100% (PPM_SCALE)"
        );
        Self::get_existing_or_new(creditor, debtor, asset_id, interest_rate).credit(amount);
    }

    fn save(&self) {
        ObligationTable::read_write().put(&self).unwrap()
    }
}
