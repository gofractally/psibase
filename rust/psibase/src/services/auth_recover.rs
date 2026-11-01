#![allow(non_snake_case, unused_variables)]

#[crate::service(name = "auth-rcovr", dispatch = false, psibase_mod = "crate")]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
    use crate::{AccountNumber, Claim, ServiceMethod};
    #[action]
    fn checkAuthSys(
        flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn getDlgsSys(_sender: AccountNumber) -> Vec<AccountNumber> {
        unimplemented!()
    }

    #[action]
    fn isAuthSys(sender: AccountNumber, authorizers: Vec<AccountNumber>) -> bool {
        unimplemented!()
    }

    #[action]
    fn isRejectSys(sender: AccountNumber, rejecters: Vec<AccountNumber>) -> bool {
        unimplemented!()
    }

    #[action]
    fn setRecovery(recovery: AccountNumber) {
        unimplemented!()
    }

    /// Set's the senders public key
    ///
    /// Must be followed by activate. activate must be called
    /// in the same transaction, and the sender cannot run
    /// any other actions until it is.
    ///
    /// The transaction can be signed by either the regular
    /// signing key or a temporary key set by the recovery
    /// partner.
    #[action]
    fn setKey(key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Must be called after setKey in the same transaction.
    /// This verifies that the sender actually has the corresponding
    /// private key.
    ///
    /// - It detects some errors that would leave the account unusable
    /// - It limits the ability of the recovery account to change the
    ///   account key temporarily without being noticed. After changing
    ///   the key, it is impossible to restore the account to its
    ///   original state without access to the original private key.
    #[action]
    fn activate() {
        unimplemented!()
    }

    /// Sets a temporary key that can be used to reset the account key
    ///
    /// recover should be called by the recovery account.
    /// The recovery key can only be used to call setKey.
    #[action]
    fn recover(account: AccountNumber, recovery_key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Creates a new account. The recovery account will be set to the sender.
    #[action]
    fn newAccount(account: AccountNumber, key: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
