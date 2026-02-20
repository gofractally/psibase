use async_graphql::connection::Connection;
use async_graphql::ComplexObject;

use psibase::{check_none, check_some, get_sender, AccountNumber, RawKey, Table, TableQuery};

use crate::tables::tables::{
    Guild, GuildApplication, GuildApplicationTable, GuildAttest, GuildAttestTable, GuildMember,
};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildApplication {
    fn new(guild: AccountNumber, applicant: AccountNumber, extra_info: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            applicant,
            extra_info,
            created_at: now,
        }
    }

    pub fn add(guild: AccountNumber, applicant: AccountNumber, extra_info: String) {
        check_none(Self::get(guild, applicant), "application already exists");
        check_none(
            GuildMember::get(guild, applicant),
            "user is already a guild member",
        );
        Self::new(guild, applicant, extra_info).save();
    }

    pub fn get(guild: AccountNumber, applicant: AccountNumber) -> Option<Self> {
        GuildApplicationTable::read()
            .get_index_pk()
            .get(&(guild, applicant))
    }

    pub fn get_assert(guild: AccountNumber, applicant: AccountNumber) -> Self {
        check_some(
            Self::get(guild, applicant),
            "guild application does not exist",
        )
    }

    fn check_attests(&self) {
        let passed = self.attestations_score() >= 3;
        if passed {
            GuildMember::add(self.guild, self.applicant);
            self.remove()
        }
    }

    fn attestations_score(&self) -> i16 {
        GuildAttestTable::read()
            .get_index_pk()
            .range(
                (self.guild, self.applicant, AccountNumber::new(0))
                    ..=(self.guild, self.applicant, AccountNumber::new(u64::MAX)),
            )
            .fold(0i16, |acc, e| {
                acc.saturating_add(if e.endorses { 1 } else { -1 })
            })
    }

    pub fn attest(&self, comment: String, endorses: bool) {
        GuildAttest::set(self.guild, self.applicant, get_sender(), comment, endorses);
        self.check_attests();
    }

    pub fn cancel(&self) {
        self.remove()
    }

    fn remove(&self) {
        let table = GuildAttestTable::read_write();

        table
            .get_index_pk()
            .range(
                (self.guild, self.applicant, AccountNumber::new(0))
                    ..=(self.guild, self.applicant, AccountNumber::new(u64::MAX)),
            )
            .for_each(|attest| {
                table.remove(&attest);
            });

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

    pub async fn attestations(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, GuildAttest>> {
        TableQuery::subindex::<AccountNumber>(
            GuildAttestTable::read().get_index_pk(),
            &(self.guild, self.applicant),
        )
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
    }
}
