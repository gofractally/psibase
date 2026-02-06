mod evaluation_instance;
mod fractal;
mod fractal_exile;
pub mod fractal_member;
mod guild;
mod guild_application;
mod guild_attest;
mod guild_member;
mod reward_consensus;
mod reward_stream;

#[psibase::service_tables]
pub mod tables {

    use async_graphql::SimpleObject;
    use psibase::{
        define_flags, services::tokens::TID, AccountNumber, Fracpack, Memo, TimePointSec, ToSchema,
    };

    use serde::{Deserialize, Serialize};

    use crate::tables::fractal_member::StatusU8;

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
        pub token_init_threshold: u8,
    }

    #[table(name = "FractalMemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct FractalMember {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub member_status: StatusU8,
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

    #[table(name = "EvaluationInstanceTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct EvaluationInstance {
        #[primary_key]
        pub guild: AccountNumber,
        pub interval: u32,
        pub evaluation_id: u32,
    }

    impl EvaluationInstance {
        #[secondary_key(1)]
        pub fn by_evaluation(&self) -> u32 {
            self.evaluation_id
        }
    }

    #[table(name = "GuildTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Guild {
        #[primary_key]
        pub account: AccountNumber,
        #[graphql(skip)]
        pub fractal: AccountNumber,
        pub display_name: Memo,
        #[graphql(skip)]
        pub rep: Option<AccountNumber>,
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
        pub bio: Memo,
        pub description: String,
        pub rank_ordering_threshold: u8,
        pub settings: u8,
        pub candidacy_cooldown: u32,
    }

    define_flags!(GuildFlags, u8, {
        rank_ordering,
    });

    impl Guild {
        #[secondary_key(1)]
        pub fn by_fractal(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

        #[secondary_key(2)]
        pub fn by_council(&self) -> AccountNumber {
            self.council_role
        }

        #[secondary_key(3)]
        pub fn by_rep(&self) -> AccountNumber {
            self.rep_role
        }
    }

    #[table(name = "GuildMemberTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct GuildMember {
        #[graphql(skip)]
        pub guild: AccountNumber,
        pub member: AccountNumber,
        #[graphql(skip)]
        pub score: u32,
        pub pending_level: Option<u8>,
        pub created_at: psibase::TimePointSec,
        pub is_candidate: bool,
        pub candidacy_eligible_from: psibase::TimePointSec,
        pub attendance: u16,
    }

    impl GuildMember {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.guild, self.member)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.member, self.guild)
        }

        #[secondary_key(2)]
        fn by_score(&self) -> (AccountNumber, bool, u32, AccountNumber) {
            (self.guild, self.is_candidate, self.score, self.member)
        }
    }

    #[table(name = "GuildApplicationTable", index = 5)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct GuildApplication {
        #[graphql(skip)]
        pub guild: AccountNumber,
        pub applicant: AccountNumber,
        pub extra_info: String,
        pub created_at: psibase::TimePointSec,
    }

    impl GuildApplication {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.guild, self.applicant)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.applicant, self.guild)
        }
    }

    #[table(name = "GuildAttestTable", index = 6)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct GuildAttest {
        #[graphql(skip)]
        pub guild: AccountNumber,
        pub applicant: AccountNumber,
        pub attester: AccountNumber,
        pub comment: String,
        pub endorses: bool,
    }

    impl GuildAttest {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.guild, self.applicant, self.attester)
        }

        #[secondary_key(1)]
        fn by_guild(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.guild, self.attester, self.applicant)
        }

        #[secondary_key(2)]
        fn by_attester(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.attester, self.guild, self.applicant)
        }
    }

    #[table(name = "FractalExileTable", index = 7)]
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

    #[table(name = "RewardStreamTable", index = 8)]
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

    #[table(name = "RewardConsensusTable", index = 9)]
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
