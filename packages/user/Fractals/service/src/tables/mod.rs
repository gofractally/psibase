mod fractal;
mod fractal_exile;
pub mod fractal_member;
mod reward_consensus;
mod reward_stream;

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
        pub stream_id: u32,
        pub fractal: AccountNumber,
        pub last_distributed: psibase::TimePointSec,
        pub dist_interval_secs: u32,
    }

    impl RewardStream {
        #[secondary_key(1)]
        fn by_fractal(&self) -> (AccountNumber, u32) {
            (self.fractal, self.stream_id)
        }
    }

    #[table(name = "RewardConsensusTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct RewardConsensus {
        #[primary_key]
        pub fractal: AccountNumber,
        pub reward_stream_id: u32,
        pub ranked_guilds: Vec<AccountNumber>,
        pub ranked_guild_slot_count: u8,
    }
}
