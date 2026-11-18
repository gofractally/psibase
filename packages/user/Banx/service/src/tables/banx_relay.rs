use psibase::{services::tokens::Quantity, AccountNumber, Table};

use crate::math::{try_swap_in, try_swap_out, PPM_SCALE};
use crate::tables::tables::{Asset, BanxRelay, BanxRelayTable};

fn ordered(a: u16, b: u16) -> (u16, u16) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

impl BanxRelay {
    fn save(&self) {
        BanxRelayTable::read_write().put(self).unwrap();
    }

    pub fn get(owner: AccountNumber, asset_a: u16, asset_b: u16) -> Option<Self> {
        let (lo, hi) = ordered(asset_a, asset_b);
        BanxRelayTable::read().get_index_pk().get(&(owner, lo, hi))
    }

    pub fn upsert(
        owner: AccountNumber,
        asset_a: u16,
        reserve_a: Quantity,
        asset_b: u16,
        reserve_b: Quantity,
        fee_ppm: u32,
    ) {
        assert!(asset_a != asset_b, "relay assets must differ");
        assert!(reserve_a.value > 0, "relay reserve must be positive");
        assert!(reserve_b.value > 0, "relay reserve must be positive");
        assert!(fee_ppm < PPM_SCALE, "relay fee must be under 100%");
        Asset::get_assert(asset_a);
        Asset::get_assert(asset_b);
        let (asset_lo, asset_hi, reserve_lo, reserve_hi) = if asset_a < asset_b {
            (asset_a, asset_b, reserve_a, reserve_b)
        } else {
            (asset_b, asset_a, reserve_b, reserve_a)
        };
        Self {
            owner,
            asset_lo,
            asset_hi,
            reserve_lo,
            reserve_hi,
            fee_ppm,
        }
        .save();
    }

    pub fn remove(&self) {
        BanxRelayTable::read_write().erase(&(self.owner, self.asset_lo, self.asset_hi));
    }

    fn reserves_for(&self, from_asset: u16) -> (u64, u64) {
        if from_asset == self.asset_lo {
            (self.reserve_lo.value, self.reserve_hi.value)
        } else if from_asset == self.asset_hi {
            (self.reserve_hi.value, self.reserve_lo.value)
        } else {
            panic!("relay does not price this asset");
        }
    }

    fn store(&mut self, from_asset: u16, reserve_in: u64, reserve_out: u64) {
        if from_asset == self.asset_lo {
            self.reserve_lo = Quantity::new(reserve_in);
            self.reserve_hi = Quantity::new(reserve_out);
        } else {
            self.reserve_hi = Quantity::new(reserve_in);
            self.reserve_lo = Quantity::new(reserve_out);
        }
    }

    /// Move this copy's reserves. Does not save. `None` when the curve cannot pay.
    pub(crate) fn apply_out(&mut self, from_asset: u16, amount_in: u64) -> Option<u64> {
        let (reserve_in, reserve_out) = self.reserves_for(from_asset);
        let out = try_swap_out(reserve_in, reserve_out, amount_in, self.fee_ppm)?;
        let reserve_in = reserve_in.checked_add(amount_in)?;
        let reserve_out = reserve_out.checked_sub(out)?;
        self.store(from_asset, reserve_in, reserve_out);
        Some(out)
    }

    /// Price `amount_in` of `from_asset` and move the virtual reserves.
    pub fn swap_out(&mut self, from_asset: u16, amount_in: Quantity) -> Quantity {
        let out = self
            .apply_out(from_asset, amount_in.value)
            .expect("relay swap produced nothing");
        self.save();
        out.into()
    }

    /// Smallest `from_asset` input that yields at least `amount_out` of the other asset.
    /// Does not move reserves. `amount_out` is in the asset that is not `from_asset`.
    pub fn swap_in(&self, from_asset: u16, amount_out: Quantity) -> Quantity {
        let (reserve_in, reserve_out) = self.reserves_for(from_asset);
        let amount_in = try_swap_in(reserve_in, reserve_out, amount_out.value, self.fee_ppm)
            .expect("relay cannot produce that output");
        amount_in.into()
    }
}
