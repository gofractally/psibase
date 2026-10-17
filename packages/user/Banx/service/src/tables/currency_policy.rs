use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{apply_rate, emit_pair_activity, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, CurrencyPolicy, CurrencyPolicyTab, Obligation};

impl CurrencyPolicy {
    fn save(&self) {
        CurrencyPolicyTab::read_write().put(self).unwrap();
    }

    pub fn get(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
    ) -> Option<Self> {
        CurrencyPolicyTab::read().get_index_pk().get(&(
            poster,
            from_asset,
            to_asset,
            poster_is_creditor,
        ))
    }

    pub fn get_assert(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
    ) -> Self {
        Self::get(poster, from_asset, to_asset, poster_is_creditor)
            .expect("CurrencyPolicy not found")
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    pub(crate) fn assert_live(&self) {
        assert!(self.is_live(), "currency policy expired");
    }

    /// Path sizing. Fee is subtracted: the middle man owes less onward than
    /// they are owed on the incoming hop. Creditor-side rows only.
    pub fn apply(&self, amount_from: Quantity) -> Quantity {
        self.assert_live();
        assert!(
            self.poster_is_creditor,
            "path fx requires the creditor-side policy"
        );
        apply_rate(amount_from, self.fee_fixed, self.fx_rate)
    }

    /// Poster posts one side of a from→to offer.
    pub fn upsert(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
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
            poster_is_creditor,
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
        CurrencyPolicyTab::read_write().erase(&(
            self.poster,
            self.from_asset,
            self.to_asset,
            self.poster_is_creditor,
        ));
    }

    /// Take `poster`'s quote for the leftover from-asset debt with `taker`.
    /// Loads only the side that matches that debt. A quote for the other
    /// side does not apply. Missing quote does not net a one-way book.
    pub fn take(
        taker: AccountNumber,
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        amount_from: Quantity,
        min_to: Quantity,
    ) -> Quantity {
        assert!(taker != poster, "cannot convert with self");
        assert!(amount_from.value > 0, "convert amount must be positive");
        let taker_is_owed = Obligation::exposure(taker, poster, from_asset).value;
        let poster_is_owed = Obligation::exposure(poster, taker, from_asset).value;
        assert!(
            taker_is_owed > 0 || poster_is_owed > 0,
            "nothing to convert in from_asset"
        );
        let poster_is_creditor = if taker_is_owed > 0 && poster_is_owed > 0 {
            Connection::net_leftover(taker, poster, from_asset)
                .expect("nothing to convert in from_asset")
                .creditor
                == poster
        } else {
            poster_is_owed > 0
        };
        Self::get_assert(poster, from_asset, to_asset, poster_is_creditor).convert(
            taker,
            poster,
            amount_from,
            min_to,
        )
    }

    /// Rebook leftover `from_asset` between the two parties into
    /// `to_asset` at this row's rate. The row's side must match the
    /// leftover debt. Nets `from_asset` once, then auto-nets `to_asset`.
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
        assert!(
            (conn.creditor == self.poster) == self.poster_is_creditor,
            "currency policy is for the other debt direction"
        );
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
            self.poster_is_creditor,
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
