use async_graphql::ComplexObject;
use psibase::{check_some, get_sender, AccountNumber, Table};

use crate::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable};

use psibase::services::auth_delegate::Wrapper as AuthDelegate;
use psibase::services::transact::Wrapper as TransactSvc;

impl Fractal {
    fn new(account: AccountNumber, name: String, mission: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            account,
            created_at: now,
            mission,
            name,
        }
    }

    pub fn add(account: AccountNumber, name: String, mission: String) {
        // TEMP DEV
        if account != "fractal-core".into() {
            AuthDelegate::call().newAccount(account, get_sender());
        }
        // TEMP DEV END
        Self::new(account, name, mission).save();
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
