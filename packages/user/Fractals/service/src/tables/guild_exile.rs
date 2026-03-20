use async_graphql::ComplexObject;
use psibase::{check, check_none, check_some, get_sender, AccountNumber, Table, TimePointSec};

use crate::tables::tables::{Guild, GuildExile, GuildExileTable};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildExile {
    fn new(guild: AccountNumber, member: AccountNumber, duration_seconds: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();
        let expiry = TimePointSec::from(now.seconds + duration_seconds as i64);

        Self {
            guild,
            member,
            expiry,
        }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber, duration_seconds: u32) {
        check_none(Self::get(guild, member), "member is already exiled");
        Self::new(guild, member, duration_seconds).save();
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        GuildExileTable::read()
            .get_index_pk()
            .get(&(guild, member))
            .and_then(|exile| {
                if exile.is_expired() {
                    exile.erase();
                    None
                } else {
                    Some(exile)
                }
            })
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild exile does not exist")
    }

    fn is_expired(&self) -> bool {
        let now = TransactSvc::call().currentBlock().time.seconds();
        return now.seconds >= self.expiry.seconds;
    }

    pub fn revoke(&self) {
        check(
            self.is_expired() || get_sender() == self.guild,
            "only guild can revoke an exile prior to expiry",
        );
        self.erase();
    }

    fn erase(&self) {
        GuildExileTable::read_write().remove(&self);
    }

    fn save(&self) {
        GuildExileTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildExile {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }
}
