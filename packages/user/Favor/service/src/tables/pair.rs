use psibase::{services::tokens::Quantity, AccountNumber, Table};

use super::assert_account_exists;
use crate::tables::tables::{Asset, Line, Pair, PairTable};

/// `low` is the account with the smaller account number.
fn order(a: AccountNumber, b: AccountNumber) -> (AccountNumber, AccountNumber) {
    if a.value < b.value {
        (a, b)
    } else {
        (b, a)
    }
}

fn to_i64(amount: u64) -> i64 {
    i64::try_from(amount).expect("claim amount exceeds the balance range")
}

impl Pair {
    fn get(low: AccountNumber, high: AccountNumber, asset_id: u16) -> Option<Self> {
        PairTable::read().get_index_pk().get(&(low, high, asset_id))
    }

    /// The row between `a` and `b`, or an empty one. `creditor_is_low` is
    /// whether `a` is the low side.
    fn load(a: AccountNumber, b: AccountNumber, asset_id: u16) -> (Self, bool) {
        assert!(a != b, "a pair needs two accounts");
        let (low, high) = order(a, b);
        let row = Self::get(low, high, asset_id).unwrap_or(Self {
            low,
            high,
            asset_id,
            balance: 0,
            low_line: None,
            high_line: None,
        });
        (row, a == low)
    }

    /// Erase the row when nothing is left on it.
    fn store(&self) {
        let table = PairTable::read_write();
        if self.balance == 0 && self.low_line.is_none() && self.high_line.is_none() {
            table.erase(&(self.low, self.high, self.asset_id));
        } else {
            table.put(self).unwrap();
        }
    }

    /// What the debtor owes the creditor. `creditor_is_low` names the creditor.
    fn owed(&self, creditor_is_low: bool) -> u64 {
        match (creditor_is_low, self.balance) {
            (true, b) if b > 0 => b.unsigned_abs(),
            (false, b) if b < 0 => b.unsigned_abs(),
            _ => 0,
        }
    }

    fn line_of(&self, creditor_is_low: bool) -> Option<Line> {
        if creditor_is_low {
            self.low_line
        } else {
            self.high_line
        }
    }

    fn set_line_of(&mut self, creditor_is_low: bool, line: Option<Line>) {
        if creditor_is_low {
            self.low_line = line;
        } else {
            self.high_line = line;
        }
    }

    /// Move the balance toward `creditor`.
    fn add_claim(&mut self, creditor_is_low: bool, amount: u64) {
        let delta = to_i64(amount);
        let next = if creditor_is_low {
            self.balance.checked_add(delta)
        } else {
            self.balance.checked_sub(delta)
        };
        self.balance = next
            .filter(|b| *b != i64::MIN)
            .expect("claim balance overflow");
    }

    /// Move the balance toward zero from `creditor`'s side.
    fn remove_claim(&mut self, creditor_is_low: bool, amount: u64) {
        assert!(
            amount <= self.owed(creditor_is_low),
            "insufficient claim exposure"
        );
        let delta = to_i64(amount);
        self.balance = if creditor_is_low {
            self.balance - delta
        } else {
            self.balance + delta
        };
    }

