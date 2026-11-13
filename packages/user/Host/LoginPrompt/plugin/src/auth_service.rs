use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_any::plugin::session as AuthAny;
use crate::bindings::auth_recover::plugin::session as AuthRecover;
use crate::bindings::auth_sig::plugin::session as AuthSig;
use crate::bindings::exports::host::login_prompt::api::Credential;
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;

/// Auth services whose plugin can add accounts to this device and log them in.
enum AuthService {
    AuthSig,
    AuthAny,
    AuthRecover,
}

impl AuthService {
    fn of(account: &str) -> Result<Self, Error> {
        let Some(details) = AccountsQuery::get_account(account)? else {
            return Err(ErrorType::AccountNotFound(account.to_string()).into());
        };

        match details.auth_service.as_str() {
            "auth-sig" => Ok(Self::AuthSig),
            "auth-any" => Ok(Self::AuthAny),
            "auth-rcovr" => Ok(Self::AuthRecover),
            service => Err(ErrorType::UnsupportedAuthService(service.to_string()).into()),
        }
    }

    fn add_account(&self, credential: &Credential) -> Result<(), Error> {
        let (account, key) = (&credential.account, &credential.key);
        match self {
            Self::AuthSig => AuthSig::add_account(account, key),
            Self::AuthAny => AuthAny::add_account(account, key),
            Self::AuthRecover => AuthRecover::add_account(account, key),
        }
    }

    fn login(&self, account: &str) -> Result<(), Error> {
        match self {
            Self::AuthSig => AuthSig::login(account),
            Self::AuthAny => AuthAny::login(account),
            Self::AuthRecover => AuthRecover::login(account),
        }
    }
}

/// Adds each credential's account to this device through the account's auth service.
/// Returns the accounts that could not be added, with the reason for each.
pub fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
    let invalid_accounts: Vec<_> = credentials
        .into_iter()
        .filter_map(|credential| {
            AuthService::of(&credential.account)
                .and_then(|service| service.add_account(&credential))
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

/// Logs `account` into the active app through the account's auth service.
pub fn login(account: &str) -> Result<(), Error> {
    AuthService::of(account)?.login(account)
}
