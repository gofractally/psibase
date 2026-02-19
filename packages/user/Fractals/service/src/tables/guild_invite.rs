use async_graphql::ComplexObject;

use psibase::{
    check, check_some, get_sender,
    services::{tokens::Quantity, virtual_server},
    AccountNumber, Checksum256, Table,
};

use crate::{
    constants::MAX_GUILD_INVITES_PER_MEMBER,
    tables::tables::{Guild, GuildApplication, GuildInvite, GuildInviteTable, GuildMember},
};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildInvite {
    fn new(guild: AccountNumber, id: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            id,
            inviter: get_sender(),
            created_at: now,
        }
    }

    pub fn by_inviter(guild: AccountNumber, inviter: AccountNumber) -> Vec<Self> {
        GuildInviteTable::read()
            .get_index_by_member()
            .range((guild, inviter, 0)..=(guild, inviter, u32::MAX))
            .collect()
    }

    fn invite_cost() -> Option<(u32, Quantity)> {
        if virtual_server::Wrapper::call().is_billing_enabled() {
            let tokens = psibase::services::tokens::Wrapper::call();
            let system_token = check_some(
                tokens.getSysToken(),
                "expected system token when billing is enabled",
            )
            .id;
            let cost = psibase::services::invite::Wrapper::call().getInvCost(1);

            Some((system_token, cost))
        } else {
            None
        }
    }

    fn charge_invite_fee_from_sender(token_id: u32, cost: Quantity) {
        let tokens = psibase::services::tokens::Wrapper::call();
        let inviter = get_sender();

        tokens.debit(token_id, inviter, cost, "memo".into());
        tokens.credit(
            token_id,
            psibase::services::invite::SERVICE,
            cost,
            "memo".into(),
        );
        tokens.reject(token_id, inviter, "dust".into());
    }

    pub fn add(guild: AccountNumber, invite_id: u32, finger_print: Checksum256, secret: String) {
        let inviter = get_sender();
        check(
            Self::by_inviter(guild, inviter).len() <= MAX_GUILD_INVITES_PER_MEMBER.into(),
            "too many pending invites",
        );
        check_some(
            GuildMember::get(guild, inviter),
            "must be a member of guild to invite to it",
        );

        let invite_cost = Self::invite_cost();
        if let Some((system_token_id, cost)) = invite_cost {
            Self::charge_invite_fee_from_sender(system_token_id, cost)
        }

        psibase::services::invite::Wrapper::call().createInvite(
            invite_id,
            finger_print,
            1,
            true,
            secret,
            invite_cost.map_or(0.into(), |(_, amount)| amount),
        );

        Self::new(guild, invite_id).save();
    }

    pub fn get(id: u32) -> Option<Self> {
        GuildInviteTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(invite_id: u32) -> Self {
        check_some(Self::get(invite_id), "guild application does not exist")
    }

    pub fn remove_all_by_member(guild: AccountNumber, member: AccountNumber) {
        let table = GuildInviteTable::read_write();
        for application in GuildInvite::by_inviter(guild, member) {
            table.remove(&application);
        }
    }

    pub fn accept(&self, accepter: AccountNumber, extra_info: String) {
        self.remove();
        GuildApplication::add(self.guild, accepter, extra_info);
    }

    pub fn cancel(&self) {
        check(
            get_sender() == self.inviter,
            "only inviter can cancel invites",
        );
        self.remove()
    }

    fn remove(&self) {
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
}
