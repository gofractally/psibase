use crate::services::{
    accounts, auth_delegate, auth_sig, http_server, producers, setcode,
};
use crate::{
    account_raw, method_raw, AccountNumber, Action, AnyPublicKey, MethodNumber, ServiceWrapper,
};


macro_rules! account {
    ($name:expr) => {
        AccountNumber::new(account_raw!($name))
    };
}

pub fn preapprove_action(sender: AccountNumber, account: AccountNumber) -> Option<Action> {
    if account.is_subaccount() {
        Some(accounts::Wrapper::pack_from(account.base()).preapproveAcc(account))
    } else if sender == producers::ROOT {
        Some(accounts::Wrapper::pack().preapproveAcc(account))
    } else {
        None
    }
}

pub fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    accounts::Wrapper::pack_from(sender).newAccount(
        account,
        account!("auth-any"),
        accounts::NewAccountMode::KeepExisting,
    )
}

/// The one key of a caller that has a single key, as auth-sig takes it: it
/// is used as both the owner and the active key (sequence value 0), which
/// gives an account that the one key controls completely.
fn single_key(key: &AnyPublicKey) -> auth_sig::KeySpec {
    if crate::verified_key_type(key.key.service).is_none() {
        panic!("unknown verify service {}", key.key.service)
    }
    auth_sig::KeySpec {
        key: key.key.rawData.to_vec().into(),
        seq: 0,
        // Named only when it is not the default for the key's type
        verifier: (!key.has_default_verifier()).then_some(key.key.service),
    }
}

/// Creates `account` with `key` as its owner and its active key. `sender`
/// becomes its recovery partner.
pub fn new_account_key_action(
    sender: AccountNumber,
    account: AccountNumber,
    key: &AnyPublicKey,
) -> Action {
    auth_sig::Wrapper::pack_from(sender).newAccount(account, single_key(key), single_key(key))
}

pub fn new_account_owned_action(
    sender: AccountNumber,
    account: AccountNumber,
    owner: AccountNumber,
) -> Action {
    auth_delegate::Wrapper::pack_from(sender).newAccount(
        account,
        owner,
        accounts::NewAccountMode::MatchExisting,
    )
}

/// Stores `key` as the owner and the active key of `account`, which must
/// not be using auth-sig yet. An account that already uses auth-sig changes
/// its keys with auth-sig's setActive and requestOwnerChange.
pub fn set_key_action(account: AccountNumber, key: &AnyPublicKey) -> Action {
    auth_sig::Wrapper::pack_from(account).setKeys(single_key(key), single_key(key))
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
        rawData: psio::to_pssz(&(root_host,)).into(),
    }
}
