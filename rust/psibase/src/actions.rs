use crate::services::{accounts, auth_k1, auth_sig, http_server, setcode_sys};
use crate::{account_raw, AccountNumber, Action, AnyPublicKey, PublicKey};
use fracpack::Unpack;

macro_rules! account {
    ($name:expr) => {
        AccountNumber::new(account_raw!($name))
    };
}

pub fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(sender).newAccount(account, account!("auth-any"), false)
}

pub fn set_key_action(account: AccountNumber, key: &AnyPublicKey) -> Action {
    if key.key.service == account!("verifyec-sys") {
        auth_k1::Wrapper::pack_from(account).setKey(PublicKey::unpacked(&key.key.rawData).unwrap())
    } else if key.key.service == account!("verify-sys") {
        auth_sig::Wrapper::pack_from(account).setKey(key.key.rawData.to_vec())
    } else {
        panic!("unknown account service");
    }
}

pub fn set_auth_service_action(account: AccountNumber, auth_service: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(account).setAuthServ(auth_service)
}

pub fn set_code_action(account: AccountNumber, wasm: Vec<u8>) -> Action {
    setcode_sys::Wrapper::pack_from(account).setCode(account, 0, 0, wasm.into())
}

pub fn reg_server(service: AccountNumber, server_service: AccountNumber) -> Action {
    http_server::Wrapper::pack_from(service).registerServer(server_service)
}
