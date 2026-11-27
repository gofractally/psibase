use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::accounts::admin::Credential;
use crate::bindings::host::types::types::Error;
use crate::db::apps_table::AppsTable;
use crate::db::user_table::UserTable;
use crate::bindings::host::crypto::keyvault as HostCrypto;
use crate::errors::ErrorType::{
    AccountNotFound, AuthorizationFailed, UnknownAccount, UnsupportedAuthService,
};
use crate::HOST_APP;

/// Checks that the account exists, uses auth-sig, and is authorized by the key.
/// Stores nothing.
fn check_auth_sig_credential(account: &String, key: &String) -> Result<(), Error> {
    let Some(details) = AccountsQuery::get_account(account)? else {
        return Err(AccountNotFound(account.clone()).into());
    };
    if details.auth_service != "auth-sig" {
        return Err(UnsupportedAuthService(details.auth_service).into());
    }
    if !AuthSig::api::can_authorize(key, account) {
        return Err(AuthorizationFailed(account.clone()).into());
    }
    Ok(())
}

pub fn adopt_account(account: String, private_key: String, app: &str) -> Result<(), Error> {
    // Nothing is stored unless every check passes
    check_auth_sig_credential(&account, &private_key)?;

    // As import-existing does
    AuthSig::keyvault::import_key(&private_key)?;
    AppsTable::new(HOST_APP).connect(&account);

    // The login needs the key imported above. It changes nothing if it fails.
    AppsTable::new(app).login(&account)?;
    UserTable::new(&account).add_connected_app(app);
    Ok(())
}

/// The accounts known to this device
pub fn known_accounts() -> Vec<String> {
    AppsTable::new(HOST_APP).get_connected_accounts()
}

/// Logs a known account in to `app` and connects the two. Nothing changes
/// if the login fails.
pub fn login_for(app: &str, account: &str) -> Result<(), Error> {
    if !known_accounts().iter().any(|known| known == account) {
        return Err(UnknownAccount(account.to_string()).into());
    }
    AppsTable::new(app).login(account)?;
    UserTable::new(account).add_connected_app(app);
    Ok(())
}

/// Removes an account, and the key stored for it, from this device.
pub fn forget_account(account: &str) {
    if !known_accounts().iter().any(|known| known == account) {
        return;
    }
    // Out of every app first: a logout needs nothing that is removed below.
    let user = UserTable::new(account);
    for app in user.get_connected_apps() {
        AppsTable::new(&app).disconnect(account);
        user.remove_connected_app(&app);
    }
    AppsTable::new(HOST_APP).disconnect(account);

    // The key that is stored is the one for the account's active key, as the
    // chain has it now. If that cannot be found out (the account is gone, or
    // the node cannot be reached), the account is forgotten all the same.
    if let Ok(Some(public_key)) = AuthSig::queries::get_pubkey(account) {
        if let Ok(der) = HostCrypto::to_der(&public_key) {
            let _ = HostCrypto::delete_key(&der);
        }
    }
}

fn import_credential(credential: &Credential, known_accounts: &AppsTable) -> Result<(), Error> {
    let account = &credential.account;
    let Some(details) = AccountsQuery::get_account(account)? else {
        return Err(AccountNotFound(account.clone()).into());
    };

    match details.auth_service.as_str() {
        "auth-any" => {}
        "auth-sig" => {
            if !AuthSig::api::can_authorize(&credential.key, account) {
                return Err(AuthorizationFailed(account.clone()).into());
            }
            AuthSig::keyvault::import_key(&credential.key)?;
        }
        service => return Err(UnsupportedAuthService(service.to_string()).into()),
    }

    known_accounts.connect(account);
    Ok(())
}

pub fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
    let known_accounts = AppsTable::new(HOST_APP);
    let invalid_accounts: Vec<_> = credentials
        .into_iter()
        .filter_map(|credential| {
            import_credential(&credential, &known_accounts)
                .err()
                .map(|e| (credential.account, e))
        })
        .collect();

    if invalid_accounts.is_empty() {
        Ok(())
    } else {
        Err(invalid_accounts)
    }
}
