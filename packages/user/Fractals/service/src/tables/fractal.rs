use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

use crate::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable};

use psibase::services::transact::Wrapper as TransactSvc;

impl Fractal {
    fn new(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            account,
            created_at: now,
            mission,
            name,
            judiciary: genesis_guild,
            legislature: genesis_guild,
        }
    }

    pub fn add(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) {
        Self::new(account, name, mission, genesis_guild).save();
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        FractalTable::read().get_index_pk().get(&(fractal))
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "fractal does not exist")
    }

    fn save(&self) {
        FractalTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn members(&self) -> Vec<FractalMember> {
        FractalMemberTable::read()
            .get_index_pk()
            .range(
                (self.account, AccountNumber::new(0))
                    ..=(self.account, AccountNumber::new(u64::MAX)),
            )
            .collect()
    }
}

#[ComplexObject]
impl Fractal {
    async fn memberships(&self) -> Vec<FractalMember> {
        self.members()
    }
}
