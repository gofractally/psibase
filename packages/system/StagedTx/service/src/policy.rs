use psibase::services::accounts::Wrapper as Accounts;
use psibase::services::transact::auth_interface::auth_action_structs;
use psibase::services::transact::ServiceMethod;
use psibase::{AccountNumber, Caller, MethodNumber, ServiceCaller};

use crate::service::Wrapper;

pub fn get_auth_service(sender: AccountNumber) -> Option<AccountNumber> {
    Accounts::call().getAccount(sender).map(|a| a.authService)
}

fn auth_caller(auth_service: AccountNumber) -> ServiceCaller {
    ServiceCaller {
        sender: Wrapper::SERVICE,
        service: auth_service,
        flags: 0,
    }
}

fn get_delegations(
    caller: &ServiceCaller,
    sender: AccountNumber,
    method: Option<ServiceMethod>,
) -> Vec<AccountNumber> {
    caller.call(
        MethodNumber::from(auth_action_structs::getDlgsSys::ACTION_NAME),
        auth_action_structs::getDlgsSys { sender, method },
    )
}

fn is_auth_sys(
    caller: &ServiceCaller,
    sender: AccountNumber,
    authorizers: Vec<AccountNumber>,
    method: Option<ServiceMethod>,
) -> bool {
    caller.call(
        MethodNumber::from(auth_action_structs::isAuthSys::ACTION_NAME),
        auth_action_structs::isAuthSys {
            sender,
            authorizers,
            method,
        },
    )
}

fn is_reject_sys(
    caller: &ServiceCaller,
    sender: AccountNumber,
    rejecters: Vec<AccountNumber>,
    method: Option<ServiceMethod>,
) -> bool {
    caller.call(
        MethodNumber::from(auth_action_structs::isRejectSys::ACTION_NAME),
        auth_action_structs::isRejectSys {
            sender,
            rejecters,
            method,
        },
    )
}

type CheckFn = fn(&ServiceCaller, AccountNumber, Vec<AccountNumber>, Option<ServiceMethod>) -> bool;

/// A single account in the method-wiped delegation graph that still needs
/// delegate-based resolution: its auth service and the deduped set of accounts
/// it delegates authority to.
struct Delegation {
    account: AccountNumber,
    auth_service: AccountNumber,
    delegates: Vec<AccountNumber>,
}

/// Fetches an account's delegations, deduped while preserving order.
fn deduped_delegations(
    caller: &ServiceCaller,
    account: AccountNumber,
    method: Option<ServiceMethod>,
) -> Vec<AccountNumber> {
    let mut delegates: Vec<AccountNumber> = Vec::new();
    for delegate in get_delegations(caller, account, method) {
        if !delegates.contains(&delegate) {
            delegates.push(delegate);
        }
    }
    delegates
}

/// The authorizers available to an account without resolving any delegate: the
/// responders themselves for a leaf, or the delegates that responded directly.
fn direct_authorizers(
    delegates: &[AccountNumber],
    responders: &[AccountNumber],
) -> Vec<AccountNumber> {
    if delegates.is_empty() {
        responders.to_vec()
    } else {
        delegates
            .iter()
            .copied()
            .filter(|delegate| responders.contains(delegate))
            .collect()
    }
}

/// The authorizers backing an account once its delegates have been resolved: the
/// delegates that either responded directly or came out authorized.
fn resolved_authorizers(
    delegates: &[AccountNumber],
    responders: &[AccountNumber],
    authorized: &[AccountNumber],
) -> Vec<AccountNumber> {
    delegates
        .iter()
        .copied()
        .filter(|delegate| responders.contains(delegate) || authorized.contains(delegate))
        .collect()
}

