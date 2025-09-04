pub const CREDENTIAL_SENDER: &str = "cred-sys";

#[crate::service(name = "credentials", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;

    /// Creates a credential with the given public key
    ///
    /// This action is meant to be called inline by another service.
    /// The owner service is the service that calls this action.
    ///
    /// The corresponding private key can be used to authorize the "cred-sys" account to call
    ///   transactions containing actions on the owner service.
    #[action]
    fn create(pubkey: SubjectPublicKeyInfo) -> u32 {
        unimplemented!()
    }

    /// Looks up the credential used to sign the active transaction, and consumes (deletes) it.
    /// Can only be called by the credential's owner service.
    #[action]
    fn consume_active() -> u32 {
        unimplemented!()
    }
}
