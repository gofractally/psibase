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
        MethodNumber::from(auth_action_structs::getDelegations::ACTION_NAME),
        auth_action_structs::getDelegations { sender, method },
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

fn check_auth_recursive(
    user: AccountNumber,
    method: Option<ServiceMethod>,
    responders: &[AccountNumber],
    check_fn: fn(&ServiceCaller, AccountNumber, Vec<AccountNumber>, Option<ServiceMethod>) -> bool,
    path: &[AccountNumber],
) -> bool {
    if path.contains(&user) {
        return false;
    }
    let mut path = path.to_vec();
    path.push(user);

    let Some(auth_service) = get_auth_service(user) else {
        return false;
    };
    let caller = auth_caller(auth_service);
    let delegations = get_delegations(&caller, user, method.clone());

    if delegations.is_empty() {
        check_fn(&caller, user, responders.to_vec(), method)
    } else {
        let authorized_delegates: Vec<AccountNumber> = delegations
            .into_iter()
            .filter(|delegate| check_auth_recursive(*delegate, None, responders, check_fn, &path))
            .collect();
        check_fn(&caller, user, authorized_delegates, method)
    }
}

pub struct StagedTxPolicy {
    user: AccountNumber,
}
impl StagedTxPolicy {
    pub fn new(user: AccountNumber) -> Option<Self> {
        get_auth_service(user).map(|_| StagedTxPolicy { user })
    }

    pub fn does_auth(&self, accepters: Vec<AccountNumber>, method: ServiceMethod) -> bool {
        check_auth_recursive(self.user, Some(method), &accepters, is_auth_sys, &[])
    }

    pub fn does_reject(&self, rejecters: Vec<AccountNumber>, method: ServiceMethod) -> bool {
        check_auth_recursive(self.user, Some(method), &rejecters, is_reject_sys, &[])
    }
}
