use async_graphql::ComplexObject;
use psibase::{AccountNumber, Table};

use crate::tables::tables::{Fractal, FractalExile, FractalExileTable};

impl FractalExile {
    fn new(fractal: AccountNumber, member: AccountNumber) -> Self {
        Self { fractal, member }
    }

    pub fn add(fractal: AccountNumber, member: AccountNumber) {
        assert!(
            Self::get(fractal, member).is_none(),
            "member is already exiled"
        );
        Self::new(fractal, member).save();
    }

    pub fn get(fractal: AccountNumber, member: AccountNumber) -> Option<Self> {
        FractalExileTable::read()
            .get_index_pk()
            .get(&(fractal, member.base()))
    }

    pub fn get_assert(fractal: AccountNumber, member: AccountNumber) -> Self {
        Self::get(fractal, member).expect("member is not exiled")
    }

    pub fn is_exiled(fractal: AccountNumber, account: AccountNumber) -> bool {
        Self::get(fractal, account).is_some()
    }

    pub fn lift(&self) {
        FractalExileTable::read_write().remove(&self);
    }

    fn save(&self) {
        FractalExileTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[ComplexObject]
impl FractalExile {
    pub async fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }
}
