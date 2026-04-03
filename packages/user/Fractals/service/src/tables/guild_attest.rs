use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

use crate::tables::tables::{Guild, GuildAttest, GuildAttestTable, GuildMember};

impl GuildAttest {
    fn new(
        guild: AccountNumber,
        applicant: AccountNumber,
        attester: AccountNumber,
        comment: String,
        endorses: bool,
    ) -> Self {
        Self {
            guild,
            applicant,
            attester,
            comment,
            endorses,
        }
    }

    pub fn set(
        guild: AccountNumber,
        applicant: AccountNumber,
        attester: AccountNumber,
        comment: String,
        endorses: bool,
    ) {
        check_some(
            GuildMember::get(guild, attester),
            "must be member of the guild to attest",
        );
        Self::new(guild, applicant, attester, comment, endorses).save();
    }

    pub fn get(
        guild: AccountNumber,
        member: AccountNumber,
        attestee: AccountNumber,
    ) -> Option<Self> {
        GuildAttestTable::read()
            .get_index_pk()
            .get(&(guild, member, attestee))
    }

    pub fn get_assert(
        guild: AccountNumber,
        member: AccountNumber,
        attestee: AccountNumber,
    ) -> Self {
        check_some(
            Self::get(guild, member, attestee),
            "guild attestation does not exist",
        )
    }

    pub fn remove(&self) {
        GuildAttestTable::read_write().remove(&self);
    }

    pub fn attestations_by_guild_member(guild: AccountNumber, member: AccountNumber) -> Vec<Self> {
        GuildAttestTable::read()
            .get_index_by_guild()
            .range(
                (guild, member, AccountNumber::new(0))
                    ..=(guild, member, AccountNumber::new(u64::MAX)),
            )
            .collect()
    }

    pub fn remove_attestations_by_guild_member(guild: AccountNumber, member: AccountNumber) {
        let table = GuildAttestTable::read_write();
        table
            .get_index_by_guild()
            .range(
                (guild, member, AccountNumber::new(0))
                    ..=(guild, member, AccountNumber::new(u64::MAX)),
            )
            .for_each(|guild| {
                table.remove(&guild);
            });
    }

    fn save(&self) {
        GuildAttestTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildAttest {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }
}
