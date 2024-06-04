// TODO: tables

/// The `auth-sig` service is an auth service that can be used to authenticate actions for accounts.
///
/// Any account using this auth service must store in this service a public key that they own.
/// This service will ensure that the specified public key is included in the transaction claims for any
/// transaction sent by this account.
///
/// This service supports K1 or R1 keys (Secp256K1 or Secp256R1) keys.
#[crate::service(name = "auth-sig", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Action, Claim};

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `transact` when an account using this auth service submits a
    /// transaction.
    ///
    /// This action verifies that the transaction contains a claim for the user's public key.
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

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `accounts` when an account is configured to use this auth service.
    ///
    /// Verifies that a particular user is allowed to use a particular auth service.
    ///
    /// This action allows any user who has already set a public key using `AuthSig::setKey`.
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    /// Set the sender's public key
    ///
    /// This is the public key that must be claimed by the transaction whenever a sender using this auth service
    /// submits a transaction.
    #[action]
    fn setKey(key: Vec<u8>) {
        unimplemented!()
    }
}
