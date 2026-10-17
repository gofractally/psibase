use psibase::{services::tokens::Quantity, AccountNumber};

use super::{apply_rate, emit_pair_activity};
use crate::tables::tables::{CreditLine, Obligation};

/// Directed pair in one asset: the creditor's line to the debtor (if any)
/// plus both claims. Virtual — not a table.
///
/// A path hop is this object: `debtor` draws on `creditor`. The reverse
/// claim (creditor already owes debtor) is unwind capacity and does not
/// need a line. Sending 1000 against a 400 reverse claim is unwind 400 +
/// new_draw 600; after net the debtor owes 600.
#[derive(Clone, Debug)]
pub struct Connection {
    pub creditor: AccountNumber,
    pub debtor: AccountNumber,
    pub asset_id: u16,
    line: Option<CreditLine>,
    /// Debtor already owes creditor.
    forward: Quantity,
    /// Creditor already owes debtor (unwind).
    reverse: Quantity,
}

impl Connection {
    /// Snapshot line + live exposures. Does not persist interest.
    pub fn get_live(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Self {
        Self {
            creditor,
            debtor,
            asset_id,
            line: CreditLine::get(creditor, debtor, asset_id),
            forward: Obligation::exposure(creditor, debtor, asset_id),
            reverse: Obligation::exposure(debtor, creditor, asset_id),
        }
    }

    pub fn line(&self) -> Option<&CreditLine> {
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

    /// Credit this directed claim, then auto-net. Returns the amount netted.
    fn credit_and_net(&self, amount: Quantity, interest_rate: i32) -> Quantity {
        Obligation::credit_pair(
            self.creditor,
            self.debtor,
            self.asset_id,
            amount,
            interest_rate,
        );
        Obligation::net_pair(self.creditor, self.debtor, self.asset_id, u64::MAX.into())
    }

    /// Accrue, full-net, return the leftover directed connection.
    pub fn net_leftover(a: AccountNumber, b: AccountNumber, asset_id: u16) -> Option<Self> {
        Obligation::net_pair(a, b, asset_id, u64::MAX.into());
        let ab = Obligation::exposure(a, b, asset_id).value;
        let ba = Obligation::exposure(b, a, asset_id).value;
        if ab > 0 {
            Some(Self::get_live(a, b, asset_id))
        } else if ba > 0 {
            Some(Self::get_live(b, a, asset_id))
        } else {
            None
        }
    }

    /// Book a deposit: this creditor is owed `amount` by this debtor, then
    /// auto-net. No line required.
    /// Debtor-signed deposit. The rate cannot be negative: the creditor does
    /// not sign, and a negative rate would shrink their claim.
    pub fn deposit(self, amount: Quantity, interest_rate: u32) -> Quantity {
        assert!(amount.value > 0, "deposit amount must be positive");
        self.credit_and_net(amount, interest_rate as i32)
    }

    /// Creditor-signed credit. A negative rate is the creditor agreeing that
    /// this claim decays.
    pub fn credit_at_rate(self, amount: Quantity, interest_rate: i32) -> Quantity {
        assert!(amount.value > 0, "credit amount must be positive");
        self.credit_and_net(amount, interest_rate)
    }

    /// Reduce this leftover claim by `take` and credit the same pair in
    /// `to_asset`. Caller must already have netted `from_asset`.
    ///
    /// `add_fee` prices the poster's fee on top of `take` (they are owed the
    /// from-asset): `apply_rate` sees `take + fee` and a zero fee. Otherwise
    /// the fee is taken out of `take`. The claim still shrinks by `take`.
    pub fn rebook(
        self,
        take: Quantity,
        min_to: Quantity,
        to_asset: u16,
        fee_fixed: Quantity,
        fx_rate: u64,
        add_fee: bool,
        to_interest_rate: u32,
    ) -> Quantity {
        assert!(take.value > 0, "convert amount must be positive");
        Obligation::apply_reduction(self.creditor, self.debtor, self.asset_id, take.value);
        let (priced, fee) = if add_fee {
            let gross = take
                .value
                .checked_add(fee_fixed.value)
                .expect("rate conversion failed");
            (Quantity::new(gross), Quantity::new(0))
        } else {
            (take, fee_fixed)
        };
        let to_qty = apply_rate(priced, fee, fx_rate);
        assert!(to_qty.value >= min_to.value, "convert output below min_to");
        Obligation::credit_pair(
            self.creditor,
            self.debtor,
            to_asset,
            to_qty,
            to_interest_rate as i32,
        );
        Obligation::net_pair(self.creditor, self.debtor, to_asset, u64::MAX.into());
        to_qty
    }

    /// Buyer (this creditor) taking `amount` of `seller`'s claim on this
    /// debtor. Offers set the rate; this line is the facility. New exposure
    /// needs a buyer line and is capped like [`Self::draw`] (`capacity` =
    /// reverse + headroom). Remaining is consumed only on [`Self::new_draw`].
    /// A take that only unwinds a reverse claim needs no line.
    pub fn accept_claim(mut self, seller: AccountNumber, amount: Quantity) {
        assert!(amount.value > 0, "claim transfer amount must be positive");
        let new_draw = self.new_draw(amount);
        if new_draw > 0 {
            assert!(self.line.is_some(), "buyer has no credit line to debtor");
            assert!(
                amount.value <= self.capacity(),
                "buyer credit line capacity insufficient for claim"
            );
            self.line
                .as_mut()
                .unwrap()
                .consume_remaining(new_draw.into());
        }
        Obligation::transfer_claims(
            seller,
            self.creditor,
            self.debtor,
            self.asset_id,
            amount.value,
        );
        Obligation::net_pair(self.creditor, self.debtor, self.asset_id, u64::MAX.into());
    }

    /// Unwind reverse claim, then new line capacity. Remaining is
    /// consumed only for [`Self::new_draw`]. Returns amount netted.
    pub(crate) fn apply_draw(mut self, amount: Quantity) -> Quantity {
        assert!(amount.value > 0, "path debit amount must be positive");
        assert!(
            amount.value <= self.capacity(),
            "insufficient path capacity (line + reverse claim)"
        );

        let new_draw = self.new_draw(amount);
        let rate = if new_draw > 0 {
            let line = self
                .line
                .as_mut()
                .expect("credit line required for new path draw");
            line.consume_remaining(Quantity::new(new_draw));
            line.interest_rate as i32
        } else {
            self.line
                .as_ref()
                .map(|l| l.interest_rate as i32)
                .unwrap_or(0)
        };
        self.credit_and_net(amount, rate)
    }

    /// Draw for `path_pay`.
    pub fn draw(self, amount: Quantity) {
        let creditor = self.creditor;
        let debtor = self.debtor;
        let asset_id = self.asset_id;
        let netted = self.apply_draw(amount);
        emit_pair_activity(
            creditor,
            debtor,
            asset_id,
            "path_draw",
            amount,
            netted,
            asset_id,
            0,
            "",
        );
    }
}
