#[crate::service(name = "auth-delegate", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Action, Claim};

    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        action: Action,
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
    fn setOwner(owner: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn newAccount(name: AccountNumber, owner: AccountNumber) {
        unimplemented!()
    }
}
