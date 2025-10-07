use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

use crate::tables::tables::{Guild, GuildAttest, GuildAttestTable};

impl GuildAttest {
    fn new(
        guild: AccountNumber,
        member: AccountNumber,
        attestee: AccountNumber,
        comment: String,
        endorses: bool,
    ) -> Self {
        Self {
            guild,
            member,
            attestee,
            comment,
            endorses,
        }
    }

    pub fn add(
        guild: AccountNumber,
        member: AccountNumber,
        attestee: AccountNumber,
        comment: String,
        endorses: bool,
    ) {
        Self::new(guild, member, attestee, comment, endorses).save();
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
