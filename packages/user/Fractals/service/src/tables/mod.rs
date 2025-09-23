mod config;
mod evaluation_instance;
mod fractal;
pub mod fractal_member;
mod guild;
mod guild_member;

#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, Memo, TimePointSec, ToSchema};

    use serde::{Deserialize, Serialize};

    use crate::tables::fractal_member::StatusU8;

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

    #[table(name = "FractalMemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct FractalMember {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub member_status: StatusU8,
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

    #[table(name = "EvaluationInstanceTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct EvaluationInstance {
        #[primary_key]
        pub guild: GID,
        pub interval: u32,
        pub evaluation_id: u32,
    }

    impl EvaluationInstance {
        #[secondary_key(1)]
        pub fn by_evaluation(&self) -> u32 {
            self.evaluation_id
        }
    }

    #[table(name = "ConfigTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Config {
        pub last_id: u64,
    }

    impl Config {
        #[primary_key]
        fn pk(&self) {}
    }

    pub type GID = u64;

    #[table(name = "GuildTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Guild {
        #[primary_key]
        pub id: GID,
        pub fractal: AccountNumber,
        pub rep: Option<AccountNumber>,
        pub display_name: Memo,
        pub bio: Memo,
    }

    impl Guild {
        #[secondary_key(1)]
        pub fn by_fractal(&self) -> (AccountNumber, GID) {
            (self.fractal, self.id)
        }
    }

    #[table(name = "GuildMemberTable", index = 5)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct GuildMember {
        pub fractal: AccountNumber,
        pub guild: GID,
        pub member: AccountNumber,
        pub value: u32,
        pub pending: Option<u32>,
    }

    impl GuildMember {
        #[primary_key]
        fn pk(&self) -> (GID, AccountNumber) {
            (self.guild, self.member)
        }
    }
}
