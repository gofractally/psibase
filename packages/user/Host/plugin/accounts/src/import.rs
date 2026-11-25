use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::accounts::admin::Credential;
use crate::bindings::host::types::types::Error;
use crate::db::apps_table::AppsTable;
use crate::db::user_table::UserTable;
use crate::errors::ErrorType::{AccountNotFound, AuthorizationFailed, UnsupportedAuthService};
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
