use psibase::{
    services::tokens::{Quantity, Wrapper as Tokens},
    AccountNumber, ServiceWrapper, Table,
};

use super::{cash_sub, emit_pair_activity, relay_sub, Connection};
use crate::math::{try_swap_out, PPM_SCALE};
use crate::tables::tables::{Asset, CashQuote, TokenRelay, TokenRelayTable};

fn token_reserve(owner: AccountNumber, asset_id: u16, token_id: u32) -> u64 {
    Tokens::call()
        .getSubBal(token_id, relay_sub(owner, asset_id, token_id))
        .map(|q| q.value)
        .unwrap_or(0)
}

impl TokenRelay {
    fn save(&self) {
        TokenRelayTable::read_write().put(self).unwrap();
    }

    pub fn get(owner: AccountNumber, asset_id: u16, token_id: u32) -> Option<Self> {
        TokenRelayTable::read()
            .get_index_pk()
            .get(&(owner, asset_id, token_id))
    }

    pub fn get_assert(owner: AccountNumber, asset_id: u16, token_id: u32) -> Self {
        Self::get(owner, asset_id, token_id).unwrap_or_else(|| {
            panic!("token relay not found: owner={owner}, asset_id={asset_id}, token_id={token_id}")
        })
    }

    fn pair_sub(&self) -> String {
        relay_sub(self.owner, self.asset_id, self.token_id)
    }

    /// Pull `reserve_tokens` from the shared credit into this pair's sub-account.
    /// A second post of the same pair is rejected: one owner, one pool.
    pub fn upsert(
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        reserve_banx: Quantity,
        reserve_tokens: Quantity,
        fee_ppm: u32,
    ) {
        assert!(reserve_banx.value > 0, "relay reserve must be positive");
        assert!(
            reserve_tokens.value > 0,
            "relay token reserve must be positive"
        );
        assert!(fee_ppm < PPM_SCALE, "relay fee must be under 100%");
        Asset::get_assert(asset_id);
        Tokens::call().getToken(token_id);
        assert!(
            Self::get(owner, asset_id, token_id).is_none(),
            "relay already posted for this pair"
        );
        CashQuote::debit_into_named(
            owner,
            token_id,
            relay_sub(owner, asset_id, token_id),
            reserve_tokens,
            "relay",
        );
        Self {
            owner,
            asset_id,
            token_id,
            reserve_banx,
            fee_ppm,
        }
        .save();
    }

    /// Return whatever tokens are still in the pair, then erase the row.
    pub fn remove(&self) {
        let left = token_reserve(self.owner, self.asset_id, self.token_id);
        if left > 0 {
            CashQuote::pay_named(
                self.pair_sub(),
                self.owner,
                self.token_id,
                Quantity::new(left),
                "relay",
            );
        }
        TokenRelayTable::read_write().erase(&(self.owner, self.asset_id, self.token_id));
    }

    /// Banx in, tokens out. Moves the virtual Banx reserve. Caller pays the tokens.
    pub fn take_banx(&mut self, amount_banx: Quantity) -> Quantity {
        let tokens = token_reserve(self.owner, self.asset_id, self.token_id);
        let out = try_swap_out(
            self.reserve_banx.value,
            tokens,
            amount_banx.value,
            self.fee_ppm,
        )
        .expect("relay swap produced nothing");
        self.reserve_banx = Quantity::new(
            self.reserve_banx
                .value
                .checked_add(amount_banx.value)
                .expect("relay reserve overflow"),
        );
        self.save();
        out.into()
    }

    /// Tokens in, Banx out. Does not move tokens. Caller deposits them first
    /// only after this sizes the output from the pair as it stands now.
    pub fn quote_banx_out(&self, amount_tokens: Quantity) -> Quantity {
        let tokens = token_reserve(self.owner, self.asset_id, self.token_id);
        let out = try_swap_out(
            tokens,
            self.reserve_banx.value,
            amount_tokens.value,
            self.fee_ppm,
        )
        .expect("relay swap produced nothing");
        out.into()
    }

    pub fn give_banx(&mut self, amount_out: Quantity) {
        assert!(
            amount_out.value < self.reserve_banx.value,
            "relay banx reserve exceeded"
        );
        self.reserve_banx = self.reserve_banx - amount_out;
        self.save();
    }

    fn pay_tokens(&self, to: AccountNumber, amount: Quantity) {
        CashQuote::pay_named(self.pair_sub(), to, self.token_id, amount, "relay");
    }

    /// Path already drew `amount_banx` on `owner`. Pay the curve's tokens to `recipient`.
    pub fn pay_tokens_for_banx(
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_banx: Quantity,
        recipient: AccountNumber,
        min_tokens: Quantity,
    ) -> Quantity {
        let mut relay = Self::get_assert(owner, asset_id, token_id);
        let tokens_out = relay.take_banx(amount_banx);
        assert!(
            tokens_out.value >= min_tokens.value,
            "relay tokens below min_tokens"
        );
        relay.pay_tokens(recipient, tokens_out);
        // The path already recorded the Banx draw. Recipient holds tokens,
        // not a claim on `owner`, so this is not another liability row.
        tokens_out
    }

    /// Taker draws `amount_banx` on the owner and receives tokens from the pair.
    pub fn cash_out(
        owner: AccountNumber,
        taker: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_banx: Quantity,
        min_tokens: Quantity,
    ) -> Quantity {
        assert!(taker != owner, "cannot swap with self");
        assert!(amount_banx.value > 0, "relay amount must be positive");
        let mut relay = Self::get_assert(owner, asset_id, token_id);
        let tokens_out = relay.take_banx(amount_banx);
        assert!(
            tokens_out.value >= min_tokens.value,
            "relay tokens below min_tokens"
        );
        // One relay row, with the amount the draw actually netted. `draw`
        // would also emit a path hop for a swap that is not a path.
        let netted = Connection::get_live(owner, taker, asset_id).apply_draw(amount_banx);
        relay.pay_tokens(taker, tokens_out);
        emit_pair_activity(
            taker,
            owner,
            taker,
            asset_id,
            "relay",
            amount_banx,
            netted,
            asset_id,
            0,
            "",
        );
        tokens_out
    }

    /// Taker's cash vault sends tokens into the owner's pair. Owner owes the taker Banx.
    pub fn cash_in(
        owner: AccountNumber,
        taker: AccountNumber,
        asset_id: u16,
        token_id: u32,
        amount_tokens: Quantity,
        min_banx: Quantity,
    ) -> Quantity {
        assert!(taker != owner, "cannot swap with self");
        assert!(amount_tokens.value > 0, "relay amount must be positive");
        let mut relay = Self::get_assert(owner, asset_id, token_id);
        let banx_out = relay.quote_banx_out(amount_tokens);
        assert!(
            banx_out.value >= min_banx.value,
            "relay banx below min_banx"
        );
        CashQuote::move_named(
            cash_sub(taker, token_id),
            relay.pair_sub(),
            token_id,
            amount_tokens,
        );
        relay.give_banx(banx_out);
        let netted = Connection::get_live(taker, owner, asset_id).deposit(banx_out, 0);
        emit_pair_activity(
            taker, taker, owner, asset_id, "relay", banx_out, netted, asset_id, 0, "",
        );
        banx_out
    }
}
