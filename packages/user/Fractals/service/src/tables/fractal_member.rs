use psibase::{
    abort_message, check, check_none, check_some, services::tokens::Quantity, AccountNumber, Memo,
    Table,
};

use crate::{
    constants::MEMBER_STREAM_HALF_LIFE,
    tables::tables::{
        Fractal, FractalExile, FractalMember, FractalMemberTable, FractalTable, GuildApplication,
        GuildAttest, GuildMember, Levy,
    },
};

use async_graphql::ComplexObject;
use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::transact::Wrapper as TransactSvc;

#[derive(PartialEq)]
pub enum MemberStatus {
    Visa = 1,
    Citizen = 2,
}

pub type StatusU8 = u8;

impl From<StatusU8> for MemberStatus {
    fn from(status: StatusU8) -> Self {
        match status {
            1 => MemberStatus::Visa,
            2 => MemberStatus::Citizen,
            _ => abort_message("invalid member status"),
        }
    }
}

#[ComplexObject]
impl FractalMember {
    pub async fn fractal_details(&self) -> Fractal {
        FractalTable::with_service(crate::Wrapper::SERVICE)
            .get_index_pk()
            .get(&self.fractal)
            .unwrap()
    }
}

impl FractalMember {
    fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let token_id = Fractal::get_assert(fractal).token_id;

        Self {
            account,
            fractal,
            created_at: now,
            member_status: status as StatusU8,
            stream_id: TokenStream::call().create(MEMBER_STREAM_HALF_LIFE, token_id),
        }
    }

    pub fn add(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        check_none(
            FractalExile::get(fractal, account),
            "member has been exiled from this fractal",
        );

        let new_instance = Self::new(fractal, account, status);
        new_instance.save();

        new_instance
    }

    pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<FractalMember> {
        FractalMemberTable::read()
            .get_index_pk()
            .get(&(fractal, account))
    }

    pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        check_some(Self::get(fractal, account), "member does not exist")
    }

    fn credit(&self, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        let token_id = Fractal::get_assert(self.fractal).token_id;
        psibase::services::tokens::Wrapper::call().credit(token_id, debitor, amount, memo);
    }

    pub fn credit_direct(&self, amount: Quantity, memo: Memo) {
        self.credit(self.account, amount, memo);
    }

    pub fn credit_stream(&self, amount: Quantity, memo: Memo) {
        self.credit(TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.stream_id, amount);
    }

    fn claim_from_stream(&self) -> Quantity {
        psibase::services::token_stream::Wrapper::call().claim(self.stream_id)
    }

    pub fn withdraw(&self) {
        let claimed = self.claim_from_stream();
        check(claimed.value > 0, "nothing to withdraw");

        let to_credit = Levy::levies_of_member(self.fractal, self.account)
            .into_iter()
            .fold(claimed, |remaining_amount, mut levy| {
                let levy_paid = levy.apply_levy(claimed);
                remaining_amount - levy_paid
            });

        self.credit_direct(to_credit, "Stream reward".into());
    }

    pub fn is_citizen(&self) -> bool {
        MemberStatus::Citizen == self.member_status.into()
    }

    pub fn has_visa(&self) -> bool {
        MemberStatus::Visa == self.member_status.into()
    }

    pub fn exile(&self) {
        FractalExile::add(self.fractal, self.account);
        self.remove();
    }

    fn remove(&self) {
        GuildApplication::remove_all_by_member(self.account);
        GuildAttest::remove_all_by_member(self.account);
        GuildMember::remove_all_by_member(self.account);

        FractalMemberTable::read_write().remove(&self);
    }

    fn save(&self) {
        FractalMemberTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