    /// What `debtor` owes `creditor` in `asset_id`.
    pub fn exposure(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Quantity {
        let (low, high) = order(creditor, debtor);
        let owed = Self::get(low, high, asset_id)
            .map(|row| row.owed(creditor == low))
            .unwrap_or(0);
        owed.into()
    }

    /// `creditor`'s line to `debtor`, if one is posted.
    pub fn line(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Option<Line> {
        let (low, high) = order(creditor, debtor);
        Self::get(low, high, asset_id).and_then(|row| row.line_of(creditor == low))
    }

    /// Both claims and `creditor`'s line to `debtor`, from one read.
    /// Returns `(line, forward, reverse)`: forward is what `debtor` owes
    /// `creditor`, reverse is what `creditor` owes `debtor`.
    pub fn snapshot(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
    ) -> (Option<Line>, Quantity, Quantity) {
        let (low, high) = order(creditor, debtor);
        let Some(row) = Self::get(low, high, asset_id) else {
            return (None, 0.into(), 0.into());
        };
        let creditor_is_low = creditor == low;
        (
            row.line_of(creditor_is_low),
            row.owed(creditor_is_low).into(),
            row.owed(!creditor_is_low).into(),
        )
    }

    /// Every row that involves `account`, in either position.
    pub fn involving(account: AccountNumber) -> Vec<Self> {
        let lo = AccountNumber::new(0);
        let hi = AccountNumber::new(u64::MAX);
        let table = PairTable::read();
        let mut rows: Vec<Self> = table
            .get_index_pk()
            .range((account, lo, 0)..=(account, hi, u16::MAX))
            .collect();
        rows.extend(
            table
                .get_index_by_high()
                .range((account, lo, 0)..=(account, hi, u16::MAX)),
        );
        rows
    }

    /// Book `amount` as a claim of `creditor` on `debtor`. A claim that meets
    /// the reverse claim cancels it first, so the pair never owes both ways.
    /// `new_draw` is the part of `amount` that is new line use: it must fit
    /// the creditor's line and, on a depleting line, spends `remaining`.
    /// Returns what the reverse claim absorbed.
    pub(crate) fn apply(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
        new_draw: u64,
    ) -> Quantity {
        assert!(amount.value > 0, "amount must be positive");
        let (mut row, creditor_is_low) = Self::load(creditor, debtor, asset_id);
        if new_draw > 0 {
            let mut line = row
                .line_of(creditor_is_low)
                .expect("credit line required for new draw");
            if line.deplete_on_debit {
                assert!(new_draw <= line.remaining.value, "insufficient remaining");
                line.remaining = (line.remaining.value - new_draw).into();
                row.set_line_of(creditor_is_low, Some(line));
            }
        }
        let netted = amount.value.min(row.owed(!creditor_is_low));
        row.add_claim(creditor_is_low, amount.value);
        row.store();
        netted.into()
    }

    /// Book `amount` with no line check. Returns what the reverse claim absorbed.
    pub fn credit(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
    ) -> Quantity {
        Self::apply(creditor, debtor, asset_id, amount, 0)
    }

    /// Reduce `creditor`'s claim on `debtor` by `amount`. Fails past what is owed.
    pub fn reduce(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16, amount: Quantity) {
        if amount.value == 0 {
            return;
        }
        let (mut row, creditor_is_low) = Self::load(creditor, debtor, asset_id);
        row.remove_claim(creditor_is_low, amount.value);
        row.store();
    }

    /// Creditor write-off: reduce what `debtor` owes `creditor` by
    /// `min(amount, exposure)`. Returns what was written off.
    pub fn forgive(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        amount: Quantity,
    ) -> Quantity {
        assert!(creditor != debtor, "cannot forgive self");
        assert!(amount.value > 0, "forgive amount must be positive");
        let take = Self::exposure(creditor, debtor, asset_id)
            .value
            .min(amount.value);
        Self::reduce(creditor, debtor, asset_id, take.into());
        take.into()
    }

    /// Post or replace `creditor`'s line to `debtor`.
    pub fn set_line(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        limit: Quantity,
        deplete_on_debit: bool,
    ) {
        assert!(creditor != debtor, "cannot set credit line to self");
        assert_account_exists(debtor);
        Asset::get_assert(asset_id);
        let (mut row, creditor_is_low) = Self::load(creditor, debtor, asset_id);
        let line = match row.line_of(creditor_is_low) {
            // While revolving, remaining tracks the limit so the first
            // depleting switch still has a budget. Once the line is depleting,
            // or remaining has moved off the limit, only clamp it down.
            // remaining == 0 is a spent budget, not an unset one.
            Some(old) => {
                let track = !old.deplete_on_debit && old.remaining.value == old.limit.value;
                let remaining = if track || old.remaining.value > limit.value {
                    limit
                } else {
                    old.remaining
                };
                Line {
                    limit,
                    deplete_on_debit,
                    remaining,
                }
            }
            None => Line {
                limit,
                deplete_on_debit,
                remaining: limit,
            },
        };
        row.set_line_of(creditor_is_low, Some(line));
        row.store();
    }

    /// Erase the line. The balance is untouched.
    pub fn remove_line(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
        let (mut row, creditor_is_low) = Self::load(creditor, debtor, asset_id);
        assert!(
            row.line_of(creditor_is_low).is_some(),
            "credit line not found: creditor={}, debtor={}, asset_id={}",
            creditor,
            debtor,
            asset_id
        );
        row.set_line_of(creditor_is_low, None);
        row.store();
    }
}
