use async_graphql::ComplexObject;
use psibase::{check_some, AccountNumber, Table};

use crate::scoring::{calculate_ema_u32, Fraction};
use crate::tables::tables::{Guild, GuildMember, GuildMemberTable};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildMember {
    fn new(fractal: AccountNumber, guild: AccountNumber, member: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            fractal,
            guild,
            member,
            pending_score: None,
            score: 0,
            created_at: now,
        }
    }

    pub fn add(fractal: AccountNumber, guild: AccountNumber, member: AccountNumber) {
        Self::new(fractal, guild, member).save();
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
        self.pending_score = Some(incoming_score);
        self.save();
    }

    pub fn save_pending_score(&mut self) {
        self.pending_score.take().map(|pending_score| {
            self.score = calculate_ema_u32(pending_score, self.score, Fraction::new(1, 6));
            self.save();
        });
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
