use crate::{Pack, ToKey, ToSchema, Unpack};
use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

/// Identify a service and method
///
/// An empty `service` or `method` indicates a wildcard.
#[derive(
    Copy,
    Clone,
    Debug,
    Pack,
    Unpack,
    ToKey,
    ToSchema,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "crate::fracpack")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "ServiceMethodInput")]
pub struct ServiceMethod {
    pub service: crate::AccountNumber,
    pub method: crate::MethodNumber,
}

type CallbackType = u32;

/// Authenticate actions
///
/// [transact](crate::services::transact::Actions)
/// calls into auth services using `auth_interface` to authenticate
/// senders of top-level actions and uses of
/// [runAs](crate::services::transact::Actions::runAs).
/// Any service may become an auth service by implementing
/// `auth_interface`. Any account may select any service to be
/// its authenticator. Be careful; this allows that service to
/// act on the account's behalf and that service to authorize
/// other accounts and services to act on the account's behalf.
/// It can also can lock out that account. See `AuthSig` (C++)
/// for a canonical example of implementing `auth_interface`.
///
/// This interface can't authenticate non-top-level actions other
/// than [runAs](crate::services::transact::Actions::runAs)
/// actions. Most services shouldn't call or implement
/// `auth_interface`; use `get_sender()` TODO: link.
///
/// Services implement `auth_interface` by defining actions with
/// identical signatures; there is no trait.
#[crate::service(
    name = "example-auth",
    actions = "AuthActions",
    wrapper = "AuthWrapper",
    structs = "auth_action_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod auth_interface {
    /// The database is in read-only mode. This flag is only
    /// used for `topActionReq`.
    ///
    /// Auth services shouldn't try writing to the database if
    /// readOnly is set. If they do, the transaction will abort.
    /// Auth services shouldn't skip their check based on the
    /// value of the read-only flag. If they do, they'll hurt
    /// their users, either by allowing charging where it
    /// shouldn't be allowed, or by letting actions execute
    /// using the user's auth when they shouldn't.
    pub const READ_ONLY_FLAG: u32 = 0x8000_0000;

    /// Transaction's first authorizer. This flag is only
    /// used for `topActionReq`.
    ///
    /// Auth services should be aware that if this flag
    /// is set, then only the first proof has been verified.
    /// If they rely on other proofs when this flag is set,
    /// they'll open up the accounts they're trying to
    /// protect to resource billing attacks.
    pub const FIRST_AUTH_FLAG: u32 = 0x4000_0000;

    /// Bits which identify kind of request
    pub const REQUEST_MASK: u32 = 0x0000_00ff;

    /// Top-level action
    pub const TOP_ACTION_REQ: u32 = 0x01;

    /// `runAs` request. The requester matches the action's
    /// sender.
    ///
    /// Auth services should normally approve this unless
    /// they enforce stronger rules, e.g. by restricting
    /// `action` or `allowedActions`.
    pub const RUN_AS_REQUESTER_REQ: u32 = 0x02;

    /// `runAs` request. The request matches the criteria from
    /// a `runAs` request currently in the call stack. `requester`
    /// matches the earlier `action.service`. `action` matches
    /// one of the earlier `allowedActions` from the same request.
    ///
    /// Auth services should normally approve this unless
    /// they enforce stronger rules.
    pub const RUN_AS_MATCHED_REQ: u32 = 0x03;

    /// `runAs` request. Same as `runAsMatched`, except the
    /// requestor provided a non-empty `allowedActions`. This
    /// expands the authority beyond what was originally granted.
    ///
    /// Auth services should normally reject this unless
    /// they have filtering criteria which allow it.
    pub const RUN_AS_MATCHED_EXPANDED_REQ: u32 = 0x04;

    /// `runAs` request. The other criteria don't match.
    ///
    /// Auth services should normally reject this unless
    /// they have filtering criteria which allow it.
    pub const RUN_AS_OTHER_REQ: u32 = 0x05;

    /// Authenticate a top-level action or a `runAs` action
    ///
    /// * `flags`:          One of the Req (request) constants,
    ///                     or'ed with 0 or more of the flag
    ///                     constants
    /// * `requester`:      `""` if this is a top-level action, or
    ///                     the sender of the `runAs` action.
    ///                     This is often different from
    ///                     `action.sender`.
    /// * `action`:         Action to authenticate
    /// * `allowedActions`: Argument from `runAs`
    /// * `claims`:         Claims in transaction (e.g. public keys).
    ///                     Empty if `runAs`
    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: crate::AccountNumber,
        action: crate::Action,
        allowedActions: Vec<crate::services::transact::ServiceMethod>,
        claims: Vec<crate::Claim>,
    ) {
        unimplemented!()
    }

    /// Verify that a particular user is allowed to use a
    /// particular auth service. Allows auth services to use user
    /// whitelists.
    ///
    /// Called by Accounts.
    ///
    /// * `user`:  The user being checked
    #[action]
    fn canAuthUserSys(user: crate::AccountNumber) {
        unimplemented!()
    }

    /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being authorized.
    /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
    /// * `authSet`: The set of accounts that are already being checked for authorization.
    ///              If the sender is already in this set, then the function should return false.
    ///
    /// Returns:
    /// * `true`: The authorizers are sufficient to authorize a transaction from the sender.
    /// * `false`: The authorizers are not sufficient to authorize a transaction from the sender.
    #[action]
    fn isAuthSys(
        sender: crate::AccountNumber,
        authorizers: Vec<crate::AccountNumber>,
        authSet: Option<Vec<crate::AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being rejected.
    /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
    /// * `authSet`: The set of accounts that are already being checked for authorization.
    ///              If the sender is already in this set, then the function should return false.
    ///
    /// Returns:
    /// * `true`: The rejecters are sufficient to reject a transaction from the sender.
    /// * `false`: The rejecters are not sufficient to reject a transaction from the sender.
    #[action]
    fn isRejectSys(
        sender: crate::AccountNumber,
        rejecters: Vec<crate::AccountNumber>,
        authSet: Option<Vec<crate::AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }
}

