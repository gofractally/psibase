mod evaluation_instance;
mod fractal;
pub mod member;
mod score;

#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, TimePointSec, ToSchema};

    use serde::{Deserialize, Serialize};

    use crate::tables::evaluation_instance::EvalTypeU8;
    use crate::tables::member::StatusU8;

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }
    }

    #[table(name = "MemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Member {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub member_status: StatusU8,
    }

    impl Member {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.account, self.fractal)
        }
    }

    #[table(name = "EvaluationInstanceTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct EvaluationInstance {
        pub fractal: AccountNumber,
        pub eval_type: EvalTypeU8,
        pub interval: u32,
        pub evaluation_id: u32,
    }

    impl EvaluationInstance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, EvalTypeU8) {
            (self.fractal, self.eval_type)
        }

        #[secondary_key(1)]
        pub fn by_evaluation(&self) -> u32 {
            self.evaluation_id
        }
    }

    #[table(name = "ScoreTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Score {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub eval_type: EvalTypeU8,
        pub value: u32,
        pub pending: Option<u32>,
    }

    impl Score {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, EvalTypeU8) {
            (self.fractal, self.account, self.eval_type)
        }
    }
}
