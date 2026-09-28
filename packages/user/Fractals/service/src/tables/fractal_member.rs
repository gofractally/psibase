use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::{AccountNumber, ServiceWrapper, Table};

use crate::{
    constants::{DEFAULT_RECRUITMENT_PPM, TOKEN_PRECISION},
    tables::tables::{
        Fractal, FractalExile, FractalMember, FractalMemberTable, FractalTable, Levy, RewardStream,
    },
};

use async_graphql::ComplexObject;
use psibase::services::transact::Wrapper as TransactSvc;

#[ComplexObject]
impl FractalMember {
    pub async fn fractal_details(&self) -> Fractal {
        FractalTable::with_service(crate::Wrapper::SERVICE)
            .get_index_pk()
            .get(&self.fractal)
            .unwrap()
    }

    /// Net fractal-token amount credited to this member.
    pub async fn total_earned(&self) -> Decimal {
        Decimal::new(
            self.total_earned,
            Precision::new(TOKEN_PRECISION).expect("fractal token precision"),
        )
    }
}

impl FractalMember {
    fn new(fractal: AccountNumber, account: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            account,
            fractal,
            created_at: now,
            total_earned: 0.into(),
        }
    }

    pub fn add_earned(&mut self, amount: Quantity) {
        if amount.value == 0 {
            return;
        }
        self.total_earned = self
            .total_earned
            .value
            .saturating_add(amount.value)
            .into();
        self.save();
    }

    pub fn get_all(fractal: AccountNumber) -> Vec<Self> {
        FractalMemberTable::read()
            .get_index_pk()
            .range((fractal, AccountNumber::MIN)..=(fractal, AccountNumber::MAX))
            .collect()
    }

    pub fn add(
        fractal: AccountNumber,
        account: AccountNumber,
        recruiter: Option<AccountNumber>,
    ) -> Self {
        let fractal = fractal.base();
        let account = account.base();
        let recruiter = recruiter.map(|r| r.base());

        assert!(account != fractal, "fractal cannot be a member of itself",);
        assert!(
            FractalExile::get(fractal, account).is_none(),
            "member has been exiled from this fractal",
        );
        if let Some(existing) = Self::get(fractal, account) {
            return existing;
        }

        if let Some(recruiter) = recruiter {
            assert!(recruiter != account, "cannot recruit yourself",);
            assert!(
                Self::get(fractal, recruiter).is_some(),
                "recruiter is not a member of this fractal",
            );
        }

        let new_instance = Self::new(fractal, account);
        new_instance.save();

        RewardStream::add_member(fractal, account, Fractal::get_assert(fractal).token_id);
        // If a recruiter is specified, levy them; otherwise, levy the fractal itself so there's no advantage or disadvantage to being recruited by an existing member vs. joining independently
        let recruiter = recruiter.unwrap_or(fractal);
        Levy::add(
            fractal,
            account,
            recruiter,
            DEFAULT_RECRUITMENT_PPM,
            // 0 for unlimited
            0.into(),
            true,
        );

        new_instance
    }

    pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<FractalMember> {
        FractalMemberTable::read()
            .get_index_pk()
            .get(&(fractal, account))
    }

    pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        Self::get(fractal, account).expect("member does not exist")
    }

    pub fn exile(&self) {
        FractalExile::add(self.fractal, self.account);
        for levy in Levy::levies_of_member(self.fractal, self.account) {
            levy.delete_by_exile()
        }
        self.remove();
    }

    fn remove(&self) {
        FractalMemberTable::read_write().remove(&self);
    }

    fn save(&self) {
        FractalMemberTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
