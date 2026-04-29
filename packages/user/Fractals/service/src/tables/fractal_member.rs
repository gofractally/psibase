use std::u64;

use psibase::{check_none, check_some, services::tokens::Quantity, AccountNumber, Memo, Table};

use crate::tables::tables::{
    Fractal, FractalExile, FractalMember, FractalMemberTable, FractalTable, Levy,
};

use async_graphql::ComplexObject;
use psibase::services::transact::Wrapper as TransactSvc;

#[ComplexObject]
impl FractalMember {
    pub async fn fractal_details(&self) -> Fractal {
        FractalTable::with_service(crate::Wrapper::SERVICE)
            .get_index_pk()
            .get(&self.fractal)
            .unwrap()
    }
}

impl FractalMember {
    fn new(fractal: AccountNumber, account: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            account,
            fractal,
            created_at: now,
        }
    }

    pub fn get_all(fractal: AccountNumber) -> Vec<Self> {
        FractalMemberTable::read()
            .get_index_pk()
            .range(&(fractal, AccountNumber::from(0))..&(fractal, AccountNumber::from(u64::MAX)))
            .collect()
    }

    pub fn credit_direct(&self, amount: Quantity, memo: Memo) {
        let token_id = Fractal::get_assert(self.fractal).token_id;
        psibase::services::tokens::Wrapper::call().credit(token_id, self.account, amount, memo)
    }

    pub fn add(fractal: AccountNumber, account: AccountNumber) -> Self {
        check_none(
            FractalExile::get(fractal, account),
            "member has been exiled from this fractal",
        );
        check_none(Self::get(fractal, account), "account is already a member");

        let new_instance = Self::new(fractal, account);
        new_instance.save();

        new_instance
    }

    pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<FractalMember> {
        FractalMemberTable::read()
            .get_index_pk()
            .get(&(fractal, account))
    }

    pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        check_some(Self::get(fractal, account), "member does not exist")
    }

    pub fn exile(&self) {
        FractalExile::add(self.fractal, self.account);
        for levy in Levy::levies_of_member(self.fractal, self.account) {
            levy.delete_by_exile()
        }
        self.remove();
    }

    fn remove(&self) {
        FractalMemberTable::read_write().remove(&self);
    }

    fn save(&self) {
        FractalMemberTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
