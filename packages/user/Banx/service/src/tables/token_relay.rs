use psibase::{
    services::tokens::{Quantity, Wrapper as Tokens},
    AccountNumber, ServiceWrapper, Table,
};

use super::{cash_sub, emit_pair_activity, Connection};
use crate::math::{try_swap_out, PPM_SCALE};
use crate::tables::tables::{Asset, CashQuote, TokenRelay, TokenRelayTable};

fn token_reserve(owner: AccountNumber, token_id: u32) -> u64 {
    Tokens::call()
        .getSubBal(token_id, cash_sub(owner, token_id))
        .map(|q| q.value)
        .unwrap_or(0)
}

fn row_for_vault(owner: AccountNumber, token_id: u32) -> Option<TokenRelay> {
    TokenRelayTable::read()
        .get_index_pk()
        .iter()
        .find(|row| row.owner == owner && row.token_id == token_id)
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

    pub(crate) fn vault_balance(owner: AccountNumber, token_id: u32) -> u64 {
        token_reserve(owner, token_id)
    }

    /// True when this token vault is the live reserve of a relay.
    pub(crate) fn vault_backs(owner: AccountNumber, token_id: u32) -> bool {
        row_for_vault(owner, token_id).is_some()
    }

    /// A fund or withdraw changed the live token reserve outside a swap.
    /// Scale the virtual Banx weight by the same ratio so the price stays put.
    /// An empty vault has no ratio, whether it just emptied or is being filled.
    /// The declared weight stays, so a later fund can sell again.
    pub(crate) fn sync_vault(owner: AccountNumber, token_id: u32, before: u64, after: u64) {
        if before == 0 || after == 0 || before == after {
            return;
        }
        let Some(mut row) = row_for_vault(owner, token_id) else {
            return;
        };
        let next = (row.reserve_banx.value as u128)
            .checked_mul(after as u128)
            .expect("relay reserve overflow")
            / (before as u128);
        let next = u64::try_from(next).expect("relay reserve overflow");
        row.reserve_banx = Quantity::new(next);
        row.save();
    }

    pub fn upsert(
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        reserve_banx: Quantity,
        fee_ppm: u32,
    ) {
        assert!(reserve_banx.value > 0, "relay reserve must be positive");
        assert!(fee_ppm < PPM_SCALE, "relay fee must be under 100%");
        let _ = Asset::get_assert(asset_id);
        let _ = Tokens::call().getToken(token_id);
        let other = TokenRelayTable::read()
            .get_index_pk()
            .iter()
            .find(|row| row.owner == owner && row.token_id == token_id && row.asset_id != asset_id);
        assert!(other.is_none(), "token vault already backs another relay");
        Self {
            owner,
            asset_id,
            token_id,
            reserve_banx,
            fee_ppm,
        }
        .save();
    }

    pub fn remove(&self) {
        TokenRelayTable::read_write().erase(&(self.owner, self.asset_id, self.token_id));
    }

    /// Banx in, tokens out. Moves the virtual Banx reserve. Caller pays the tokens.
    pub fn take_banx(&mut self, amount_banx: Quantity) -> Quantity {
        let tokens = token_reserve(self.owner, self.token_id);
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
    /// only after this sizes the output from the vault as it stands now.
    pub fn quote_banx_out(&self, amount_tokens: Quantity) -> Quantity {
        let tokens = token_reserve(self.owner, self.token_id);
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
        CashQuote::pay_tokens(owner, recipient, token_id, tokens_out, "relay");
        // The path already recorded the Banx draw. Recipient holds tokens,
        // not a claim on `owner`, so this is not another liability row.
        tokens_out
    }

    /// Taker draws `amount_banx` on the owner and receives tokens from the vault.
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
        CashQuote::pay_tokens(owner, taker, token_id, tokens_out, "relay");
        emit_pair_activity(
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

    /// Taker's vault sends tokens into the owner's vault. Owner owes the taker Banx.
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
        let taker_before = token_reserve(taker, token_id);
        CashQuote::move_vault(taker, owner, token_id, amount_tokens);
        // The owner's reserve moves in `give_banx`. The taker's own relay, if
        // any, lost inventory and keeps the same price.
        Self::sync_vault(
            taker,
            token_id,
            taker_before,
            token_reserve(taker, token_id),
        );
        relay.give_banx(banx_out);
        let netted = Connection::get_live(taker, owner, asset_id).deposit(banx_out, 0);
        emit_pair_activity(
            taker, owner, asset_id, "relay", banx_out, netted, asset_id, 0, "",
        );
        banx_out
    }
}
