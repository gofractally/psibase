use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

pub use crate::services::auth_sig::SubjectPublicKeyInfo;

#[derive(
    Debug, Clone, Pack, Unpack, Serialize, Deserialize, ToSchema, PartialEq, Eq,
)]
#[fracpack(fracpack_mod = "fracpack")]
/// One action the account's key is allowed to authorize.
pub struct AllowedAction {
    pub service: crate::AccountNumber,
    pub method: crate::MethodNumber,
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
/// Stored authorization for an account that uses `auth-scope`.
pub struct AuthScopeRow {
    pub account: crate::AccountNumber,
    pub pubkey: SubjectPublicKeyInfo,
    pub owner: crate::AccountNumber,
    pub allowed: Vec<AllowedAction>,
}

/// Auth service for an account whose key may authorize only whitelisted actions.
///
/// The key cannot authorize an action on `auth-scope`.
#[crate::service(name = "auth-scope", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::{AllowedAction, AuthScopeRow, SubjectPublicKeyInfo};
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

    /// Authenticate `sender` for `action`.
    ///
    /// A `verify-sig` claim must carry `pubkey`. When `firstAuthFlag` is set, that claim must be
    /// first. The action must match `allowed` and must not target `auth-scope`.
    ///
    /// Returns false if the claim is missing, the action is not whitelisted, or the action
    /// targets `auth-scope`. Aborts only when `sender` has no row.
    #[action]
    fn checkAuthSys(
        flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
        unimplemented!()
    }

    /// Aborts unless `user` has a row.
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    /// Get the accounts this auth service delegates authority to for a sender.
    #[action]
    fn getDlgsSys(sender: AccountNumber, method: Option<ServiceMethod>) -> Vec<AccountNumber> {
        unimplemented!()
    }

    /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
    /// transaction from a specified sender.
    ///
    /// Returns `true` if the sender's `owner` is among the authorizers. Aborts when `sender` has no row.
    #[action]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }

    /// Check whether a specified set of rejecter accounts are sufficient to reject a transaction
    /// from a specified sender.
    ///
    /// Returns `true` if the sender's `owner` is among the rejecters. Aborts when `sender` has no row.
    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }

    /// Creates `name` on this auth service and stores its row.
    ///
    /// Aborts if `owner` does not exist or `name` already exists.
    #[action]
    fn newAccount(
        name: AccountNumber,
        key: SubjectPublicKeyInfo,
        owner: AccountNumber,
        allowed: Vec<AllowedAction>,
    ) {
        unimplemented!()
    }

    /// Returns the stored row, if any.
    #[action]
    fn get(account: AccountNumber) -> Option<AuthScopeRow> {
        unimplemented!()
    }

    /// Replaces `account`'s authorized public key. The sender must be the row's `owner`.
    ///
    /// Aborts if `account` has no row or the sender is not the row's `owner`.
    #[action]
    fn setKey(account: AccountNumber, key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Replaces `account`'s action whitelist. The sender must be the row's `owner`.
    ///
    /// Aborts if `account` has no row or the sender is not the row's `owner`.
    #[action]
    fn setAllowed(account: AccountNumber, allowed: Vec<AllowedAction>) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
