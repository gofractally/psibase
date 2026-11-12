use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{apply_rate, emit_pair_activity, emit_pair_activity_as, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, FxOffer, FxOfferTab, Obligation};

impl FxOffer {
    fn save(&self) {
        FxOfferTab::read_write().put(self).unwrap();
    }

    pub fn get(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
    ) -> Option<Self> {
        FxOfferTab::read()
            .get_index_pk()
            .get(&(poster, from_asset, to_asset, poster_is_creditor))
    }

    pub fn get_assert(
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
    ) -> Self {
        Self::get(poster, from_asset, to_asset, poster_is_creditor).expect("FxOffer not found")
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    pub(crate) fn assert_live(&self) {
        assert!(self.is_live(), "fx offer expired");
    }

    /// Path sizing. Fee is subtracted: the middle man owes less onward than
    /// they are owed on the incoming hop. Creditor-side rows only.
    pub fn apply(&self, amount_from: Quantity) -> Quantity {
        self.assert_live();
        assert!(
            self.poster_is_creditor,
            "path fx requires the creditor-side offer"
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
        assert!(remaining.value > 0, "fx offer remaining must be positive");
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

    /// Spend from-asset budget. A later post replaces whatever is left.
    /// The last unit deletes the row: an empty order is not a trade.
    pub(crate) fn spend(&mut self, amount: Quantity) {
        self.assert_live();
        assert!(
            amount.value <= self.remaining.value,
            "fx offer amount exceeds remaining"
        );
        self.remaining = self.remaining - amount;
        if self.remaining.value == 0 {
            self.remove();
        } else {
            self.save();
        }
    }

    pub fn remove(&self) {
        FxOfferTab::read_write().erase(&(
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
            "FX offer poster must be a party to the pair"
        );
        assert!(party_a != party_b, "creditor must differ from debtor");

        let conn = Connection::net_leftover(party_a, party_b, self.from_asset)
            .expect("nothing to convert in from_asset");
        assert!(
            (conn.creditor == self.poster) == self.poster_is_creditor,
            "fx offer is for the other debt direction"
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
        // Actor is the debtor of the new claim, same as a take's actor is
        // the one who owes the from-asset. The feed uses that to say which
        // way the rebooked debt faces.
        emit_pair_activity_as(
            debtor,
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

    /// Take the clicked from→to order. `poster_is_creditor` is that row.
    ///
    /// A buy rebooks from-asset the taker still owes the poster. A reverse
    /// claim (the poster already owes the taker) is not that order: the two
    /// legs open, and [`Connection::book_at_rate`] nets it as unwind. A sell
    /// only rebooks from-asset the poster owes the taker. It does not open a
    /// book. Both new claims use the order's APR. Lines are capacity only.
    pub fn take_order(
        taker: AccountNumber,
        poster: AccountNumber,
        from_asset: u16,
        to_asset: u16,
        poster_is_creditor: bool,
        amount_from: Quantity,
        min_to: Quantity,
    ) {
        assert!(taker != poster, "cannot take an order with self");
        assert!(amount_from.value > 0, "trade amount must be positive");
        Obligation::net_pair(taker, poster, from_asset, u64::MAX.into());
        let taker_owes = Obligation::exposure(poster, taker, from_asset).value;
        let poster_owes = Obligation::exposure(taker, poster, from_asset).value;
        if poster_is_creditor && taker_owes > 0 {
            Self::get_assert(poster, from_asset, to_asset, true).convert(
                taker,
                poster,
                amount_from,
                min_to,
            );
            return;
        }
        if !poster_is_creditor {
            assert!(poster_owes > 0, "nothing to convert in from_asset");
            Self::get_assert(poster, from_asset, to_asset, false).convert(
                taker,
                poster,
                amount_from,
                min_to,
            );
            return;
        }

        let mut pol = Self::get_assert(poster, from_asset, to_asset, true);
        let to_qty = pol.apply(amount_from);
        assert!(to_qty.value >= min_to.value, "trade output below min_to");
        pol.spend(amount_from);
        let rate = pol.to_interest_rate as i32;
        Connection::get_live(poster, taker, from_asset).book_at_rate(amount_from, rate);
        Connection::get_live(taker, poster, to_asset).book_at_rate(to_qty, rate);
        emit_pair_activity(
            taker,
            poster,
            from_asset,
            "take",
            amount_from,
            to_qty,
            to_asset,
            0,
            "",
        );
    }
}
