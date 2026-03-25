use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table};

use crate::tables::tables::{Ban, BanTable, Guild};

impl Ban {
    fn new(guild: AccountNumber, member: AccountNumber) -> Self {
        Self { guild, member }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber) {
        check_none(
            Self::get(guild, member),
            "member is already banned from guild",
        );
        Self::new(guild, member).save();
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        BanTable::read().get_index_pk().get(&(guild, member))
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild exile does not exist")
    }

    pub fn remove(&self) {
        self.erase();
    }

    fn erase(&self) {
        BanTable::read_write().remove(&self);
    }

    fn save(&self) {
        BanTable::read_write().put(&self).expect("failed to save");
    }
}

#[ComplexObject]
impl Ban {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }
}
