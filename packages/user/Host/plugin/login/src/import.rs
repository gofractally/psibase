use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::login::admin::Credential;
use crate::bindings::host::accounts::admin as HostAccounts;
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType::{AccountNotFound, AuthorizationFailed, UnsupportedAuthService};
use crate::HOST_APP;

fn import_credential(credential: &Credential) -> Result<(), Error> {
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

    HostAccounts::connect(account, HOST_APP);
    Ok(())
}

pub fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
    let invalid_accounts: Vec<_> = credentials
        .into_iter()
        .filter_map(|credential| {
            import_credential(&credential)
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
