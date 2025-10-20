use psibase::{abort_message, check, check_some, AccountNumber, Table};

use crate::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable};

use async_graphql::ComplexObject;
use psibase::services::transact::Wrapper as TransactSvc;

#[derive(PartialEq)]
pub enum MemberStatus {
    Visa = 1,
    Citizen = 2,
    Exiled = 3,
}

pub type StatusU8 = u8;

impl From<StatusU8> for MemberStatus {
    fn from(status: StatusU8) -> Self {
        match status {
            1 => MemberStatus::Visa,
            2 => MemberStatus::Citizen,
            3 => MemberStatus::Exiled,
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
        Self {
            account,
            fractal,
            created_at: now,
            member_status: status as StatusU8,
        }
    }

    pub fn add(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
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

    pub fn is_citizen(&self) -> bool {
        MemberStatus::Citizen == self.member_status.into()
    }

    pub fn has_visa(&self) -> bool {
        MemberStatus::Visa == self.member_status.into()
    }

    pub fn check_has_visa_or_citizenship(&self) {
        check(
            self.has_visa() || self.is_citizen(),
            "must have visa or citizenship",
        );
    }

    fn save(&self) {
        FractalMemberTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
