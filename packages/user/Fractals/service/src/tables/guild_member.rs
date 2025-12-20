use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table};

use crate::constants::{EMA_ALPHA_DENOMINATOR, GUILD_EVALUATION_GROUP_SIZE, SCORE_SCALE};
use crate::helpers::RollingBitset;
use crate::scoring::{calculate_ema_u32, Fraction};
use crate::tables::tables::{Guild, GuildAttest, GuildAttestTable, GuildMember, GuildMemberTable};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildMember {
    fn new(guild: AccountNumber, member: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            member,
            pending_score: None,
            score: 0,
            created_at: now,
            is_candidate: false,
            candidacy_eligible_from: now,
            attendance: RollingBitset::new().value(),
        }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber) -> Self {
        check_none(Self::get(guild, member), "guild member already exists");
        let new_instance = Self::new(guild, member);
        new_instance.save();
        new_instance
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .get(&(guild, member))
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild member does not exist")
    }

    pub fn set_pending_score(&mut self, pending_score: Option<u8>) {
        self.pending_score = pending_score;
        self.save();
    }

    pub fn apply_pending_score(&mut self) {
        if let Some(pending_score) = self.pending_score.take() {
            self.score = calculate_ema_u32(
                pending_score as u32 * SCORE_SCALE,
                self.score,
                Fraction::new(1, EMA_ALPHA_DENOMINATOR),
            );
        }
    }

    pub fn kick(&self) {
        self.remove();
    }

    pub fn memberships_of_member(member: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_by_member()
            .range((member, AccountNumber::new(0))..=(member, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn memberships_of_guild(guild: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .range((guild, AccountNumber::from(0))..=(guild, AccountNumber::from(u64::MAX)))
            .collect()
    }

    pub fn remove_all_by_member(member: AccountNumber) {
        let table = GuildMemberTable::read_write();
        for membership in Self::memberships_of_member(member) {
            table.remove(&membership);
        }
    }

    fn remove(&self) {
        let table = GuildAttestTable::read_write();
        let members = GuildAttest::attestations_by_guild_member(self.guild, self.member);

        for attest in members {
            table.remove(&attest);
        }

        GuildMemberTable::read_write().remove(&self);
    }

    fn save(&self) {
        GuildMemberTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildMember {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }

    pub async fn score(&self) -> f32 {
        self.score as f32 / SCORE_SCALE as f32 / GUILD_EVALUATION_GROUP_SIZE as f32 * 100.0
    }
}
