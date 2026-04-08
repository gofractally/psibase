mod fractal;
mod fractal_exile;
pub mod fractal_member;
mod occupation;
mod reward_consensus;
mod reward_stream;
mod role;
pub enum DistributionStrategy {
    Constant = 0,
    Fibonacci = 1,
}

#[psibase::service_tables]
pub mod tables {

    use async_graphql::SimpleObject;
    use psibase::{services::tokens::TID, AccountNumber, Fracpack, TimePointSec, ToSchema};

    use serde::{Deserialize, Serialize};

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Fractal {
        #[primary_key]
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,
        #[graphql(skip)]
        pub legislature: AccountNumber,
        #[graphql(skip)]
        pub judiciary: AccountNumber,
        pub token_id: TID,
        pub dist_strat: u8,
    }

    impl Fractal {
        #[secondary_key(1)]
        fn by_judiciary(&self) -> (AccountNumber, AccountNumber) {
            (self.judiciary, self.account)
        }

        #[secondary_key(2)]
        fn by_legislature(&self) -> (AccountNumber, AccountNumber) {
            (self.legislature, self.account)
        }
    }

    #[table(name = "FractalMemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct FractalMember {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub stream_id: u32,
    }

    impl FractalMember {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.account, self.fractal)
        }
    }

    #[table(name = "FractalExileTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct FractalExile {
        #[graphql(skip)]
        pub fractal: AccountNumber,
        pub member: AccountNumber,
    }

    impl FractalExile {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.member)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.member, self.fractal)
        }
    }

    #[table(name = "RewardStreamTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RewardStream {
        #[primary_key]
        pub fractal: AccountNumber,
        pub stream_id: u32,
        pub last_distributed: psibase::TimePointSec,
        pub dist_interval_secs: u32,
    }

    #[table(name = "RoleTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Role {
        pub fractal: AccountNumber,
        pub role_id: u8,
        pub occupation: AccountNumber,
    }

    impl Role {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u8) {
            (self.fractal, self.role_id)
        }
    }

    #[table(name = "OccupationTable", index = 5)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Occupation {
        pub fractal: AccountNumber,
        pub index: u8,
        pub occupation: AccountNumber,
    }

    impl Occupation {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u8) {
            (self.fractal, self.index)
        }
    }
}
