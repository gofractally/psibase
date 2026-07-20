use async_graphql::ComplexObject;
use psibase::{AccountNumber, Table};

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
        GuildMember::get(guild, attester).expect("must be member of the guild to attest");
        Self::new(guild, applicant, attester, comment, endorses).save();
    }

    fn get(
        guild: AccountNumber,
        applicant: AccountNumber,
        attester: AccountNumber,
    ) -> Option<Self> {
        GuildAttestTable::read()
            .get_index_pk()
            .get(&(guild, applicant, attester))
    }

    pub fn get_assert(
        guild: AccountNumber,
        applicant: AccountNumber,
        attester: AccountNumber,
    ) -> Self {
        Self::get(guild, applicant, attester).expect("attestation does not exist")
    }

    pub fn remove(&self) {
        GuildAttestTable::read_write().remove(self);
    }

    pub fn attestations_by_guild_member(guild: AccountNumber, member: AccountNumber) -> Vec<Self> {
        GuildAttestTable::read()
            .get_index_by_guild()
            .range((guild, member, AccountNumber::MIN)..=(guild, member, AccountNumber::MAX))
            .collect()
    }

    pub fn remove_attestations_by_guild_member(guild: AccountNumber, member: AccountNumber) {
        let table = GuildAttestTable::read_write();
        table
            .get_index_by_guild()
            .range((guild, member, AccountNumber::MIN)..=(guild, member, AccountNumber::MAX))
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
