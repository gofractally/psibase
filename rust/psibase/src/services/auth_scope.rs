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
#[crate::service(name = "auth-scope", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::{AllowedAction, AuthScopeRow, SubjectPublicKeyInfo};
    use crate::{
        services::accounts::NewAccountMode, services::transact::ServiceMethod, AccountNumber, Claim,
    };

    /// Authenticate `sender` for `action`.
    ///
    /// A `verify-sig` claim must carry `pubkey`. The action must match `allowed`.
    ///
    /// Returns false if the claim is missing or the action is not whitelisted. Aborts only when
    /// `sender` has no row.
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
    /// Returns `true` if the sender's `owner` is among the authorizers, or the sender is among
    /// the authorizers and `method` is whitelisted for the sender. Aborts when `sender` has no row.
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
    /// Returns `true` if the sender's `owner` is among the rejecters, or the sender is among
    /// the rejecters and `method` is whitelisted for the sender. Aborts when `sender` has no row.
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
    /// The behavior if `name` already exists is determined by `mode`:
    /// * `requireNew`: aborts.
    /// * `matchExisting`: aborts unless `name` uses this auth service and its row already has
    ///   this `key`, `owner`, and `allowed`. Changes nothing, so any sender may call it.
    /// * `keepExisting`: replaces the row's `key`, `owner`, and `allowed`. The sender must be the
    ///   row's current `owner`.
    ///
    /// Aborts if `owner` does not exist, or if `owner` is `name` or is owned by `name`.
    ///
    /// Returns true if an account was created.
    #[action]
    fn newAccount(
        name: AccountNumber,
        key: SubjectPublicKeyInfo,
        owner: AccountNumber,
        allowed: Vec<AllowedAction>,
        mode: NewAccountMode,
    ) -> bool {
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

    /// Replaces `account`'s owning account. The sender must be the row's `owner`.
    ///
    /// Aborts if `account` has no row, the sender is not the row's `owner`, `owner` does not
    /// exist, or ownership would be circular.
    #[action]
    fn setOwner(account: AccountNumber, owner: AccountNumber) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
