use psibase::services::tokens::Quantity;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{AccountNumber, Table};

use crate::tables::tables::{Config, Tribute, TributeTable};

impl Tribute {
    pub fn get_by_id(id: u32) -> Option<Self> {
        let table = TributeTable::new();
        table.get_index_pk().get(&id)
    }

    pub fn get(fractal: AccountNumber, member: AccountNumber) -> Option<Self> {
        let table = TributeTable::new();
        table
            .get_index_by_fractal_membership()
            .get(&(fractal, member))
    }

    fn new(fractal: AccountNumber, member: AccountNumber, amount: Quantity, rate_ppm: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            id: Config::gen_id(),
            member,
            created_at: now,
            remaining: amount,
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
        let table = TributeTable::new();
        table.put(&self).unwrap();
    }
}
