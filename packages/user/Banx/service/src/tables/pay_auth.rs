use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{assert_account_exists, path_required_send, run_path};
use crate::tables::tables::{Asset, InitRow, Obligation, PathHop, PayAuth, PayAuthTab};

impl PayAuth {
    fn save(&self) {
        PayAuthTab::read_write().put(self).unwrap();
    }

    pub fn get(id: u32) -> Option<Self> {
        PayAuthTab::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: u32) -> Self {
        Self::get(id).unwrap_or_else(|| panic!("pay auth {id} not found"))
    }

    /// Payable when the period has started and its start is still before `ends_at`
    /// (`ends_at` 0 means no scheduled end).
    pub fn is_payable(&self, now: TimePointSec) -> bool {
        self.next_due.seconds <= now.seconds
            && (self.ends_at.seconds == 0 || self.next_due.seconds < self.ends_at.seconds)
    }

    pub fn create(
        payer: AccountNumber,
        payee: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        max_spend: Quantity,
        period_seconds: u32,
        next_due: TimePointSec,
        ends_at: TimePointSec,
    ) -> u32 {
        assert!(payer != payee, "cannot pay auth to self");
        assert_account_exists(payee);
        assert!(amount.value > 0, "pay auth amount must be positive");
        assert!(
            max_spend.value >= amount.value,
            "pay auth max_spend below amount"
        );
        assert!(period_seconds > 0, "pay auth period must be positive");
        assert!(
            ends_at.seconds == 0 || ends_at.seconds > next_due.seconds,
            "pay auth ends before it starts"
        );
        let _ = Asset::get_assert(asset_id);
        let id = InitRow::alloc_pay_auth_id();
        Self {
            id,
            payer,
            payee,
            asset_id,
            amount,
            max_spend,
            period_seconds,
            next_due,
            ends_at,
        }
        .save();
        id
    }

    /// Pay the oldest due period only. Several elapsed periods stay due.
    pub fn run(id: u32, hops: Vec<PathHop>, sender: AccountNumber) {
        let mut row = Self::get_assert(id);
        assert!(
            sender == row.payer || sender == row.payee,
            "only the payer or payee can run a pay auth"
        );
        assert!(
            row.is_payable(Obligation::now()),
            "pay auth has no due period"
        );
        assert!(
            !hops.is_empty(),
            "pay auth path must include at least one hop"
        );
        let last = hops[hops.len() - 1];
        assert!(
            last.account == row.payee,
            "pay auth last hop must be the payee"
        );
        assert!(
            hops.iter().all(|hop| hop.asset_id == row.asset_id),
            "pay auth hop asset must match"
        );
        let required = path_required_send(&hops, row.amount);
        assert!(
            required.value <= row.max_spend.value,
            "pay auth send above max_spend"
        );
        row.next_due.seconds = row
            .next_due
            .seconds
            .checked_add(i64::from(row.period_seconds))
            .expect("pay auth next_due overflow");
        row.save();
        let memo = format!("pay-auth {}", row.id);
        run_path(row.payer, hops, required, row.amount, 0, &memo);
    }

    /// Erase the row. Does not draw.
    ///
    /// `force_cancel` false throws when a period is payable, so a delete
    /// cannot drop a payment that is already due. A series past its
    /// scheduled end is not payable.
    pub fn cancel(id: u32, sender: AccountNumber, force_cancel: bool) {
        let row = Self::get_assert(id);
        assert!(
            sender == row.payer || sender == row.payee,
            "only the payer or payee can cancel a pay auth"
        );
        if !force_cancel && row.is_payable(Obligation::now()) {
            panic!("pay auth has a due period");
        }
        PayAuthTab::read_write().erase(&id);
    }
}
