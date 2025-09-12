use psibase::services::tokens::Quantity;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{AccountNumber, Table};

use crate::tables::tables::{Fine, FineTable};

impl Fine {
    pub fn get(fractal: AccountNumber, member: AccountNumber) -> Option<Self> {
        let table = FineTable::new();
        table.get_index_pk().get(&(fractal, member))
    }

    fn new(fractal: AccountNumber, member: AccountNumber, amount: Quantity, rate_ppm: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            member,
            created_at: now,
            fine_remaining: amount,
            fractal,
            rate_ppm,
        }
    }

    pub fn add(
        fractal: AccountNumber,
        account: AccountNumber,
        amount: Quantity,
        rate_ppm: u32,
    ) -> Self {
        let new_instance = Self::new(fractal, account, amount, rate_ppm);
        new_instance.save();
        new_instance
    }

    fn save(&self) {
        let table = FineTable::new();
        table.put(&self).unwrap();
    }
}
