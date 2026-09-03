use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{assert_account_exists, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, BookAuth, BookAuthTab};

impl BookAuth {
    fn save(&self) {
        BookAuthTab::read_write().put(self).unwrap();
    }

    pub fn get(debtor: AccountNumber, creditor: AccountNumber, asset_id: u16) -> Option<Self> {
        BookAuthTab::read()
            .get_index_pk()
            .get(&(debtor, creditor, asset_id))
    }

    pub fn get_assert(debtor: AccountNumber, creditor: AccountNumber, asset_id: u16) -> Self {
        Self::get(debtor, creditor, asset_id).unwrap_or_else(|| {
            panic!("book-auth not found: debtor={debtor}, creditor={creditor}, asset_id={asset_id}")
        })
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    /// Debtor (sender) posts/replaces a budget for `creditor` to `book`.
    pub fn upsert(
        debtor: AccountNumber,
        creditor: AccountNumber,
        asset_id: u16,
        remaining: Quantity,
        max_interest_rate: u32,
        expires_at: TimePointSec,
    ) {
        assert!(debtor != creditor, "cannot book-auth self");
        assert_account_exists(creditor);
        let _ = Asset::get_assert(asset_id);
        assert!(remaining.value > 0, "book-auth remaining must be positive");
        assert!(
            max_interest_rate <= PPM_SCALE,
            "max_interest_rate exceeds 100% (PPM_SCALE)"
        );
        Self {
            debtor,
            creditor,
            asset_id,
            remaining,
            max_interest_rate,
            expires_at,
        }
        .save();
    }

    pub fn remove(&self) {
        BookAuthTab::read_write().erase(&(self.debtor, self.creditor, self.asset_id));
    }

    /// Creditor books `amount` onto this debtor. Spends remaining (kept at 0
    /// so the debtor can top up). Returns auto-netted amount from the deposit.
    pub fn book(mut self, amount: Quantity, interest_rate: u32) -> Quantity {
        assert!(amount.value > 0, "book amount must be positive");
        assert!(
            interest_rate <= PPM_SCALE,
            "interest_rate exceeds 100% (PPM_SCALE)"
        );
        assert!(self.is_live(), "book-auth expired");
        assert!(
            interest_rate <= self.max_interest_rate,
            "interest_rate exceeds book-auth max"
        );
        assert!(
            amount.value <= self.remaining.value,
            "book amount exceeds remaining"
        );
        self.remaining = (self.remaining.value - amount.value).into();
        self.save();
        Connection::get_live(self.creditor, self.debtor, self.asset_id)
            .deposit(amount, interest_rate)
    }
}
