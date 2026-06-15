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

struct DelegationNode {
    account: AccountNumber,
    children: Vec<DelegationNode>,
}

fn dedupe_preserve_order(accounts: Vec<AccountNumber>) -> Vec<AccountNumber> {
    let mut result = Vec::new();
    for account in accounts {
        if !result.contains(&account) {
            result.push(account);
        }
    }
    result
}

fn build_delegation_tree(
    user: AccountNumber,
    method: Option<ServiceMethod>,
    path: &[AccountNumber],
) -> Option<DelegationNode> {
    if path.contains(&user) {
        return None;
    }

    let mut path = path.to_vec();
    path.push(user);

    let auth_service = get_auth_service(user)?;
    let caller = auth_caller(auth_service);
    let delegations = dedupe_preserve_order(get_delegations(&caller, user, method));

    let children = delegations
        .into_iter()
        .filter_map(|delegate| build_delegation_tree(delegate, None, &path))
        .collect();

    Some(DelegationNode {
        account: user,
        children,
    })
}

fn check_delegation_node(
    node: &DelegationNode,
    responders: &[AccountNumber],
    check_fn: fn(&ServiceCaller, AccountNumber, Vec<AccountNumber>, Option<ServiceMethod>) -> bool,
    method: Option<ServiceMethod>,
) -> bool {
    let authorized_children: Vec<AccountNumber> = node
        .children
        .iter()
        .filter(|child| check_delegation_node(child, responders, check_fn, None))
        .map(|child| child.account)
        .collect();

    let auth_service = get_auth_service(node.account).expect("delegation tree node has auth service");
    let caller = auth_caller(auth_service);
    let authorizers = if node.children.is_empty() {
        responders.to_vec()
    } else {
        authorized_children
    };

    check_fn(&caller, node.account, authorizers, method)
}

fn check_delegation_auth(
    user: AccountNumber,
    method: ServiceMethod,
    responders: &[AccountNumber],
    check_fn: fn(&ServiceCaller, AccountNumber, Vec<AccountNumber>, Option<ServiceMethod>) -> bool,
) -> bool {
    let tree = match build_delegation_tree(user, Some(method), &[]) {
        Some(tree) => tree,
        None => return false,
    };

    check_delegation_node(&tree, responders, check_fn, Some(method))
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