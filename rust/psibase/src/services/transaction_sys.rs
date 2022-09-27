/// Identify a service and method
///
/// An empty `service` or `method` indicates a wildcard.
#[derive(crate::Fracpack)]
#[fracpack(fracpack_mod = "crate::fracpack")]
pub struct ServiceMethod {
    service: crate::AccountNumber,
    method: crate::MethodNumber,
}

/// Authenticate actions
///
/// [TransactionSys] calls into auth services using this interface
/// to authenticate senders of top-level actions and uses of
/// [TransactionSys::runAs]. Any service may become an auth
/// service by implementing `AuthInterface`. Any account may
/// select any service to be its authenticator. Be careful;
/// this allows that service to act on the account's behalf and
/// that service to authorize other accounts and services to
/// act on the account's behalf. It can also can lock out that
/// account. See `AuthEcSys` for a canonical example of
/// implementing this interface.
///
/// This interface can't authenticate non-top-level actions other
/// than [TransactionSys::runAs] actions. Most services shouldn't
/// call or implement `AuthInterface`; use `getSender()`.
///
/// Auth services shouldn't inherit from this struct. Instead,
/// they should define methods with matching signatures.
#[crate::service(dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
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
    pub fn checkAuthSys(
        flags: u32,
        requester: crate::AccountNumber,
        action: crate::Action,
        allowedActions: Vec<crate::services::transaction_sys::ServiceMethod>,
        claims: Vec<crate::Claim>,
    ) {
        unimplemented!()
    }
}

/// All transactions enter the chain through this service
///
/// This privileged service dispatches top-level actions to other
/// services, checks TAPoS, detects duplicate transactions, and
/// checks authorizations using [SystemService::AuthInterface].
///
/// Other services use it to get information about the chain,
/// current block, and head block. They also use it to call actions
/// using other accounts' authorities via [runAs].
// TODO: tables
// TODO: service flags
#[crate::service(dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
pub mod service {
    pub const SERVICE: crate::AccountNumber =
        crate::AccountNumber::new(crate::account_raw!("transact-sys"));

    /// Only called once during chain initialization
    ///
    /// This enables the auth checking system. Before this point, `TransactionSys`
    /// allows all transactions to execute without auth checks. After this point,
    /// `TransactionSys` uses [AuthInterface::checkAuthSys] to authenticate
    /// top-level actions and uses of [runAs].
    #[action]
    pub fn init() {
        unimplemented!()
    }

    /// Called by native code at the beginning of each block
    #[action]
    pub fn startBlock() {
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
    /// * `getSender() == action.sender's authService`
    /// * `getSender() == action.sender`. Requires `action.sender's authService`
    ///   to approve with flag `AuthInterface::runAsRequesterReq` (normally succeeds).
    /// * An existing `runAs` is currently on the call stack, `getSender()` matches
    ///   `action.service` on that earlier call, and `action` matches
    ///   `allowedActions` from that same earlier call. Requires `action.sender's
    ///   authService` to approve with flag `AuthInterface::runAsMatchedReq`
    ///   if `allowedActions` is empty (normally succeeds), or
    ///   `AuthInterface::runAsMatchedExpandedReq` if not empty (normally fails).
    /// * All other cases, requires `action.sender's authService`
    ///   to approve with flag `AuthInterface::runAsOtherReq` (normally fails).
    #[action]
    pub fn runAs(
        action: crate::Action,
        allowedActions: Vec<crate::services::transaction_sys::ServiceMethod>,
    ) -> Vec<u8> {
        unimplemented!()
    }

    /// Get the currently executing transaction
    #[action]
    pub fn getTransaction() -> crate::Transaction {
        unimplemented!()
    }

    /// Get the current block header
    #[action]
    pub fn currentBlock() -> crate::BlockHeader {
        unimplemented!()
    }

    /// Get the head block header
    ///
    /// This is *not* the currently executing block.
    /// See [currentBlock].
    #[action]
    pub fn headBlock() -> crate::BlockHeader {
        unimplemented!()
    }

    /// Get the head block time
    ///
    /// This is *not* the currently executing block time.
    /// TODO: remove
    #[action]
    pub fn headBlockTime() -> crate::TimePointSec {
        unimplemented!()
    }
}

// TODO: inline functions in TransactionSys.hpp
