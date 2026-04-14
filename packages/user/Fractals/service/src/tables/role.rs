use crate::tables::tables::{Role, RoleTable};
use psibase::{check_none, check_some, AccountNumber, Table};

impl Role {
    fn new(
        fractal: AccountNumber,
        account: AccountNumber,
        role_id: u8,
        occupation: AccountNumber,
    ) -> Self {
        Self {
            fractal,
            account,
            role_id,
            occupation,
        }
    }

    pub fn get(fractal: AccountNumber, role_id: u8) -> Option<Self> {
        RoleTable::read().get_index_pk().get(&(fractal, role_id))
    }

    pub fn get_assert(fractal: AccountNumber, role_id: u8) -> Self {
        check_some(
            Self::get(fractal, role_id),
            &format!(
                "role with id {} does not exist for fractal {}",
                role_id,
                fractal.to_string()
            ),
        )
    }

    pub fn get_by_account(account: AccountNumber) -> Option<Self> {
        RoleTable::read().get_index_by_account().get(&account)
    }

    pub fn add(
        fractal: AccountNumber,
        account: AccountNumber,
        role_id: u8,
        occupation: AccountNumber,
    ) -> Self {
        check_none(
            Self::get(fractal, role_id),
            &format!(
                "role with id {} already exists for fractal {}",
                role_id,
                fractal.to_string()
            ),
        );

        let new_instance = Self::new(fractal, account, role_id, occupation);
        new_instance.save();
        new_instance
    }

    pub fn set_occupation(&mut self, new_occupation: AccountNumber) {
        self.occupation = new_occupation;
        self.save();
    }

    fn save(&self) {
        RoleTable::read_write().put(&self).unwrap();
    }
}
