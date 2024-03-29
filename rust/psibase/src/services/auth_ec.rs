// TODO: tables

#[crate::service(name = "auth-ec", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{
        services::transaction_sys::ServiceMethod, AccountNumber, Action, Claim, PublicKey,
    };

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
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn setKey(key: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn newAccount(account: AccountNumber, payload: PublicKey) {
        unimplemented!()
    }
}
