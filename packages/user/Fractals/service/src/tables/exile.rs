use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table};

use crate::tables::tables::{Exile, ExileTable, Fractal};

impl Exile {
    fn new(fractal: AccountNumber, member: AccountNumber) -> Self {
        Self { fractal, member }
    }

    pub fn add(fractal: AccountNumber, member: AccountNumber) {
        check_none(Self::get(fractal, member), "member is already exiled");
        Self::new(fractal, member).save();
    }

    pub fn get(fractal: AccountNumber, member: AccountNumber) -> Option<Self> {
        ExileTable::read().get_index_pk().get(&(fractal, member))
    }

    pub fn get_assert(fractal: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(fractal, member), "guild exile does not exist")
    }

    pub fn remove(&self) {
        self.erase();
    }

    fn erase(&self) {
        ExileTable::read_write().remove(&self);
    }

    fn save(&self) {
        ExileTable::read_write().put(&self).expect("failed to save");
    }
}

#[ComplexObject]
impl Exile {
    pub async fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }
}
