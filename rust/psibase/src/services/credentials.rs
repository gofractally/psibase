pub const CREDENTIAL_SENDER: &str = "cred-sys";

#[crate::service(name = "credentials", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod service {
    use crate::{services::auth_sig::SubjectPublicKeyInfo, TimePointSec};

    /// Creates a credential
    ///
    /// Parameters:
    /// - `pubkey`: The credential public key
    /// - `expires`: The number of seconds until the credential expires
    ///
    /// This action is meant to be called inline by another service.
    /// The caller service is the credential issuer.
    ///
    /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
    /// that matches the specified public key.
    #[action]
    fn create(pubkey: SubjectPublicKeyInfo, expires: Option<u32>) -> u32 {
        unimplemented!()
    }

    /// Looks up the credential used to sign the active transaction, and consumes it.
    /// Can only be called by the credential's issuer.
    #[action]
    fn consume_active() -> u32 {
        unimplemented!()
    }

    /// Gets the `pubkey` of the specified credential
    #[action]
    fn get_pubkey(id: u32) -> SubjectPublicKeyInfo {
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
