use crate::services::{accounts, auth_sig, http_server, setcode};
use crate::{account_raw, method_raw, AccountNumber, Action, AnyPublicKey, MethodNumber};
use fracpack::Pack;

macro_rules! account {
    ($name:expr) => {
        AccountNumber::new(account_raw!($name))
    };
}

pub fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(sender).newAccount(account, account!("auth-any"), false)
}

pub fn set_key_action(account: AccountNumber, key: &AnyPublicKey) -> Action {
    if key.key.service == account!("verify-sig") {
        auth_sig::Wrapper::pack_from(account).setKey(key.key.rawData.to_vec().into())
    } else {
        panic!("unknown account service");
    }
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
