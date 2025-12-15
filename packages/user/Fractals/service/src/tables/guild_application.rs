use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table};

use crate::tables::tables::{
    Guild, GuildApplication, GuildApplicationTable, GuildAttest,
    GuildAttestTable, GuildMember,
};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildApplication {
    fn new(
        guild: AccountNumber,
        member: AccountNumber,
        sponsor: Option<AccountNumber>,
        extra_info: String,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            member,
            extra_info,
            sponsor,
            created_at: now,
        }
    }

    pub fn add(
        guild: AccountNumber,
        member: AccountNumber,
        sponsor: Option<AccountNumber>,
        extra_info: String,
    ) {
        check_none(Self::get(guild, member), "application already exists");
        check_none(
            GuildMember::get(guild, member),
            "user is already a guild member",
        );

        sponsor.inspect(|sponsor| {
            check_some(
                GuildMember::get(guild, *sponsor),
                "sponsor must be a member of the guild",
            );
        });

        Self::new(guild, member, sponsor, extra_info).save();
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        GuildApplicationTable::read()
            .get_index_pk()
            .get(&(guild, member))
    }

    pub fn applications_by_member(member: AccountNumber) -> Vec<Self> {
        GuildApplicationTable::read()
            .get_index_by_member()
            .range((member, AccountNumber::new(0))..=(member, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn remove_all_by_member(member: AccountNumber) {
        let table = GuildApplicationTable::read_write();
        for application in GuildApplication::applications_by_member(member) {
            table.remove(&application);
        }
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild application does not exist")
    }

    pub fn conclude(&self, accepted: bool) {
        if accepted {
            GuildMember::add(self.guild, self.member, self.sponsor);
        }

        self.remove(accepted)
    }

    pub fn cancel(&self) {
        self.remove(false)
    }

    fn remove(&self, drop_attestations: bool) {
        let table = GuildAttestTable::read_write();

        if drop_attestations {
            table
                .get_index_pk()
                .range(
                    (self.guild, self.member, AccountNumber::new(0))
                        ..=(self.guild, self.member, AccountNumber::new(u64::MAX)),
                )
                .for_each(|attest| {
                    table.remove(&attest);
                });
        }

        GuildApplicationTable::read_write().remove(&self);
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
