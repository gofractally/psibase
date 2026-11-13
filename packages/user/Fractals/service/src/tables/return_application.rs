use psibase::{get_sender, AccountNumber, ServiceWrapper, Table};

use crate::tables::tables::{
    Fractal, FractalExile, FractalMember, ReturnApplication, ReturnApplicationTable,
};
use psibase::services::transact::Wrapper as TransactSvc;

impl ReturnApplication {
    pub fn add(fractal: AccountNumber, applicant: AccountNumber) -> Self {
        let applicant = applicant.base();
        Fractal::get_assert(fractal);
        assert!(
            FractalExile::is_exiled(fractal, applicant),
            "only an exile can apply to return",
        );
        assert!(
            FractalMember::get(fractal, applicant).is_none(),
            "applicant is already a member",
        );
        assert!(
            Self::get(fractal, applicant).is_none(),
            "return application already exists",
        );

        let row = Self {
            fractal,
            applicant,
            created_at: TransactSvc::call().currentBlock().time.seconds(),
        };
        row.save();
        row
    }

    pub fn get(fractal: AccountNumber, applicant: AccountNumber) -> Option<Self> {
        ReturnApplicationTable::read()
            .get_index_pk()
            .get(&(fractal, applicant.base()))
    }

    pub fn get_assert(fractal: AccountNumber, applicant: AccountNumber) -> Self {
        Self::get(fractal, applicant).expect("return application does not exist")
    }

    /// The judiciary has accepted. Exile ends and the account is a member again.
    pub fn accept(&self) {
        FractalExile::get_assert(self.fractal, self.applicant).lift();
        FractalMember::add(self.fractal, self.applicant, None);
        self.remove();
    }

    pub fn cancel(&self) {
        assert_eq!(
            get_sender(),
            self.applicant,
            "only the applicant can cancel",
        );
        self.remove();
    }

    fn remove(&self) {
        ReturnApplicationTable::read_write().remove(&self);
    }

    fn save(&self) {
        ReturnApplicationTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
