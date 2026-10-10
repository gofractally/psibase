use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::accounts::admin::Credential;
use crate::bindings::host::types::types::Error;
use crate::db::apps_table::AppsTable;
use crate::errors::ErrorType::{AccountNotFound, AuthorizationFailed, UnsupportedAuthService};
use crate::HOST_APP;

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
