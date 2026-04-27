use crate::{
    constants::FractalRole,
    helpers::create_managed_account,
    tables::tables::{Role, RoleTable},
};
use psibase::{check, check_none, check_some, AccountNumber, Table};

impl Role {
    fn new(
        fractal: AccountNumber,
        account: AccountNumber,
        role: FractalRole,
        occupation: AccountNumber,
    ) -> Self {
        Self {
            fractal,
            account,
            role_id: role.into(),
            occupation,
        }
    }

    pub fn get(fractal: AccountNumber, role: FractalRole) -> Option<Self> {
        RoleTable::read()
            .get_index_pk()
            .get(&(fractal, role.into()))
    }

    pub fn get_assert(fractal: AccountNumber, role: FractalRole) -> Self {
        check_some(
            Self::get(fractal, role),
            &format!(
                "role with id {} does not exist for fractal {}",
                role as u8,
                fractal.to_string()
            ),
        )
    }

    pub fn get_by_role_account(role_account: AccountNumber) -> Option<Self> {
        RoleTable::read()
            .get_index_by_role_account()
            .get(&role_account)
    }

    pub fn add(
        fractal: AccountNumber,
        account: AccountNumber,
        role: FractalRole,
        occupation: AccountNumber,
    ) -> Self {
        check_none(
            Self::get(fractal, role.into()),
            &format!(
                "role with id {} already exists for fractal {}",
                role as u8,
                fractal.to_string()
            ),
        );
        check(
            psibase::services::accounts::Wrapper::call().exists(occupation),
            "occupation account does not exist",
        );

        let new_instance = Self::new(fractal, account, role, occupation);
        new_instance.save();

        create_managed_account(account, || {});

        new_instance
    }

    pub fn set_occupation(&mut self, new_occupation: AccountNumber) {
        check(
            psibase::services::fractals::occu_wrapper::call_to(new_occupation)
                .is_role_ok(self.fractal, self.role_id),
            "occupation does not support role",
        );

        self.occupation = new_occupation;
        self.save();
    }

    fn save(&self) {
        RoleTable::read_write().put(&self).unwrap();
    }
}