/// All transactions enter the chain through this service
///
/// This privileged service dispatches top-level actions to other
/// services, checks TAPoS, detects duplicate transactions, and
/// checks authorizations using
/// [auth_interface](crate::services::transact::auth_interface).
///
/// Other services use it to get information about the chain,
/// current block, and head block. They also use it to call actions
/// using other accounts' authorities via
/// [runAs](crate::services::transact::Actions::runAs).
// TODO: tables
// TODO: service flags
#[crate::service(name = "transact", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::CallbackType;
    use crate::{Action, Checksum256, Hex, Seconds, Transaction};
    use fracpack::Nested;

    /// Only called once, immediately after the boot transaction.
    ///
    /// The subsequent transactions listed must be pushed in order, and no
    /// other transactions will be accepted until finishBoot is run.
    #[action]
    fn startBoot(bootTransactions: Vec<crate::Checksum256>) {
        unimplemented!();
    }

    /// Only called once during chain initialization
    ///
    /// This enables the auth checking system. Before this point, `transact`
    /// allows all transactions to execute without auth checks. After this point,
    /// `transact` uses
    /// [checkAuthSys](crate::services::transact::AuthActions::checkAuthSys)
    /// to authenticate top-level actions and uses of [runAs](Self::runAs).
    #[action]
    fn finishBoot() {
        unimplemented!()
    }

    /// Called by native code at the beginning of each block
    #[action]
    fn startBlock() {
        unimplemented!()
    }

    /// Called by RTransact to execute a transaction speculatively
    #[action]
    fn execTrx(trx: Nested<Transaction>, speculative: bool) {
        unimplemented!()
    }

    /// Sets the time between snapshots
    ///
    /// A value of 0 will disable snapshots. This is a chain-wide
    /// setting because snapshots are signed by the block producers.
    #[action]
    fn setSnapTime(seconds: Seconds) {
        unimplemented!()
    }

    /// Adds a callback that will be run whenever the trigger happens.
    /// - onTransaction is run at the end of every transaction
    /// - onBlock runs at the end of every block
    ///
    /// Objective callbacks are run by the transaction service and
    /// must have this service as the sender. If an objective callback
    /// fails, it will abort the block or transaction.
    ///
    /// Subjective callbacks are run by native and must have no sender.
    ///
    /// Callbacks are unique. `addCallback` will have no effect if an
    /// identical callback is already registered.
    ///
    /// The order in which callbacks are executed is unspecified.
    #[action]
    fn addCallback(type_: CallbackType, objective: bool, act: Action) {
        unimplemented!()
    }
    /// Removes an existing callback
    #[action]
    fn removeCallback(type_: CallbackType, objective: bool, act: Action) {
        unimplemented!()
    }

    /// Run `action` using `action.sender's` authority
    ///
    /// Also adds `allowedActions` to the list of actions that `action.service`
    /// may perform on `action.sender's` behalf, for as long as this call to
    /// `runAs` is in the call stack. Use `""` for `service` in
    /// `allowedActions` to allow use of any service (danger!). Use `""` for
    /// `method` to allow any method.
    ///
    /// Returns the action's return value, if any.
    ///
    /// This will succeed if any of the following are true:
    /// * `get_sender() == action.sender's authService`
    /// * `get_sender() == action.sender`. Requires `action.sender's authService`
    ///   to approve with flag
    ///   [RUN_AS_REQUESTER_REQ](crate::services::transact::auth_interface::RUN_AS_REQUESTER_REQ)
    ///   (normally succeeds).
    /// * An existing `runAs` is currently on the call stack, `get_sender()` matches
    ///   `action.service` on that earlier call, and `action` matches
    ///   `allowedActions` from that same earlier call. Requires `action.sender's
    ///   authService` to approve with flag
    ///   [RUN_AS_MATCHED_REQ](crate::services::transact::auth_interface::RUN_AS_MATCHED_REQ)
    ///   if `allowedActions` is empty (normally succeeds), or
    ///   [RUN_AS_MATCHED_EXPANDED_REQ](crate::services::transact::auth_interface::RUN_AS_MATCHED_EXPANDED_REQ)
    ///   if not empty (normally fails).
    /// * All other cases, requires `action.sender's authService`
    ///   to approve with flag [RUN_AS_OTHER_REQ](crate::services::transact::auth_interface::RUN_AS_OTHER_REQ)
    ///   (normally fails).
    #[action]
    fn runAs(
        action: crate::Action,
        allowedActions: Vec<crate::services::transact::ServiceMethod>,
    ) -> Hex<Vec<u8>> {
        unimplemented!()
    }

    /// Checks authorization for the sender of the first action
    #[action]
    fn checkFirstAuth(id: Checksum256, transaction: Transaction) -> bool {
        unimplemented!()
    }

    /// Get the currently executing transaction
    #[action]
    fn getTransaction() -> crate::Transaction {
        unimplemented!()
    }

    /// Get the current block header
    #[action]
    fn currentBlock() -> crate::BlockHeader {
        unimplemented!()
    }

    /// Get the head block header
    ///
    /// This is *not* the currently executing block.
    /// See [currentBlock](Self::currentBlock).
    #[action]
    fn headBlock() -> crate::BlockHeader {
        unimplemented!()
    }

    /// Get the head block time
    ///
    /// This is *not* the currently executing block time.
    /// TODO: remove
    #[action]
    fn headBlockTime() -> crate::TimePointSec {
        unimplemented!()
    }
}

// TODO: inline functions in Transact.hpp

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
