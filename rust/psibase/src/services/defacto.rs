#[crate::service(name = "de-facto", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::{services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber};

    #[action]
    fn get_scores(fractal: AccountNumber) -> Vec<(AccountNumber, u32)> {
        unimplemented!()
    }

    #[action]
    fn is_active(fractal: AccountNumber, member: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn is_role_ok(fractal: AccountNumber, _role_id: u8) -> bool {
        unimplemented!()
    }

    #[action]
    fn role_policy(fractal: AccountNumber, _role_id: u8) -> DynamicAuthPolicy {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
