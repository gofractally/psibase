use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{apply_spread, assert_account_exists, emit_pair_activity, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, ClaimOffer, ClaimOfferTab};

impl ClaimOffer {
    pub const GLOBAL: AccountNumber = AccountNumber::new(0);
    pub const BUY: u8 = 1;
    pub const SELL: u8 = 2;

    fn save(&self) {
        ClaimOfferTab::read_write().put(self).unwrap();
    }

    fn get(poster: AccountNumber, debtor: AccountNumber, asset_id: u16, side: u8) -> Option<Self> {
        ClaimOfferTab::read()
            .get_index_pk()
            .get(&(poster, debtor, asset_id, side))
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    pub fn is_buy(&self) -> bool {
        self.side == Self::BUY
    }

    pub fn is_sell(&self) -> bool {
        self.side == Self::SELL
    }

    /// Live specific offer, else live global, same `side`.
    pub fn get_assert(
        poster: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        side: u8,
    ) -> Self {
        if let Some(p) = Self::get(poster, debtor, asset_id, side) {
            if p.is_live() {
                return p;
            }
        }
        if let Some(g) = Self::get(poster, Self::GLOBAL, asset_id, side) {
            if g.is_live() {
                return g;
            }
        }
        panic!("ClaimOffer not found (no live specific or global offer on this side)");
    }

    pub fn is_global(&self) -> bool {
        self.debtor == Self::GLOBAL
    }

    fn assert_side(side: u8) {
        assert!(
            side == Self::BUY || side == Self::SELL,
            "claim offer side must be buy (1) or sell (2)"
        );
    }

    pub fn upsert(
        poster: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        side: u8,
        fee_fixed: Quantity,
        fee_percent: i32,
        expires_at: TimePointSec,
    ) {
        Self::assert_side(side);
        let _ = Asset::get_assert(asset_id);
        if debtor != Self::GLOBAL {
            assert_account_exists(debtor);
        }
        let scale = PPM_SCALE as i64;
        assert!(
            (fee_percent as i64) > -scale && (fee_percent as i64) < scale,
            "claim-offer spread must be between -100% and 100%"
        );
        Self {
            poster,
            debtor,
            asset_id,
            side,
            fee_fixed,
            fee_percent,
            expires_at,
        }
        .save();
    }

    pub fn remove(poster: AccountNumber, debtor: AccountNumber, asset_id: u16, side: u8) {
        Self::assert_side(side);
        assert!(
            Self::get(poster, debtor, asset_id, side).is_some(),
            "claim offer not found"
        );
        ClaimOfferTab::read_write().erase(&(poster, debtor, asset_id, side));
    }

    /// Seller proceeds. Buy posts use the raw spread (positive haircuts
    /// the seller). Sell posts flip the sign so **positive is the
    /// poster's profit** (`+10_000` = 1% over face).
    pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
        let spread = if self.is_sell() {
            self.fee_percent.checked_neg().expect("sell spread negate")
        } else {
            self.fee_percent
        };
        apply_spread(amount_in, self.fee_fixed, spread)
    }

    /// Move `amount` of seller's claim on `debtor` to `buyer`; seller
    /// receives face after this offer's spread as a claim on buyer.
    pub fn execute(
        &self,
        seller: AccountNumber,
        buyer: AccountNumber,
        debtor: AccountNumber,
        amount: Quantity,
        kind: &str,
    ) {
        assert!(seller != buyer, "cannot transfer claim to self");
        assert!(seller != debtor, "cannot transfer claim on self as debtor");
        assert!(buyer != debtor, "buyer cannot be the debtor");
        assert!(amount.value > 0, "claim transfer amount must be positive");

        assert!(
            Connection::knows(debtor, buyer, self.asset_id),
            "debtor does not know buyer (no credit line or live claim)"
        );

        Connection::get(buyer, debtor, self.asset_id).accept_claim(seller, amount);
        let proceeds = self.apply_fees(amount);
        Connection::get(seller, buyer, self.asset_id).deposit(proceeds, 0);

        emit_pair_activity(
            seller,
            buyer,
            self.asset_id,
            kind,
            amount,
            proceeds,
            self.asset_id,
            0,
            "",
        );
    }
}
