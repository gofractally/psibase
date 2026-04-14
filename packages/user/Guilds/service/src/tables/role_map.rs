use std::u64;

use psibase::{AccountNumber, Table};

use crate::tables::tables::{RoleMap, RoleMapTable};

impl RoleMap {
    fn new(fractal: AccountNumber, role_id: u8, guild: AccountNumber) -> Self {
        Self {
            fractal,
            guild,
            role_id,
        }
    }

    fn save(&self) {
        RoleMapTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn set(fractal: AccountNumber, role_id: u8, guild: AccountNumber) {
        let new_instance = Self::new(fractal, role_id, guild);
        new_instance.save();
    }

    pub fn get(fractal: AccountNumber, role_id: u8) -> Option<Self> {
        RoleMapTable::read()
            .get_index_pk()
            .range(
                (fractal, role_id, AccountNumber::new(0))
                    ..=(fractal, role_id, AccountNumber::new(u64::MAX)),
            )
            .next()
    }
}