/// Resolves the delegation graph reachable from `seeds` and returns the set of
/// accounts that come out authorized (i.e. that can act as authorizers for the
/// accounts delegating to them).
///
/// Every account here is queried and checked with the method wiped (`None`),
/// because staged-tx drops the method as authority propagates down the chain;
/// the originating, method-bearing account is handled separately by the caller.
///
/// The graph is explored top-down while authority is resolved bottom-up. Several
/// optimizations keep the number of (cross-service) auth queries small:
///
/// * Each account's auth service is queried for its delegations exactly once.
///   Accounts reachable through multiple paths (e.g. a multisig whose signers
///   delegate to a common owner) are consolidated rather than expanded
///   repeatedly.
/// * If an account is already authorized by the accounts that responded
///   directly, it is short-circuited: it is marked authorized and its delegates
///   are never fetched or expanded, since they cannot change its outcome.
/// * Accounts are recorded in post-order (delegates before the accounts that
///   delegate to them), so a single bottom-up pass resolves chains and trees.
///   The fixpoint loop only performs additional passes when the graph contains
///   cycles.
/// * Once every delegate of an account is resolved (known to be authorized or
///   known to fail) and the account still isn't authorized, it is marked as
///   known to fail and is never revisited.
fn resolve_authorizations(
    seeds: &[AccountNumber],
    responders: &[AccountNumber],
    check_fn: CheckFn,
) -> Vec<AccountNumber> {
    enum Frame {
        Enter(AccountNumber),
        Exit(Delegation),
    }

    let mut stack: Vec<Frame> = seeds.iter().map(|seed| Frame::Enter(*seed)).collect();
    let mut graph: Vec<Delegation> = Vec::new();
    let mut seen: Vec<AccountNumber> = Vec::new();
    let mut authorized: Vec<AccountNumber> = Vec::new();
    let mut failed: Vec<AccountNumber> = Vec::new();

    // Top-down expansion. Records `graph` in post-order and resolves every
    // account that can be decided without recursing into its delegates.
    while let Some(frame) = stack.pop() {
        let account = match frame {
            // Reached on the way back up: every delegate has been expanded, so
            // recording the account now keeps `graph` in post-order.
            Frame::Exit(delegation) => {
                graph.push(delegation);
                continue;
            }
            Frame::Enter(account) => account,
        };

        if seen.contains(&account) {
            continue;
        }
        seen.push(account);

        let Some(auth_service) = get_auth_service(account) else {
            // An account with no auth service can never become authorized.
            failed.push(account);
            continue;
        };

        let caller = auth_caller(auth_service);
        let delegates = deduped_delegations(&caller, account, None);

        if check_fn(
            &caller,
            account,
            direct_authorizers(&delegates, responders),
            None,
        ) {
            // Authorized already; its delegates can't change that, so skip them.
            authorized.push(account);
            continue;
        }

        if delegates.is_empty() {
            // A leaf the responders don't satisfy can never be authorized.
            failed.push(account);
            continue;
        }

        // Defer to bottom-up resolution: schedule the account's exit (so it is
        // recorded after its delegates) and queue the delegates for expansion.
        stack.push(Frame::Exit(Delegation {
            account,
            auth_service,
            delegates: delegates.clone(),
        }));
        for delegate in delegates {
            stack.push(Frame::Enter(delegate));
        }
    }

    // Bottom-up resolution. Thanks to post-order, a single pass resolves chains
    // and trees; the loop only iterates further when the graph has cycles.
    let mut changed = true;
    while changed {
        changed = false;

        for delegation in &graph {
            if authorized.contains(&delegation.account) || failed.contains(&delegation.account) {
                continue; // already resolved; both sets are monotonic
            }

            let authorizers = resolved_authorizers(&delegation.delegates, responders, &authorized);

            let caller = auth_caller(delegation.auth_service);
            if check_fn(&caller, delegation.account, authorizers, None) {
                authorized.push(delegation.account);
                changed = true;
            } else if delegation
                .delegates
                .iter()
                .all(|delegate| authorized.contains(delegate) || failed.contains(delegate))
            {
                // Every delegate is resolved and the account still isn't
                // authorized, so it never can be: mark it as known to fail.
                failed.push(delegation.account);
                changed = true;
            }
        }
    }

    authorized
}

/// Determines whether `user` is authorized given the accounts that actually
/// responded (`responders`).
///
/// A leaf account (one that delegates to no one) is authorized if the responders
/// satisfy its auth service. Otherwise authority is derived from the delegated
/// accounts that are themselves authorized.
///
/// The requested `method` is only applied to the originating `user`; every
/// account reached through a delegation is checked with the method wiped. Since
/// nothing delegates *to* the originating invocation (delegate edges always lead
/// to method-wiped nodes), `user` is the single special node: it is resolved
/// here directly, while [`resolve_authorizations`] handles the uniform,
/// method-wiped remainder of the graph. A method-wiped `user` reached through a
/// delegation cycle is therefore resolved independently of this check.
fn check_delegation_auth(
    user: AccountNumber,
    method: ServiceMethod,
    responders: &[AccountNumber],
    check_fn: CheckFn,
) -> bool {
    let method = Some(method);

    let Some(auth_service) = get_auth_service(user) else {
        return false;
    };
    let caller = auth_caller(auth_service);
    let delegates = deduped_delegations(&caller, user, method);

    // Short-circuit: already authorized by the accounts that responded directly.
    if check_fn(
        &caller,
        user,
        direct_authorizers(&delegates, responders),
        method,
    ) {
        return true;
    }

    if delegates.is_empty() {
        // A leaf the responders don't satisfy can never be authorized.
        return false;
    }

    // Otherwise authority must flow up from `user`'s delegates. Resolve them (and
    // the rest of the graph) with the method wiped, then re-check `user` against
    // the requested method with whichever delegates came out authorized.
    let authorized = resolve_authorizations(&delegates, responders, check_fn);
    let authorizers = resolved_authorizers(&delegates, responders, &authorized);
    check_fn(&caller, user, authorizers, method)
}

pub struct StagedTxPolicy {
    user: AccountNumber,
}
impl StagedTxPolicy {
    pub fn new(user: AccountNumber) -> Option<Self> {
        get_auth_service(user).map(|_| StagedTxPolicy { user })
    }

    pub fn does_auth(&self, accepters: Vec<AccountNumber>, method: ServiceMethod) -> bool {
        check_delegation_auth(self.user, method, &accepters, is_auth_sys)
    }

    pub fn does_reject(&self, rejecters: Vec<AccountNumber>, method: ServiceMethod) -> bool {
        check_delegation_auth(self.user, method, &rejecters, is_reject_sys)
    }
}
