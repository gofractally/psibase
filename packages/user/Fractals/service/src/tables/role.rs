use crate::tables::tables::{Role, RoleTable};
use psibase::services::{accounts, auth_any, auth_dyn};
use psibase::{check, check_none, check_some, AccountNumber, ServiceWrapper, Table};
use psibase::{services::auth_dyn::policy::DynamicAuthPolicy, Subaccount};

impl Role {
    fn new(fractal: AccountNumber, role_id: u8, occupation: AccountNumber) -> Self {
        Self {
            fractal,
            role_id,
            occupation,
        }
    }

    pub fn get(fractal: AccountNumber, role_id: u8) -> Option<Self> {
        RoleTable::read().get_index_pk().get(&(fractal, role_id))
    }

    pub fn account(&self) -> AccountNumber {
        self.fractal.with_subaccount(Subaccount(self.role_id))
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

    pub fn auth_policy(&self) -> DynamicAuthPolicy {
        psibase::services::fractals::occu_wrapper::call_to(self.occupation)
            .role_policy(self.fractal, self.role_id)
    }

    pub fn add(fractal: AccountNumber, role: u8, occupation: AccountNumber) -> Self {
        check_none(
            Self::get(fractal, role),
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

        let new_instance = Self::new(fractal, role, occupation);
        new_instance.save();
        let new_account = new_instance.account();

        accounts::Wrapper::call_as(fractal).newAccount(
            new_account,
            auth_any::Wrapper::SERVICE,
            true,
        );
        auth_dyn::Wrapper::call_as(new_account).set_mgmt(new_account, psibase::get_service());
        accounts::Wrapper::call_as(new_account).setAuthServ(auth_dyn::Wrapper::SERVICE);

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
