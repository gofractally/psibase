// TODO: tables

#[crate::service(name = "auth-ec-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
pub mod service {
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
    fn setKey(key: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn newAccount(account: AccountNumber, payload: PublicKey) {
        unimplemented!()
    }
}
