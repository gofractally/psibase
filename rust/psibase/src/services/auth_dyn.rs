pub mod interfaces {
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    use crate::AccountNumber;

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SingleAuth {
        pub authorizer: AccountNumber,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct WeightedAuthorizer {
        pub account: AccountNumber,
        pub weight: u8,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct MultiAuth {
        pub threshold: u8,
        pub authorizers: Vec<WeightedAuthorizer>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub enum DynamicAuthPolicy {
        Single(SingleAuth),
        Multi(MultiAuth),
    }
}

#[crate::service(
    name = "auth-dyn-it",
    actions = "int_actions",
    wrapper = "int_wrapper",
    structs = "int_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Int {
    use crate::{services::auth_dyn::interfaces::DynamicAuthPolicy, AccountNumber};

    #[action]
    pub fn get_policy(account: AccountNumber) -> DynamicAuthPolicy {
        unimplemented!()
    }

    #[action]
    pub fn has_policy(account: AccountNumber) -> bool {
        unimplemented!()
    }
}

#[crate::service(name = "auth-dyn", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

    #[action]
    fn newAccount(account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        unimplemented!()
    }

    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn set_policy(account: AccountNumber, policy: AccountNumber) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
