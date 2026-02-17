use async_graphql::ComplexObject;

use psibase::{check, check_some, get_sender, AccountNumber, Table};

use crate::{
    constants::MAX_GUILD_INVITES_PER_MEMBER,
    tables::tables::{Guild, GuildInvite, GuildInviteTable, GuildMember},
};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildInvite {
    fn new(guild: AccountNumber, id: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            id,
            inviter: get_sender(),
            created_at: now,
        }
    }

    pub fn by_inviter(guild: AccountNumber, inviter: AccountNumber) -> Vec<Self> {
        GuildInviteTable::read()
            .get_index_by_member()
            .range((guild, inviter, 0)..=(guild, inviter, u32::MAX))
            .collect()
    }

    pub fn add(guild: AccountNumber, invite_id: u32) {
        let inviter = get_sender();
        check(
            Self::by_inviter(guild, inviter).len() <= MAX_GUILD_INVITES_PER_MEMBER.into(),
            "too many pending invites",
        );
        check_some(
            GuildMember::get(guild, inviter),
            "must be a member of guild to invite to it",
        );

        Self::new(guild, invite_id).save();
    }

    pub fn get(id: u32) -> Option<Self> {
        GuildInviteTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(invite_id: u32) -> Self {
        check_some(Self::get(invite_id), "guild application does not exist")
    }

    pub fn remove_all_by_member(guild: AccountNumber, member: AccountNumber) {
        let table = GuildInviteTable::read_write();
        for application in GuildInvite::by_inviter(guild, member) {
            table.remove(&application);
        }
    }

    pub fn accept(&self, accepter: AccountNumber) {
        GuildMember::add(self.guild, accepter);
        self.remove()
    }

    pub fn cancel(&self) {
        check(
            get_sender() == self.inviter,
            "only inviter can cancel invites",
        );
        self.remove()
    }

    fn remove(&self) {
        GuildInviteTable::read_write().put(&self).unwrap()
    }

    fn save(&self) {
        GuildInviteTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildInvite {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }
}
