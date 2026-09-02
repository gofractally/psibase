use crate::helpers::create_managed_account;
use crate::tables::tables::{Role, RoleTable};
use async_graphql::ComplexObject;
use psibase::services::auth_dyn::policy::DynamicAuthPolicy;
use psibase::{AccountNumber, ServiceWrapper, Subaccount, Table};

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
        Self::get(fractal, role_id).expect(&format!(
            "role with id {} does not exist for fractal {}",
            role_id,
            fractal.to_string()
        ))
    }

    pub fn auth_policy(&self) -> DynamicAuthPolicy {
        psibase::services::fractals::occu_wrapper::call_to(self.occupation)
            .role_policy(self.fractal, self.role_id)
    }

    pub fn add(fractal: AccountNumber, role: u8, occupation: AccountNumber) -> Self {
        assert!(
            Self::get(fractal, role).is_none(),
            "role with id {} already exists for fractal {}",
            role as u8,
            fractal.to_string()
        );
        assert!(
            psibase::services::accounts::Wrapper::call().exists(occupation),
            "occupation account does not exist",
        );

        let new_instance = Self::new(fractal, role, occupation);
        new_instance.save();
        create_managed_account(new_instance.account(), || {});

        new_instance
    }

    pub fn set_occupation(&mut self, new_occupation: AccountNumber) {
        assert!(
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

#[ComplexObject]
impl Role {
    #[graphql(name = "account")]
    async fn role_account(&self) -> AccountNumber {
        self.account()
    }
}
