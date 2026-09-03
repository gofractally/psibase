use psibase::{services::tokens::Quantity, AccountNumber, Table};

use super::assert_account_exists;
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, CreditLine, CreditLineTable, PairCycle};

impl CreditLine {
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
            remaining: if deplete_on_debit { limit } else { 0.into() },
        }
    }

    pub fn consume_remaining(&mut self, amount: Quantity) {
        if !self.deplete_on_debit {
            return;
        }
        assert!(
            amount.value <= self.remaining.value,
            "insufficient remaining"
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
        assert_account_exists(debtor);
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
            if line.remaining.value > amount.value {
                line.remaining = amount;
            } else if deplete_on_debit && !was_depleting && line.remaining.value == 0 {
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
    pub fn remove(&self) {
        CreditLineTable::read_write().erase(&(self.creditor, self.debtor, self.asset_id));
        PairCycle::set_posted_grace(self.creditor, self.debtor, self.asset_id, 0);
    }
}
