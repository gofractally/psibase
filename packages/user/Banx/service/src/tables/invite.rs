use psibase::{
    get_sender,
    services::tokens::{Quantity, Wrapper as Tokens},
    AccountNumber, Memo, ServiceWrapper, Table,
};

use crate::math::PPM_SCALE;
use crate::tables::{
    emit_pair_activity,
    tables::{Asset, BanxInvite, BanxInviteTable, CreditLine},
};

impl BanxInvite {
    fn save(&self) {
        BanxInviteTable::read_write()
            .put(self)
            .expect("failed to save invite");
    }

    fn get(id: u32) -> Option<Self> {
        BanxInviteTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: u32) -> Self {
        Self::get(id).unwrap_or_else(|| panic!("banx invite {id} does not exist"))
    }

    pub fn list_by_inviter(inviter: AccountNumber) -> Vec<Self> {
        BanxInviteTable::read()
            .get_index_by_inviter()
            .range((inviter, 0)..=(inviter, u32::MAX))
            .collect()
    }

    fn invite_cost(num_accounts: u16) -> Quantity {
        psibase::services::invite::Wrapper::call().getInvCost(num_accounts)
    }

    pub fn add(
        invite_id: u32,
        invite_payload: Vec<u8>,
        num_accounts: u16,
        asset_id: u16,
        amount: Quantity,
        deplete_on_debit: bool,
        interest_rate: u32,
        grace_seconds: u32,
    ) {
        assert!(
            Self::get(invite_id).is_none(),
            "banx invite {invite_id} already exists"
        );
        assert!(
            num_accounts == 1,
            "banx invites are single-use (num_accounts must be 1)"
        );
        assert!(
            amount.value > 0,
            "invite credit limit must be greater than zero"
        );
        assert!(
            interest_rate <= PPM_SCALE,
            "interest_rate exceeds 100% (PPM_SCALE)"
        );
        let _ = Asset::get_assert(asset_id);

        let inviter = get_sender();
        let cost = Self::invite_cost(num_accounts);
        Self::debit_then_credit(
            (inviter, "Invite fee".into()),
            (psibase::services::invite::SERVICE, Memo::empty()),
            cost,
        );

        psibase::services::invite::Wrapper::call().createInvite(
            invite_id,
            invite_payload,
            num_accounts,
            true,
            cost,
        );

        let now = psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds();
        Self {
            id: invite_id,
            inviter,
            asset_id,
            limit: amount,
            deplete_on_debit,
            interest_rate,
            grace_seconds,
            created_at: now,
        }
        .save();
    }

    /// Extend the stored credit line to `accepter` if this inviter has not
    /// already lined them in this asset, then consume the invite (one claimee).
    /// Existing lines are left untouched. Inviter and unknown accounts are
    /// skipped and do not consume the seat.
    pub fn accept(&self, accepter: AccountNumber) {
        if accepter == self.inviter {
            return;
        }
        if !psibase::services::accounts::Wrapper::call().exists(accepter) {
            return;
        }
        if CreditLine::get(self.inviter, accepter, self.asset_id).is_none() {
            CreditLine::upsert_credit_line(
                self.inviter,
                accepter,
                self.asset_id,
                self.limit,
                self.deplete_on_debit,
                self.interest_rate,
                self.grace_seconds,
            );
            emit_pair_activity(
                self.inviter,
                accepter,
                self.asset_id,
                "credit_line",
                self.limit,
                0.into(),
                self.asset_id,
                0,
                "",
            );
        }
        self.consume();
    }

    pub fn delete(&self) {
        assert_eq!(
            get_sender(),
            self.inviter,
            "only inviter can delete invites"
        );
        self.consume();
    }

    fn consume(&self) {
        let refund = psibase::services::invite::Wrapper::call().delInvite(self.id);
        Self::debit_then_credit(
            (psibase::services::invite::SERVICE, Memo::empty()),
            (self.inviter, "Invite refund".into()),
            refund,
        );
        BanxInviteTable::read_write().erase(&self.id);
    }

    fn debit_then_credit(from: (AccountNumber, Memo), to: (AccountNumber, Memo), amount: Quantity) {
        if amount.value == 0 {
            return;
        }
        let tokens = Tokens::call();
        let system_token = tokens
            .getSysToken()
            .expect("expected system token to pay invite fee")
            .id;
        tokens.debit(system_token, from.0, amount, from.1);
        tokens.credit(system_token, to.0, amount, to.1);
        tokens.reject(system_token, from.0, "Unused amount".into());
    }
}
