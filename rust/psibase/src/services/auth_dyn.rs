pub mod policy {
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    use crate::AccountNumber;

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct WeightedAuthorizer {
        pub account: AccountNumber,
        pub weight: u8,
    }

    impl WeightedAuthorizer {
        pub fn new(account: AccountNumber, weight: u8) -> Self {
            Self { account, weight }
        }
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct DynamicAuthPolicy {
        pub threshold: u8,
        pub authorizers: Vec<WeightedAuthorizer>,
    }

    impl DynamicAuthPolicy {
        pub fn new(authorizers: Vec<WeightedAuthorizer>, threshold: u8) -> Self {
            Self {
                authorizers,
                threshold,
            }
        }

        pub fn from_sole_authorizer(account: AccountNumber) -> Self {
            Self::new(vec![WeightedAuthorizer::new(account, 1)], 1)
        }

        pub fn impossible() -> Self {
            Self::new(vec![], 1)
        }

        pub fn from_weighted_authorizers(
            accounts: Vec<(AccountNumber, u8)>,
            threshold: u8,
        ) -> Self {
            let authorizers = accounts
                .into_iter()
                .map(|(account, weight)| WeightedAuthorizer::new(account, weight))
                .collect();

            Self::new(authorizers, threshold)
        }
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
pub mod AuthDynIntf {
    use crate::{
        services::{auth_dyn::policy::DynamicAuthPolicy, transact::ServiceMethod},
        AccountNumber,
    };

    #[action]
    pub fn get_policy(account: AccountNumber, method: Option<ServiceMethod>) -> DynamicAuthPolicy {
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
        method: Option<ServiceMethod>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn set_mgmt(account: AccountNumber, manager: AccountNumber) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
