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
        MethodNumber::from(auth_action_structs::getDelegationsSys::ACTION_NAME),
        auth_action_structs::getDelegationsSys { sender, method },
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

/// A single account in the delegation graph: the account's auth service and the
/// deduped set of accounts it delegates authority to.
struct Delegation {
    account: AccountNumber,
    auth_service: AccountNumber,
    delegates: Vec<AccountNumber>,
}

#[derive(Clone, Copy)]
enum AuthState {
    /// The account is currently being evaluated higher up the call stack.
    /// Treating it as unauthorized breaks cycles in the delegation graph.
    Visiting,
    Resolved(bool),
}

/// Builds the delegation graph reachable from `user`, querying each account's
/// auth service for its delegations exactly once. Accounts reachable through
/// multiple paths (e.g. a multisig whose signers delegate to a common owner)
/// are therefore consolidated rather than expanded repeatedly.
///
/// `method` is only meaningful for `user`. Delegated accounts are queried with
/// `None` because staged-tx (not the auth services) is responsible for wiping
/// the method as authority propagates down the chain.
fn build_delegation_graph(user: AccountNumber, method: Option<ServiceMethod>) -> Vec<Delegation> {
    let mut graph: Vec<Delegation> = Vec::new();
    let mut stack: Vec<(AccountNumber, Option<ServiceMethod>)> = vec![(user, method)];

    while let Some((account, method)) = stack.pop() {
        if graph.iter().any(|d| d.account == account) {
            continue;
        }

        let Some(auth_service) = get_auth_service(account) else {
            continue;
        };

        let caller = auth_caller(auth_service);
        let mut delegates: Vec<AccountNumber> = Vec::new();
        for delegate in get_delegations(&caller, account, method) {
            if !delegates.contains(&delegate) {
                delegates.push(delegate);
            }
        }

        for delegate in &delegates {
            stack.push((*delegate, None));
        }

        graph.push(Delegation {
            account,
            auth_service,
            delegates,
        });
    }

    graph
}

fn set_state(memo: &mut Vec<(AccountNumber, AuthState)>, account: AccountNumber, state: AuthState) {
    if let Some(entry) = memo.iter_mut().find(|(a, _)| *a == account) {
        entry.1 = state;
    } else {
        memo.push((account, state));
    }
}

/// Determines whether `account` is authorized given the accounts that actually
/// responded (`responders`), memoizing results so each account's auth service
/// is consulted at most once.
///
/// A leaf account (one that delegates to no one) is authorized if it is among
/// the responders. Otherwise authority is derived from the delegated accounts
/// that are themselves authorized.
fn is_authorized(
    account: AccountNumber,
    user: AccountNumber,
    graph: &[Delegation],
    responders: &[AccountNumber],
    method: ServiceMethod,
    check_fn: CheckFn,
    memo: &mut Vec<(AccountNumber, AuthState)>,
) -> bool {
    if let Some((_, state)) = memo.iter().find(|(a, _)| *a == account) {
        return match state {
            AuthState::Resolved(result) => *result,
            AuthState::Visiting => false,
        };
    }

    let Some(delegation) = graph.iter().find(|d| d.account == account) else {
        set_state(memo, account, AuthState::Resolved(false));
        return false;
    };

    set_state(memo, account, AuthState::Visiting);

    let authorizers: Vec<AccountNumber> = if delegation.delegates.is_empty() {
        responders.to_vec()
    } else {
        delegation
            .delegates
            .iter()
            .copied()
            .filter(|delegate| {
                is_authorized(*delegate, user, graph, responders, method, check_fn, memo)
            })
            .collect()
    };

    // Only the originating account is checked against the requested method;
    // delegated checks have the method wiped by staged-tx.
    let method = if account == user { Some(method) } else { None };
    let caller = auth_caller(delegation.auth_service);
    let result = check_fn(&caller, account, authorizers, method);

    set_state(memo, account, AuthState::Resolved(result));
    result
}

fn check_delegation_auth(
    user: AccountNumber,
    method: ServiceMethod,
    responders: &[AccountNumber],
    check_fn: CheckFn,
) -> bool {
    let graph = build_delegation_graph(user, Some(method));
    let mut memo: Vec<(AccountNumber, AuthState)> = Vec::new();
    is_authorized(user, user, &graph, responders, method, check_fn, &mut memo)
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
