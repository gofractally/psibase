use psibase::{services::tokens::Quantity, AccountNumber, Memo, Table, TimePointSec};

use super::{assert_account_exists, emit_pair_activity, expires_live};
use crate::tables::tables::{Asset, InitRow, Obligation, PayRequest, RequestTab};

impl PayRequest {
    pub const INVOICE: u8 = 1;
    pub const PLEASE_BOOK: u8 = 2;
    pub const SETTLE_AUTH: u8 = 3;

    fn save(&self) {
        RequestTab::read_write().put(self).unwrap();
    }

    pub fn get(id: u32) -> Option<Self> {
        RequestTab::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: u32) -> Self {
        Self::get(id).unwrap_or_else(|| panic!("request {id} not found"))
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    fn assert_live(&self) {
        assert!(self.remaining.value > 0, "request already fulfilled");
        assert!(self.is_live(), "request expired");
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
            kind == Self::INVOICE || kind == Self::PLEASE_BOOK || kind == Self::SETTLE_AUTH,
            "request kind must be invoice (1), please-book (2), or settle-auth (3)"
        );
        assert!(poster != counterparty, "cannot request to self");
        if kind != Self::INVOICE {
            assert!(
                counterparty != AccountNumber::new(0),
                "request counterparty required"
            );
        }
        if counterparty != AccountNumber::new(0) {
            assert_account_exists(counterparty);
        }
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
        let kind_s = match kind {
            Self::INVOICE => "invoice",
            Self::PLEASE_BOOK => "please_book",
            _ => "settle_auth",
        };
        emit_pair_activity(
            poster,
            counterparty,
            asset_id,
            kind_s,
            amount,
            0.into(),
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

    /// Live remaining for an invoice path. Same checks as fulfill; no mutate.
    pub fn live_invoice_remaining(id: u32, last_hop: AccountNumber, last_asset: u16) -> Quantity {
        let row = Self::get_assert(id);
        assert!(row.kind == Self::INVOICE, "request is not an invoice");
        row.assert_live();
        assert!(
            last_hop == row.poster,
            "invoice path must end at the payee (poster)"
        );
        assert!(
            last_asset == row.asset_id,
            "invoice last hop asset mismatch"
        );
        row.remaining
    }

    /// After a successful path_pay: last hop must be the payee (poster).
    /// Signer is recorded as `payer` on the activity; any account with a
    /// path to the poster may fulfill (`counterparty` is who was billed).
    pub fn fulfill_invoice(
        id: u32,
        payer: AccountNumber,
        last_hop: AccountNumber,
        last_asset: u16,
        delivered: Quantity,
    ) {
        let mut row = Self::get_assert(id);
        assert!(row.kind == Self::INVOICE, "request is not an invoice");
        row.assert_live();
        assert!(
            last_hop == row.poster,
            "invoice path must end at the payee (poster)"
        );
        assert!(
            last_asset == row.asset_id,
            "invoice last hop asset mismatch"
        );
        assert!(delivered.value > 0, "invoice fulfill delivered is zero");
        let take = Quantity::new(row.remaining.value.min(delivered.value));
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

    /// Debtor pulls a deposit-equivalent the creditor already authorized.
    /// `take` = min(amount, remaining, live exposure). Never flips the book.
    pub fn fulfill_settle(
        id: u32,
        debtor: AccountNumber,
        amount: Quantity,
    ) -> (Quantity, String, AccountNumber, u16) {
        let mut row = Self::get_assert(id);
        assert!(
            row.kind == Self::SETTLE_AUTH,
            "request is not a settle-auth"
        );
        row.assert_live();
        assert!(
            debtor == row.counterparty,
            "only the named debtor can fulfill this settle-auth"
        );
        assert!(amount.value > 0, "settle amount must be positive");
        let exposure = Obligation::exposure(row.poster, row.counterparty, row.asset_id).value;
        let take = amount.value.min(row.remaining.value).min(exposure);
        assert!(take > 0, "nothing to settle (no exposure on this pair)");
        row.remaining = (row.remaining.value - take).into();
        row.save();
        (take.into(), row.memo.to_string(), row.poster, row.asset_id)
    }
}
