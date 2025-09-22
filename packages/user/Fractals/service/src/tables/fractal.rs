use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

use crate::tables::evaluation_instance::EvalType;
use crate::tables::tables::{EvaluationInstance, Fractal, FractalTable, Member, MemberTable};

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
        Self::new(account, name, mission).save();
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        let table = FractalTable::new();
        table.get_index_pk().get(&(fractal))
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "fractal does not exist")
    }

    fn save(&self) {
        let table = FractalTable::new();
        table.put(&self).expect("failed to save");
    }

    pub fn members(&self) -> Vec<Member> {
        let table = MemberTable::new();
        table
            .get_index_pk()
            .range(
                (self.account, AccountNumber::new(0))
                    ..=(self.account, AccountNumber::new(u64::MAX)),
            )
            .collect()
    }

    pub fn set_schedule(
        &self,
        eval_type: EvalType,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        EvaluationInstance::set_evaluation_schedule(
            self.account,
            eval_type,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }
}

#[ComplexObject]
impl Fractal {
    pub async fn council(&self) -> Vec<AccountNumber> {
        vec![psibase::services::auth_delegate::Wrapper::call().getOwner(self.account)]
    }
}
