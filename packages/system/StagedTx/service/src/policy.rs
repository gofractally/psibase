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

/// A single account in the delegation graph: the account's auth service and the
/// deduped set of accounts it delegates authority to.
struct Delegation {
    account: AccountNumber,
    auth_service: AccountNumber,
    delegates: Vec<AccountNumber>,
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

/// Determines whether `user` is authorized given the accounts that actually
/// responded (`responders`).
///
/// A leaf account (one that delegates to no one) is authorized if it is among
/// the responders. Otherwise authority is derived from the delegated accounts
/// that are themselves authorized.

fn check_delegation_auth(
    user: AccountNumber,
    method: ServiceMethod,
    responders: &[AccountNumber],
    check_fn: CheckFn,
) -> bool {
    let graph = build_delegation_graph(user, Some(method));
    let mut authorized: Vec<AccountNumber> = Vec::new();

    loop {
        let mut changed = false;

        for delegation in &graph {
            if authorized.contains(&delegation.account) {
                continue; // monotonic: once authorized, stays authorized
            }

            let authorizers: Vec<AccountNumber> = if delegation.delegates.is_empty() {
                responders.to_vec()
            } else {
                delegation
                    .delegates
                    .iter()
                    .copied()
                    .filter(|delegate| {
                        responders.contains(delegate) || authorized.contains(delegate)
                    })
                    .collect()
            };

            // Only the originating account is checked against the requested
            // method; delegated checks have the method wiped by staged-tx.
            let method = if delegation.account == user {
                Some(method)
            } else {
                None
            };
            let caller = auth_caller(delegation.auth_service);

            if check_fn(&caller, delegation.account, authorizers, method) {
                authorized.push(delegation.account);
                changed = true;
            }
        }

        if !changed {
            break;
        }
    }

    authorized.contains(&user)
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
