pub const CREDENTIAL_SENDER: &str = "cred-sys";

#[crate::service(name = "credentials", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod service {
    use crate::{
        services::{tokens::Quantity, transact::ServiceMethod},
        AccountNumber, Claim, MethodNumber, TimePointSec,
    };

    #[action]
    fn init() {
        unimplemented!()
    }

    #[allow(non_snake_case)]
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[allow(non_snake_case)]
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
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    /// Issues a credential
    ///
    /// Parameters:
    /// - `pubkey_fingerprint`: The fingerprint of the credential public key
    /// - `expires`: The number of seconds until the credential expires
    /// - `allowed_actions`: The actions that the credential is allowed to call on the issuer service
    ///
    /// This action is meant to be called inline by another service.
    /// The caller service is the credential issuer.
    ///
    /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
    /// that matches the specified public key.
    #[action]
    fn issue(
        pubkey_fingerprint: crate::Checksum256,
        expires: Option<u32>,
        allowed_actions: Vec<MethodNumber>,
    ) -> u32 {
        unimplemented!()
    }

    /// Notifies the credentials service that tokens have been credited to a credential
    ///
    /// This notification must be called after crediting the credential's service, or else
    /// the credited tokens will not be aplied to a particular credential.
    #[action]
    fn resource(id: u32, amount: Quantity) {
        unimplemented!()
    }

    /// Gets the fingerprint of the specified credential pubkey
    #[allow(non_snake_case)]
    #[action]
    fn getFingerprint(id: u32) -> crate::Checksum256 {
        unimplemented!()
    }

    /// Gets the `expiry_date` of the specified credential
    #[action]
    fn get_expiry_date(id: u32) -> Option<TimePointSec> {
        unimplemented!()
    }

    /// Gets the `id` of the active credential
    #[action]
    fn get_active() -> Option<u32> {
        unimplemented!()
    }

    /// Deletes the specified credential.
    /// Can only be called by the credential's issuer.
    #[action]
    fn consume(id: u32) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
