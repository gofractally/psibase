mod config;
mod evaluation_instance;
mod fractal;
mod member;
mod score;
mod tribute;

#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::services::nft::NID;
    use psibase::services::tokens::{Quantity, TID};
    use psibase::{abort_message, AccountNumber, Fracpack, TimePointSec, ToSchema};

    use serde::{Deserialize, Serialize};

    use crate::tables::evaluation_instance::EvalTypeU8;

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Fractal {
        #[primary_key]
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,
        pub half_life_seconds: u32,
        pub tourist_fee: Quantity,
        pub worker_fee: Quantity,
        pub citizenship_fee: Quantity,
        pub token_id: TID,
        pub token_stream_id: NID,
    }

    #[derive(PartialEq)]
    pub enum MemberStatus {
        Tourist = 0,
        Worker = 1,
        Citizen = 2,
        Exiled = 3,
    }

    pub type StatusU8 = u8;

    impl From<StatusU8> for MemberStatus {
        fn from(status: StatusU8) -> Self {
            match status {
                0 => MemberStatus::Tourist,
                1 => MemberStatus::Worker,
                2 => MemberStatus::Citizen,
                3 => MemberStatus::Exiled,
                _ => abort_message("invalid member status"),
            }
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
        pub reward_stream_id: TID,
        pub referrer: Option<AccountNumber>,
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

    #[table(name = "TributeTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Tribute {
        pub id: u32,
        pub fractal: AccountNumber,
        pub member: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub remaining: Quantity,
        pub rate_ppm: u32,
    }

    impl Tribute {
        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_fractal_membership(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.fractal, self.member, self.id)
        }
    }

    #[table(name = "ApplicationTable", index = 5)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Application {
        pub fractal: AccountNumber,
        pub member: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub applying_for: StatusU8,
    }

    impl Application {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.member)
        }
    }

    #[table(name = "AttestationTable", index = 6)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Attestation {
        #[primary_key]
        pub attestation_id: u32,
        pub application_id: u32,
        pub member: AccountNumber,
    }

    #[table(name = "ConfigTable", index = 7)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Config {
        pub last_used_id: u32,
    }

    impl Config {
        #[primary_key]
        fn pk(&self) {}
    }
}
