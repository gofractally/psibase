use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table};

use crate::tables::tables::{
    Guild, GuildApplication, GuildApplicationTable, GuildAttest, GuildAttestTable, GuildMember, GID,
};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildApplication {
    fn new(guild: GID, member: AccountNumber, app: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            member,
            app,
            created_at: now,
        }
    }

    pub fn add(guild: GID, member: AccountNumber, app: String) {
        check_none(Self::get(guild, member), "application already exists");
        check_none(
            GuildMember::get(guild, member),
            "user is already a guild member",
        );
        Self::new(guild, member, app).save();
    }

    pub fn get(guild: GID, member: AccountNumber) -> Option<Self> {
        GuildApplicationTable::read()
            .get_index_pk()
            .get(&(guild, member))
    }

    pub fn get_assert(guild: GID, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild application does not exist")
    }

    pub fn respond(&self, accepted: bool) {
        let guild = Guild::get_assert(self.guild);

        GuildAttestTable::read()
            .get_index_pk()
            .range(
                (self.guild, self.member, AccountNumber::new(0))
                    ..=(self.guild, self.member, AccountNumber::new(u64::MAX)),
            )
            .for_each(|attest| {
                attest.remove();
            });

        if accepted {
            GuildMember::add(guild.fractal, self.guild, self.member);
        }
    }

    fn save(&self) {
        GuildApplicationTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildApplication {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }

    pub async fn attestations(&self) -> Vec<GuildAttest> {
        GuildAttestTable::read()
            .get_index_pk()
            .range(
                (self.guild, self.member, AccountNumber::new(0))
                    ..=(self.guild, self.member, AccountNumber::new(u64::MAX)),
            )
            .collect()
    }
}
