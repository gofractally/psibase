use lazy_static::lazy_static;

lazy_static! {
    pub static ref VERIFY_SERVICE: crate::AccountNumber = crate::services::verify_sig::SERVICE;
}

#[crate::service(name = "auth-invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
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
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn requireAuth(pubkey: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}
