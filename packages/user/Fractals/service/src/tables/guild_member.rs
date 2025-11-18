use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

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
        }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber) {
        Self::new(guild, member).save();
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .get(&(guild, member))
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild member does not exist")
    }

    pub fn set_pending_score(&mut self, incoming_score: u32) {
        self.pending_score = Some(incoming_score * 10000);
        self.save();
    }

    pub fn save_pending_score(&mut self) {
        self.pending_score.take().map(|pending_score| {
            self.score = calculate_ema_u32(pending_score, self.score, Fraction::new(1, 6));
            self.save();
        });
    }

    pub fn kick(&self) {
        self.remove();
    }

    pub fn guild_memberships(member: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_by_member()
            .range((member, AccountNumber::new(0))..=(member, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn remove_all_by_member(member: AccountNumber) {
        let table = GuildMemberTable::read_write();
        for membership in Self::guild_memberships(member) {
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
}
