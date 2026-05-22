use crate::services::{
    accounts, auth_delegate, auth_sig, http_server, producers, setcode, verify_sig,
};
use crate::{account_raw, method_raw, AccountNumber, Action, AnyPublicKey, MethodNumber};
use fracpack::Pack;

macro_rules! account {
    ($name:expr) => {
        AccountNumber::new(account_raw!($name))
    };
}

pub fn preapprove_action(sender: AccountNumber, account: AccountNumber) -> Option<Action> {
    if sender == producers::ROOT {
        Some(accounts::Wrapper::pack().preapproveAcc(account))
    } else {
        None
    }
}

pub fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(sender).newAccount(account, account!("auth-any"), false)
}

pub fn new_account_key_action(
    sender: AccountNumber,
    account: AccountNumber,
    key: &AnyPublicKey,
) -> Action {
    if key.key.service == verify_sig::SERVICE {
        auth_sig::Wrapper::pack_from(sender).newAccount(account, key.key.rawData.0.clone().into())
    } else {
        panic!("unknown verify service {}", key.key.service)
    }
}

pub fn new_account_owned_action(
    sender: AccountNumber,
    account: AccountNumber,
    owner: AccountNumber,
) -> Action {
    auth_delegate::Wrapper::pack_from(sender).newAccount(account, owner, true)
}

pub fn set_key_action(account: AccountNumber, key: &AnyPublicKey) -> Action {
    if key.key.service == account!("verify-sig") {
        auth_sig::Wrapper::pack_from(account).setKey(key.key.rawData.to_vec().into())
    } else {
        panic!("unknown account service");
    }
}

pub fn set_owner_action(account: AccountNumber, owner: AccountNumber) -> Action {
    auth_delegate::Wrapper::pack_from(account).setOwner(owner)
}

pub fn set_auth_service_action(account: AccountNumber, auth_service: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(account).setAuthServ(auth_service)
}

pub fn set_code_action(account: AccountNumber, wasm: Vec<u8>) -> Action {
    setcode::Wrapper::pack_from(account).setCode(account, 0, 0, wasm.into())
}

pub fn reg_server(service: AccountNumber, server_service: AccountNumber) -> Action {
    http_server::Wrapper::pack_from(service).registerServer(server_service)
}

pub fn login_action(user: AccountNumber, app: AccountNumber, root_host: &str) -> Action {
    Action {
        sender: user,
        service: app,
        method: MethodNumber::new(method_raw!("loginSys")),
        rawData: (root_host,).packed().into(),
    }
}
