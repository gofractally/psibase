use async_graphql::ComplexObject;

use psibase::{
    check, check_some, get_sender,
    services::{tokens::Quantity, virtual_server},
    AccountNumber, Table, TimePointSec,
};

use crate::{
    constants::MAX_GUILD_INVITES_PER_MEMBER,
    tables::tables::{
        Guild, GuildApplication, GuildAttest, GuildInvite, GuildInviteTable, GuildMember,
    },
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
        if virtual_server::Wrapper::call().is_billing_enabled() {
            psibase::services::invite::Wrapper::call().getInvCost(num_accounts)
        } else {
            0.into()
        }
    }

    fn charge_invite_fee_from_sender(cost: Quantity) {
        let tokens = Tokens::call();
        let inviter = get_sender();

        let system_token_id = Tokens::call().getSysToken().unwrap().id;

        tokens.debit(system_token_id, inviter, cost, "Invite fee".into());
        tokens.credit(
            system_token_id,
            psibase::services::invite::SERVICE,
            cost,
            "Invite fee".into(),
        );
        tokens.reject(system_token_id, inviter, "Invite fee dust return".into());
    }

    pub fn add(
        guild: AccountNumber,
        invite_id: u32,
        finger_print: Vec<u8>,
        secret: String,
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
        if invite_cost.value > 0 {
            Self::charge_invite_fee_from_sender(invite_cost)
        }

        Invite::call().createInvite(
            invite_id,
            finger_print,
            num_accounts,
            true,
            secret,
            invite_cost,
        );

        Self::new(guild, invite_id, pre_attest).save();
    }

    pub fn get(id: u32) -> Option<Self> {
        GuildInviteTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(invite_id: u32) -> Self {
        check_some(Self::get(invite_id), "guild application does not exist")
    }

    pub fn accept(&self, accepter: AccountNumber) {
        GuildApplication::add(self.guild, accepter, "".to_string());
        if self.pre_attest {
            GuildAttest::set(self.guild, accepter, self.inviter, "".to_string(), true);
        }
    }

    pub fn delete(&self) {
        check(
            get_sender() == self.inviter,
            "only inviter can delete invites",
        );
        self.remove()
    }

    fn remove(&self) {
        Invite::call().delInvite(self.id);
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
