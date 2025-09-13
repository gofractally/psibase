use psibase::services::tokens::{Memo, Quantity};
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{AccountNumber, Table};

use crate::tables::tables::{Config, Fractal, Tribute, TributeTable};

impl Tribute {
    pub fn get(id: u32) -> Option<Self> {
        let table = TributeTable::new();
        table.get_index_pk().get(&id)
    }

    fn new(
        fractal: AccountNumber,
        member: AccountNumber,
        amount: Quantity,
        rate_ppm: u32,
        recipient: AccountNumber,
        memo: Memo,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            id: Config::gen_id(),
            member,
            created_at: now,
            remaining: amount,
            fractal,
            rate_ppm,
            recipient,
            memo,
        }
    }

    pub fn add(
        fractal: AccountNumber,
        account: AccountNumber,
        amount: Quantity,
        rate_ppm: u32,
        recipient: AccountNumber,
        memo: Memo,
    ) -> Self {
        let new_instance = Self::new(fractal, account, amount, rate_ppm, recipient, memo);
        new_instance.save();
        new_instance
    }

    pub fn credit(&mut self, amount: Quantity) {
        self.remaining = self.remaining - amount;
    }

    pub fn payout(&mut self, amount: Quantity) -> Quantity {
        let mut remaining_amount = amount.value;
        let amount_payable = amount.value * self.rate_ppm as u64 / 1000000;

        let amount_sendable = amount_payable
            .min(remaining_amount)
            .min(self.remaining.value);

        if amount_sendable > 0 {
            remaining_amount -= amount_sendable;
            self.remaining = self.remaining - amount_sendable.into();
            let token_id = Fractal::get_assert(self.fractal).token_id;

            psibase::services::tokens::Wrapper::call().credit(
                token_id,
                self.recipient,
                amount_sendable.into(),
                "Tribute payout".to_string().try_into().unwrap(),
            );
        }
        if self.remaining == 0.into() {
            self.delete()
        } else {
            self.save();
        }
        remaining_amount.into()
    }

    fn delete(&self) {
        TributeTable::new().remove(&self);
    }

    fn save(&self) {
        TributeTable::new().put(&self).unwrap();
    }
}
