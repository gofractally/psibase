use psibase::{abort_message, check_some, AccountNumber, Table};

use crate::tables::evaluation_instance::EvalType;
use crate::tables::tables::{Fractal, FractalTable, Member, MemberTable, Score};

use async_graphql::ComplexObject;
use psibase::services::transact::Wrapper as TransactSvc;

#[derive(PartialEq)]
pub enum MemberStatus {
    Visa = 1,
    Citizen = 2,
    Exiled = 3,
}

pub type StatusU8 = u8;

impl From<StatusU8> for MemberStatus {
    fn from(status: StatusU8) -> Self {
        match status {
            1 => MemberStatus::Visa,
            2 => MemberStatus::Citizen,
            3 => MemberStatus::Exiled,
            _ => abort_message("invalid member status"),
        }
    }
}

#[ComplexObject]
impl Member {
    pub async fn fractal_details(&self) -> Fractal {
        FractalTable::with_service(crate::Wrapper::SERVICE)
            .get_index_pk()
            .get(&self.fractal)
            .unwrap()
    }
}

impl Member {
    fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();
        Self {
            account,
            fractal,
            created_at: now,
            member_status: status as StatusU8,
        }
    }

    pub fn add(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        let new_instance = Self::new(fractal, account, status);
        new_instance.save();

        new_instance.initialize_score(EvalType::Repuation);
        new_instance.initialize_score(EvalType::Favor);

        new_instance
    }

    pub fn initialize_score(&self, eval_type: EvalType) {
        Score::add(self.fractal, eval_type, self.account);
    }

    pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Member> {
        let table = MemberTable::new();
        table.get_index_pk().get(&(fractal, account))
    }

    pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        check_some(Self::get(fractal, account), "member does not exist")
    }

    fn save(&self) {
        let table = MemberTable::new();
        table.put(&self).expect("failed to save");
    }
}
