use async_graphql::ComplexObject;

use psibase::{
    check, check_some, get_sender, services::tokens::Quantity, AccountNumber, Memo, Table,
    TimePointSec,
};

use crate::{
    constants::MAX_GUILD_INVITES_PER_MEMBER,
    tables::tables::{Guild, GuildApplication, GuildInvite, GuildInviteTable, GuildMember},
};
use psibase::services::{
    invite::Wrapper as Invite, tokens::Wrapper as Tokens, transact::Wrapper as TransactSvc,
};

impl GuildInvite {
    fn new(guild: AccountNumber, id: u32, pre_attest: bool) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            id,
            inviter: get_sender(),
            created_at: now,
            pre_attest,
        }
    }

    pub fn by_inviter(guild: AccountNumber, inviter: AccountNumber) -> Vec<Self> {
        GuildInviteTable::read()
            .get_index_by_member()
            .range((guild, inviter, 0)..=(guild, inviter, u32::MAX))
            .collect()
    }

    fn invite_cost(num_accounts: u16) -> Quantity {
        psibase::services::invite::Wrapper::call().getInvCost(num_accounts)
    }

    pub fn add(
        guild: AccountNumber,
        invite_id: u32,
        invite_payload: Vec<u8>,
        num_accounts: u16,
        pre_attest: bool,
    ) {
        let inviter = get_sender();
        check(
            Self::by_inviter(guild, inviter).len() <= MAX_GUILD_INVITES_PER_MEMBER.into(),
            "too many pending invites",
        );
        check_some(
            GuildMember::get(guild, inviter),
            "must be a member of guild to invite to it",
        );

        let invite_cost = Self::invite_cost(num_accounts);

        Self::debit_then_credit(
            (get_sender(), "Invite fee".into()),
            (psibase::services::invite::SERVICE, Memo::empty()),
            invite_cost,
        );

        Invite::call().createInvite(invite_id, invite_payload, num_accounts, true, invite_cost);

        Self::new(guild, invite_id, pre_attest).save();
    }

    pub fn get(id: u32) -> Option<Self> {
        GuildInviteTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(invite_id: u32) -> Self {
        check_some(Self::get(invite_id), "guild application does not exist")
    }

    pub fn accept(&self, accepter: AccountNumber) {
        let application = GuildApplication::add(self.guild, accepter, "".to_string());
        if self.pre_attest {
            application.attest("".to_string(), self.inviter, true);
        }
    }

    pub fn delete(&self) {
        check(
            get_sender() == self.inviter,
            "only inviter can delete invites",
        );
        self.remove()
    }

    fn debit_then_credit(from: (AccountNumber, Memo), to: (AccountNumber, Memo), amount: Quantity) {
        if amount.value == 0 {
            return;
        }
        let tokens = Tokens::call();

        let system_token = check_some(
            tokens.getSysToken(),
            "expected system token to issue refund",
        )
        .id;

        tokens.debit(system_token, from.0, amount, from.1);
        tokens.credit(system_token, to.0, amount, to.1);
        tokens.reject(system_token, from.0, "Unused amount".into());
    }

    fn remove(&self) {
        let refund = Invite::call().delInvite(self.id);
        Self::debit_then_credit(
            (Invite::SERVICE, Memo::empty()),
            (self.inviter, "Invite refund".into()),
            refund,
        );
        GuildInviteTable::read_write().remove(&self)
    }

    fn save(&self) {
        GuildInviteTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl GuildInvite {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }

    pub async fn expiry(&self) -> TimePointSec {
        Invite::call().getExpDate(self.id)
    }
}
