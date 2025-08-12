use crate::AccountNumber;
pub const VERIFY_SERVICE: AccountNumber = crate::services::verify_sig::SERVICE;

#[crate::service(name = "auth-invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
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
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn requireAuth(pubkey: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
