use psibase::{services::tokens::Quantity, AccountNumber};

use super::{apply_rate, emit_path_draw};
use crate::tables::tables::{Line, Pair};

/// Directed pair in one asset: the creditor's line to the debtor (if any)
/// plus both claims. A snapshot of one [`Pair`] row, not a table.
///
/// A path hop is this object: `debtor` draws on `creditor`. The reverse
/// claim (creditor already owes debtor) is unwind capacity and does not
/// need a line. Sending 1000 against a 400 reverse claim is unwind 400 +
/// new_draw 600; after the write the debtor owes 600.
#[derive(Clone, Debug)]
pub struct Connection {
    pub creditor: AccountNumber,
    pub debtor: AccountNumber,
    pub asset_id: u16,
    line: Option<Line>,
    /// Debtor already owes creditor.
    forward: Quantity,
    /// Creditor already owes debtor (unwind).
    reverse: Quantity,
}

impl Connection {
    /// Snapshot line + live exposures.
    pub fn get_live(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Self {
        let (line, forward, reverse) = Pair::snapshot(creditor, debtor, asset_id);
        Self {
            creditor,
            debtor,
            asset_id,
            line,
            forward,
            reverse,
        }
    }

    pub fn line(&self) -> Option<&Line> {
        self.line.as_ref()
    }

    pub fn forward(&self) -> Quantity {
        self.forward
    }

    pub fn reverse(&self) -> Quantity {
        self.reverse
    }

    pub fn line_headroom(&self) -> u64 {
        let Some(line) = &self.line else {
            return 0;
        };
        let vs_limit = line.limit.value.saturating_sub(self.forward.value);
        if line.deplete_on_debit {
            vs_limit.min(line.remaining.value)
        } else {
            vs_limit
        }
    }

    /// Reverse claim plus unused line headroom.
    pub fn capacity(&self) -> u64 {
        self.reverse.value.saturating_add(self.line_headroom())
    }

    /// Slice of `amount` that is new line capacity (not unwind).
    pub fn new_draw(&self, amount: Quantity) -> u64 {
        amount.value.saturating_sub(self.reverse.value)
    }

    /// Consent for `them` to become (or remain) a creditor of `who`.
    ///
    /// True if `who` lined `them` (0-limit is enough) or `who` already owes
    /// `them`. Not if only `them` owes `who` — anyone can create that with
    /// `deposit`. A hop that only unwinds such a reverse claim is allowed
    /// separately (`new_draw == 0`).
    pub fn knows(who: AccountNumber, them: AccountNumber, asset_id: u16) -> bool {
        let connection = Self::get_live(who, them, asset_id);
        connection.line.is_some() || connection.reverse.value > 0
    }

    /// The direction that is owed between `a` and `b`, if either is.
    pub fn leftover(a: AccountNumber, b: AccountNumber, asset_id: u16) -> Option<Self> {
        if Pair::exposure(a, b, asset_id).value > 0 {
            Some(Self::get_live(a, b, asset_id))
        } else if Pair::exposure(b, a, asset_id).value > 0 {
            Some(Self::get_live(b, a, asset_id))
        } else {
            None
        }
    }

    /// Book a deposit: this creditor is owed `amount` by this debtor. No
    /// line required. Returns what the reverse claim absorbed.
    pub fn deposit(self, amount: Quantity) -> Quantity {
        assert!(amount.value > 0, "deposit amount must be positive");
        Pair::credit(self.creditor, self.debtor, self.asset_id, amount)
    }

    /// Book `amount` on this directed pair for a trade.
    ///
    /// Same capacity rules as a path draw. Does not emit a path hop: the
    /// caller records the trade.
    pub fn book(self, amount: Quantity) {
        assert!(amount.value > 0, "trade amount must be positive");
        assert!(
            amount.value <= self.capacity(),
            "insufficient path capacity (line + reverse claim)"
        );
        let new_draw = self.new_draw(amount);
        Pair::apply(self.creditor, self.debtor, self.asset_id, amount, new_draw);
    }

    /// To-asset a rebook of `take` would book, without moving claims.
    ///
    /// Same fee rule as [`Self::rebook`]. `add_fee` puts the fee on top of
    /// `take`. Otherwise the fee comes out of `take`.
    pub fn priced(
        &self,
        take: Quantity,
        fee_fixed: Quantity,
        fx_rate: u64,
        add_fee: bool,
    ) -> Quantity {
        let (priced, fee) = if add_fee {
            let gross = take
                .value
                .checked_add(fee_fixed.value)
                .expect("rate conversion failed");
            (Quantity::new(gross), Quantity::new(0))
        } else {
            (take, fee_fixed)
        };
        apply_rate(priced, fee, fx_rate)
    }

    /// Reduce this claim by `take` and book the same pair in `to_asset`.
    ///
    /// `add_fee` prices the poster's fee on top of `take` (they are owed the
    /// from-asset): `apply_rate` sees `take + fee` and a zero fee. Otherwise
    /// the fee is taken out of `take`. The claim still shrinks by `take`.
    ///
    /// `min_to` is an unsigned quantity. `add_fee` means the taker owes the
    /// new amount, so a positive `min_to` caps it and zero leaves that debt
    /// uncapped. The other direction receives the claim, and `min_to` is a
    /// floor.
    pub fn rebook(
        self,
        take: Quantity,
        min_to: Quantity,
        to_asset: u16,
        fee_fixed: Quantity,
        fx_rate: u64,
        add_fee: bool,
    ) -> Quantity {
        assert!(take.value > 0, "convert amount must be positive");
        Pair::reduce(self.creditor, self.debtor, self.asset_id, take);
        let to_qty = self.priced(take, fee_fixed, fx_rate, add_fee);
        if add_fee {
            // A floor would accept a replaced higher rate: the taker owes more
            // than they signed. Zero stays open so existing takes can pass it.
            if min_to.value > 0 {
                assert!(to_qty.value <= min_to.value, "convert output above min_to");
            }
        } else {
            assert!(to_qty.value >= min_to.value, "convert output below min_to");
        }
        Pair::credit(self.creditor, self.debtor, to_asset, to_qty);
        to_qty
    }

    /// Buyer (this creditor) taking `amount` of `seller`'s claim on this
    /// debtor. New exposure needs a buyer line and is capped like
    /// [`Self::draw`] (`capacity` = reverse + headroom). Remaining is consumed
    /// only on [`Self::new_draw`]. A take that only unwinds a reverse claim
    /// needs no line.
    pub fn accept_claim(self, seller: AccountNumber, amount: Quantity) {
        assert!(amount.value > 0, "claim transfer amount must be positive");
        assert!(seller != self.creditor, "cannot transfer claims to self");
        let new_draw = self.new_draw(amount);
        if new_draw > 0 {
            assert!(self.line.is_some(), "buyer has no credit line to debtor");
            assert!(
                amount.value <= self.capacity(),
                "buyer credit line capacity insufficient for claim"
            );
        }
        assert!(
            Pair::exposure(seller, self.debtor, self.asset_id).value >= amount.value,
            "insufficient claim exposure to transfer"
        );
        Pair::reduce(seller, self.debtor, self.asset_id, amount);
        Pair::apply(self.creditor, self.debtor, self.asset_id, amount, new_draw);
    }

    /// Unwind reverse claim, then new line capacity. Remaining is
    /// consumed only for [`Self::new_draw`]. Returns amount netted.
    pub(crate) fn apply_draw(self, amount: Quantity) -> Quantity {
        assert!(amount.value > 0, "path debit amount must be positive");
        assert!(
            amount.value <= self.capacity(),
            "insufficient path capacity (line + reverse claim)"
        );
        let new_draw = self.new_draw(amount);
        Pair::apply(self.creditor, self.debtor, self.asset_id, amount, new_draw)
    }

    /// Draw for `path_pay`. `payer` started the path. This connection's
    /// debtor is the hop.
    pub fn draw(self, amount: Quantity, payer: AccountNumber) {
        let creditor = self.creditor;
        let debtor = self.debtor;
        let asset_id = self.asset_id;
        let netted = self.apply_draw(amount);
        emit_path_draw(payer, creditor, debtor, asset_id, amount, netted);
    }
}
