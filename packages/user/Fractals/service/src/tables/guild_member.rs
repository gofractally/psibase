use async_graphql::ComplexObject;
use psibase::services::tokens::{Quantity, TID};
use psibase::{check_none, check_some, AccountNumber, Memo, Table};

use crate::scoring::{calculate_ema_u32, Fraction};
use crate::tables::tables::{
    FractalToken, Guild, GuildAttest, GuildAttestTable, GuildMember, GuildMemberTable,
};
use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildMember {
    fn new(guild: AccountNumber, member: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            member,
            pending_score: None,
            score: 0,
            created_at: now,
            stream_id: None,
        }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber) {
        Self::new(guild, member).save();
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
        let guild = Guild::get_assert(self.guild);
        if FractalToken::get(guild.fractal).is_some() {
            self.pending_score = Some(incoming_score * 10000);
            self.save();
        }
    }

    pub fn save_pending_score(&mut self) {
        self.pending_score.take().map(|pending_score| {
            self.score = calculate_ema_u32(pending_score, self.score, Fraction::new(1, 6));
            self.save();
        });
    }

    pub fn kick(&self) {
        self.remove();
    }

    pub fn memberships_of_member(member: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_by_member()
            .range((member, AccountNumber::new(0))..=(member, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn memberships_of_guild(guild: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .range((guild, AccountNumber::from(0))..=(guild, AccountNumber::from(u64::MAX)))
            .collect()
    }

    pub fn remove_all_by_member(member: AccountNumber) {
        let table = GuildMemberTable::read_write();
        for membership in Self::memberships_of_member(member) {
            table.remove(&membership);
        }
    }

    pub fn deposit_stream(&mut self, token_id: TID, amount: Quantity, memo: Memo) {
        let stream_id = self.stream_id.unwrap_or_else(|| self.init_stream(token_id));
        psibase::services::tokens::Wrapper::call().credit(
            token_id,
            TokenStream::SERVICE,
            amount,
            memo,
        );
        TokenStream::call().deposit(stream_id, amount);
    }

    pub fn init_stream(&mut self, token_id: TID) -> u32 {
        check_none(self.stream_id, "member already has stream");
        let stream = TokenStream::call().create(86400 * 7 * 12, token_id);
        self.stream_id = Some(stream);
        self.save();
        stream
    }

    fn remove(&self) {
        let table = GuildAttestTable::read_write();
        let members = GuildAttest::attestations_by_guild_member(self.guild, self.member);

        for attest in members {
            table.remove(&attest);
        }

        GuildMemberTable::read_write().remove(&self);
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
