#[crate::service(name = "auth-delegate", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

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
    fn getOwner(account: AccountNumber) -> AccountNumber {
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
    fn setOwner(owner: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn newAccount(name: AccountNumber, owner: AccountNumber) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
