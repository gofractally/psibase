use async_graphql::ComplexObject;
use psibase::{check_none, AccountNumber, Table};

use crate::tables::tables::{Fractal, FractalExile, FractalExileTable};

impl FractalExile {
    fn new(fractal: AccountNumber, member: AccountNumber) -> Self {
        Self { fractal, member }
    }

    pub fn add(fractal: AccountNumber, member: AccountNumber) {
        check_none(Self::get(fractal, member), "member is already exiled");
        Self::new(fractal, member).save();
    }

    pub fn get(fractal: AccountNumber, member: AccountNumber) -> Option<Self> {
        FractalExileTable::read()
            .get_index_pk()
            .get(&(fractal, member))
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
