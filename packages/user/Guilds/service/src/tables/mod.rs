mod evaluation_instance;
mod guild;
mod guild_application;
mod guild_attest;
mod guild_invite;
mod guild_member;
mod ranking;
mod role_map;

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{define_flags, AccountNumber, Fracpack, Memo, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "GuildTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Guild {
        #[primary_key]
        pub account: AccountNumber,
        #[graphql(skip)]
        pub owner: AccountNumber,
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

    #[table(name = "RankingTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Ranking {
        pub fractal: AccountNumber,
        pub guild: AccountNumber,
        pub index: u8,
    }

    impl Ranking {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u8, AccountNumber) {
            (self.fractal, self.index, self.guild)
        }
    }

    define_flags!(GuildFlags, u8, {
        rank_ordering,
    });

    impl Guild {
        #[secondary_key(1)]
        pub fn by_owner(&self) -> (AccountNumber, AccountNumber) {
            (self.owner, self.account)
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

    #[table(name = "GuildMemberTable", index = 3)]
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

    #[table(name = "GuildApplicationTable", index = 4)]
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
        fn by_applicant(&self) -> (AccountNumber, AccountNumber) {
            (self.applicant, self.guild)
        }
    }

    #[table(name = "GuildInviteTable", index = 5)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct GuildInvite {
        #[primary_key]
        pub id: u32,
        #[graphql(skip)]
        pub guild: AccountNumber,
        pub inviter: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub pre_attest: bool,
    }

    impl GuildInvite {
        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.guild, self.inviter, self.id)
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

    #[table(name = "EvaluationInstanceTable", index = 7)]
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

    #[table(name = "RoleMapTable", index = 8)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct RoleMap {
        pub fractal: AccountNumber,
        pub role_id: u8,
        pub guild: AccountNumber,
    }

    impl RoleMap {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u8, AccountNumber) {
            (self.fractal, self.role_id, self.guild)
        }
    }
}
