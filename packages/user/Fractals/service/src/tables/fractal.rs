use async_graphql::ComplexObject;
use psibase::{check, check_some, AccountNumber, Table};

use crate::tables::tables::{
    EvalType, EvaluationInstance, Fractal, FractalTable, Member, MemberTable,
};

use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::services::transact::Wrapper as TransactSvc;

impl Fractal {
    fn new(account: AccountNumber, name: String, mission: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();
        let supply = Quantity::from(210000000000000);
        let token_id = Tokens::call().create(4.try_into().unwrap(), supply);
        let half_life_seconds = 999 as u32;

        Tokens::call().mint(
            token_id,
            supply,
            "Token setup".to_string().try_into().unwrap(),
        );
        Tokens::call().credit(
            token_id,
            "token-stream".into(),
            supply,
            "Token setup".to_string().try_into().unwrap(),
        );

        let token_stream_id = TokenStream::call().create(half_life_seconds, token_id);
        TokenStream::call().deposit(token_stream_id, supply);

        Self {
            account,
            created_at: now,
            mission,
            name,
            token_id,
            half_life_seconds,
            token_stream_id,
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

    pub fn set_half_life(&mut self, seconds: u32) {
        check(seconds > 0, "seconds must be above 0");
        self.half_life_seconds = seconds;
        self.save();
    }
}

#[ComplexObject]
impl Fractal {
    pub async fn council(&self) -> Vec<AccountNumber> {
        vec![psibase::services::auth_delegate::Wrapper::call().getOwner(self.account)]
    }
}
