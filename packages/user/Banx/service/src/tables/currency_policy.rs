use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{apply_rate, emit_pair_activity, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, CurrencyPolicy, CurrencyPolicyTab};

impl CurrencyPolicy {
    fn save(&self) {
        CurrencyPolicyTab::read_write().put(self).unwrap();
    }

    pub fn get(poster: AccountNumber, from_asset: u16, to_asset: u16) -> Option<Self> {
        CurrencyPolicyTab::read()
            .get_index_pk()
            .get(&(poster, from_asset, to_asset))
    }

    pub fn get_assert(poster: AccountNumber, from_asset: u16, to_asset: u16) -> Self {
        Self::get(poster, from_asset, to_asset).expect("CurrencyPolicy not found")
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    pub(crate) fn assert_live(&self) {
        assert!(self.is_live(), "currency policy expired");
    }

    /// `to = (from - fee_fixed) * fx_rate / RATE_SCALE`. Does not touch books.
    pub fn apply(&self, amount_from: Quantity) -> Quantity {
        self.assert_live();
        apply_rate(amount_from, self.fee_fixed, self.fx_rate)
    }

    /// Poster posts a from→to offer (path hop sizing, or a convert take).
    pub fn upsert(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        fee_fixed: Quantity,
        fx_rate: u64,
        to_interest_rate: u32,
        remaining: Quantity,
        expires_at: TimePointSec,
    ) {
        assert!(
            from_asset != to_asset,
            "currency convert requires different assets"
        );
        let _ = Asset::get_assert(from_asset);
        let _ = Asset::get_assert(to_asset);
        assert!(fx_rate > 0, "fx_rate must be positive");
        assert!(
            to_interest_rate <= PPM_SCALE,
            "to_interest_rate exceeds 100% (PPM_SCALE)"
        );
        assert!(
            remaining.value > 0,
            "currency policy remaining must be positive"
        );
        Self {
            poster,
            from_asset,
            to_asset,
            fee_fixed,
            fx_rate,
            to_interest_rate,
            remaining,
            expires_at,
        }
        .save();
    }

    /// Spend from-asset budget. Posting the policy again replaces what is left.
    pub(crate) fn spend(&mut self, amount: Quantity) {
        self.assert_live();
        assert!(
            amount.value <= self.remaining.value,
            "currency policy amount exceeds remaining"
        );
        self.remaining = self.remaining - amount;
        self.save();
    }

    pub fn remove(&self) {
        CurrencyPolicyTab::read_write().erase(&(self.poster, self.from_asset, self.to_asset));
    }

    /// Rebook leftover `from_asset` between the two parties into
    /// `to_asset` at this poster's rate. Poster must be a party.
    /// Nets `from_asset` once, then auto-nets `to_asset`.
    pub fn convert(
        &mut self,
        party_a: AccountNumber,
        party_b: AccountNumber,
        amount_from: Quantity,
        min_to: Quantity,
    ) -> Quantity {
        self.assert_live();
        assert!(amount_from.value > 0, "convert amount must be positive");
        assert!(
            self.poster == party_a || self.poster == party_b,
            "FX policy poster must be a party to the pair"
        );
        assert!(party_a != party_b, "creditor must differ from debtor");

        let conn = Connection::net_leftover(party_a, party_b, self.from_asset)
            .expect("nothing to convert in from_asset");
        let take = amount_from.value.min(conn.forward().value);
        assert!(take > 0, "nothing to convert in from_asset");
        self.spend(Quantity::new(take));
        let creditor = conn.creditor;
        let debtor = conn.debtor;
        let to_qty = conn.rebook(
            Quantity::new(take),
            min_to,
            self.to_asset,
            self.fee_fixed,
            self.fx_rate,
            self.to_interest_rate,
        );
        emit_pair_activity(
            creditor,
            debtor,
            self.from_asset,
            "convert",
            Quantity::new(take),
            to_qty,
            self.to_asset,
            0,
            "",
        );
        to_qty
    }
}
