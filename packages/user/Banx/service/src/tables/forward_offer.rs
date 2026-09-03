use psibase::{services::tokens::Quantity, AccountNumber, Table, TimePointSec};

use super::{apply_hop_fee, assert_account_exists, expires_live, Connection};
use crate::math::PPM_SCALE;
use crate::tables::tables::{Asset, ForwardOffer, ForwardOfferTab};

impl ForwardOffer {
    pub const GLOBAL: AccountNumber = AccountNumber::new(0);

    fn save(&self) {
        ForwardOfferTab::read_write().put(self).unwrap();
    }

    fn get(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) -> Option<Self> {
        ForwardOfferTab::read()
            .get_index_pk()
            .get(&(poster, next_hop, asset_id))
    }

    pub fn get_assert(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) -> Self {
        Self::get(poster, next_hop, asset_id)
            .unwrap_or_else(|| panic!("forward offer not found"))
    }

    pub fn is_live(&self) -> bool {
        expires_live(self.expires_at)
    }

    fn assert_live(&self) {
        assert!(self.is_live(), "forward offer expired");
    }

    /// Closed: poster lined `next_creditor` (0-limit is enough) or already
    /// owes them. Pure unwind (`new_draw == 0`) does not need that.
    fn assert_known(&self, next_creditor: AccountNumber, new_draw: u64) {
        if self.allow_unknown || new_draw == 0 {
            return;
        }
        assert!(
            Connection::knows(self.poster, next_creditor, self.asset_id),
            "unknown counterparty (no credit line or existing debt to them; set allow_unknown or post a 0-limit line)"
        );
    }

    /// Live specific offer, else live global. Panics if neither is live.
    pub fn get_live(poster: AccountNumber, next_hop: AccountNumber, asset_id: u16) -> Self {
        if let Some(p) = Self::get(poster, next_hop, asset_id) {
            if p.is_live() {
                return p;
            }
        }
        if let Some(g) = Self::get(poster, Self::GLOBAL, asset_id) {
            if g.is_live() {
                return g;
            }
        }
        panic!("ForwardOffer not found (no specific or global forward for this asset)");
    }

    pub fn is_global(&self) -> bool {
        self.next_hop == Self::GLOBAL
    }

    pub fn upsert(
        poster: AccountNumber,
        next_hop: AccountNumber,
        asset_id: u16,
        fee_fixed: Quantity,
        fee_percent: u32,
        max_line_apr: u32,
        expires_at: TimePointSec,
        allow_unknown: bool,
    ) {
        assert!(
            max_line_apr <= PPM_SCALE,
            "max_line_apr exceeds 100% (PPM_SCALE)"
        );
        assert!(fee_percent < PPM_SCALE, "fee must be under 100%");
        let _ = Asset::get_assert(asset_id);
        if next_hop != Self::GLOBAL {
            assert_account_exists(next_hop);
        }
        Self {
            poster,
            next_hop,
            asset_id,
            fee_fixed,
            fee_percent,
            max_line_apr,
            expires_at,
            allow_unknown,
        }
        .save();
    }

    pub fn set_allow_unknown(
        poster: AccountNumber,
        next_hop: AccountNumber,
        asset_id: u16,
        allow_unknown: bool,
    ) {
        let mut row = Self::get_assert(poster, next_hop, asset_id);
        row.allow_unknown = allow_unknown;
        row.save();
    }

    pub fn remove(&self) {
        ForwardOfferTab::read_write().erase(&(self.poster, self.next_hop, self.asset_id));
    }

    pub fn apply_fees(&self, amount_in: Quantity) -> Quantity {
        apply_hop_fee(amount_in, self.fee_fixed, self.fee_percent)
    }

    /// Fee then debit next hop's line to poster.
    pub fn path_draw(&self, next_creditor: AccountNumber, amount_in: Quantity) -> Quantity {
        self.assert_live();
        let creditor = if self.is_global() {
            next_creditor
        } else {
            assert!(
                next_creditor == self.next_hop,
                "forward offer next hop mismatch"
            );
            self.next_hop
        };
        let conn = Connection::get_live(creditor, self.poster, self.asset_id);
        let draw = self.apply_fees(amount_in);
        let new_draw = conn.new_draw(draw);
        self.assert_known(creditor, new_draw);
        // APR cap is only on new line capacity, not a pure unwind.
        if new_draw > 0 {
            if let Some(line) = conn.line() {
                assert!(
                    line.interest_rate <= self.max_line_apr,
                    "next hop interest rate exceeds max_line_apr"
                );
            }
        }
        conn.draw(draw);
        draw
    }
}
