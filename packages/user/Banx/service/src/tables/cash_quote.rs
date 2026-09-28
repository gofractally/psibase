use psibase::{
    services::tokens::{Quantity, Wrapper as Tokens},
    AccountNumber, Memo, ServiceWrapper, Table, TimePointSec,
};

use super::{apply_rate, cash_sub, emit_pair_activity, expires_live, Connection};
use crate::tables::tables::{Asset, CashQuote, CashQuoteTab};

impl CashQuote {
    fn save(&self) {
        CashQuoteTab::read_write().put(self).unwrap();
    }

    fn get(poster: AccountNumber, asset_id: u16, token_id: u32, is_out: bool) -> Option<Self> {
        CashQuoteTab::read()
            .get_index_pk()
            .get(&(poster, asset_id, token_id, is_out))
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    fn assert_live(&self) {
        assert!(self.is_live(), "cash quote expired");
    }

    pub fn get_assert(poster: AccountNumber, asset_id: u16, token_id: u32, is_out: bool) -> Self {
        Self::get(poster, asset_id, token_id, is_out).expect("cash quote not found")
    }

    /// Exact row, and it must still be live. For takes (`cash_in` / `cash_out`).
    pub fn get_live(poster: AccountNumber, asset_id: u16, token_id: u32, is_out: bool) -> Self {
        let q = Self::get_assert(poster, asset_id, token_id, is_out);
        q.assert_live();
        q
    }

    pub fn upsert(
        poster: AccountNumber,
        asset_id: u16,
        token_id: u32,
        is_out: bool,
        fee_fixed: Quantity,
        fx_rate: u64,
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        let _ = Asset::get_assert(asset_id);
        let _ = Tokens::call().getToken(token_id);
        assert!(fx_rate > 0, "fx_rate must be positive");
        assert!(
            remaining.value > 0,
            "cash-quote remaining must be positive"
        );
        Self {
            poster,
            asset_id,
            token_id,
            is_out,
            fee_fixed,
            fx_rate,
            remaining,
            expires_at,
        }
        .save();
    }

    pub fn remove(&self) {
        CashQuoteTab::read_write().erase(&(self.poster, self.asset_id, self.token_id, self.is_out));
    }

    pub fn apply(&self, amount_from: Quantity) -> Quantity {
        self.assert_live();
        apply_rate(amount_from, self.fee_fixed, self.fx_rate)
    }

    fn token_memo(kind: &str) -> Memo {
        kind.to_string().try_into().expect("cash memo")
    }

    /// Pull `amount` tokens from shared(`from`, Banx) into Banx primary.
    fn tokens_debit(from: AccountNumber, token_id: u32, amount: Quantity, memo: &str) {
        Tokens::call().debit(token_id, from, amount, Self::token_memo(memo));
    }

    fn to_sub(poster: AccountNumber, token_id: u32, amount: Quantity) {
        Tokens::call().toSub(token_id, cash_sub(poster, token_id), amount);
    }

    fn from_sub(poster: AccountNumber, token_id: u32, amount: Quantity) {
        Tokens::call().fromSub(token_id, cash_sub(poster, token_id), amount);
    }

    /// Shared(`from`, Banx) → poster's Tokens sub-account on Banx.
    pub fn take_tokens(from: AccountNumber, token_id: u32, amount: Quantity, memo: &str) {
        Self::tokens_debit(from, token_id, amount, memo);
        Self::to_sub(from, token_id, amount);
    }

    /// Poster's sub-account → `to` (via Banx primary).
    pub fn pay_tokens(
        poster: AccountNumber,
        to: AccountNumber,
        token_id: u32,
        amount: Quantity,
        memo: &str,
    ) {
        Self::from_sub(poster, token_id, amount);
        Tokens::call().credit(token_id, to, amount, Self::token_memo(memo));
    }

    fn spend(&mut self, amount: Quantity) {
        assert!(
            amount.value <= self.remaining.value,
            "cash amount exceeds quote remaining"
        );
        self.remaining = (self.remaining.value - amount.value).into();
        self.save();
    }

    /// Taker draws `amount_banx` on poster; receives tokens. `min_tokens` is
    /// the cash-out floor. Tokens come from `{poster}/{token_id}` on Banx.
    pub fn cash_out(
        &mut self,
        taker: AccountNumber,
        amount_banx: Quantity,
        min_tokens: Quantity,
    ) {
        assert!(self.is_out, "cash quote is not out");
        assert!(taker != self.poster, "cannot cash_out with self");
        assert!(amount_banx.value > 0, "cash_out amount must be positive");
        self.spend(amount_banx);
        let tokens = self.apply(amount_banx);
        assert!(
            tokens.value >= min_tokens.value,
            "cash_out tokens below min_tokens"
        );
        let creditor = self.poster;
        let debtor = taker;
        let asset_id = self.asset_id;
        let netted = Connection::get_live(creditor, debtor, asset_id).apply_draw(amount_banx);
        Self::pay_tokens(creditor, taker, self.token_id, tokens, "cash_out");
        emit_pair_activity(
            creditor,
            debtor,
            asset_id,
            "cash_out",
            amount_banx,
            netted,
            asset_id,
            0,
            "",
        );
    }

    /// Taker sends `amount_tokens` from `{taker}/{token_id}` (filled by
    /// `csh_fund`) into the poster's vault; books a deposit onto the poster.
    pub fn cash_in(
        &mut self,
        taker: AccountNumber,
        amount_tokens: Quantity,
        min_banx: Quantity,
    ) {
        assert!(!self.is_out, "cash quote is not in");
        assert!(taker != self.poster, "cannot cash_in with self");
        assert!(amount_tokens.value > 0, "cash_in amount must be positive");
        self.spend(amount_tokens);
        let banx_amt = self.apply(amount_tokens);
        assert!(
            banx_amt.value >= min_banx.value,
            "{}",
            &format!(
                "cash_in Banx {} below min_banx of {}",
                banx_amt.value, min_banx.value
            )
        );
        Self::from_sub(taker, self.token_id, amount_tokens);
        Self::to_sub(self.poster, self.token_id, amount_tokens);
        let netted = Connection::get_live(taker, self.poster, self.asset_id).deposit(banx_amt, 0);
        emit_pair_activity(
            taker,
            self.poster,
            self.asset_id,
            "cash_in",
            banx_amt,
            netted,
            self.asset_id,
            0,
            "",
        );
    }
}
