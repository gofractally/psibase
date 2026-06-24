#[crate::service(name = "auth-delegate", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `transact` when an account using this auth service submits a
    /// transaction.
    ///
    /// This action forwards verification to the owning account
    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) -> bool {
        unimplemented!()
    }

    /// Gets the owner account of the specified account
    #[action]
    fn getOwner(account: AccountNumber) -> AccountNumber {
        unimplemented!()
    }

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `accounts` when an account is configured to use this auth service.
    ///
    /// Verifies that a particular user is allowed to use a particular auth service.
    ///
    /// This action allows any user who has already set an owning account with `AuthDelegate::setOwner`.
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    /// Get the accounts this auth service delegates authority to for a sender.
    #[action]
    fn getDlgsSys(sender: AccountNumber) -> Vec<AccountNumber> {
        unimplemented!()
    }

    /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being authorized.
    /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
    ///
    /// Returns:
    /// * `true`: If the sender's owner is among the authorizers
    /// * `false`: Otherwise
    #[action]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }

    /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being rejected.
    /// * `rejecters`: The set of accounts that have already authorized the rejection of the
    ///               transaction.
    ///
    /// Returns:
    /// * `true`: If the sender's owner is among the rejecters
    /// * `false`: Otherwise
    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }

    /// Set the owner of the sender account
    ///
    /// Whenever a sender using this auth service submits a transaction, authorization
    /// for the owned account will check authorization for the owner instead.
    #[action]
    fn setOwner(owner: AccountNumber) {
        unimplemented!()
    }

    /// Create a new account with the specified name, owned by the specified `owner` account.
    ///
    /// Existing accounts will not be modified. If the `requireMatch` flag
    /// is set, then the action will fail if the account exists but is not
    /// already owned by the specified owner.
    #[action]
    fn newAccount(name: AccountNumber, owner: AccountNumber, require_match: bool) -> bool {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
