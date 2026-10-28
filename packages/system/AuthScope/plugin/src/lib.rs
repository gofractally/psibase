#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType;

use bindings::exports::auth_scope::plugin::api::{AllowedAction as WitAllowed, Guest};
use psibase::services::auth_scope::{AllowedAction, Wrapper as AuthScope};
use psibase::services::auth_sig::SubjectPublicKeyInfo;
use psibase::{AccountNumber, MethodNumber};
use psibase_plugin::{trust::*, *};
use serde::Deserialize;

struct AuthScopePlugin;

impl TrustConfig for AuthScopePlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &["Create an account whose key can only authorize a whitelist of actions"],
            high: &["Replace the authorized key of an account you own"],
        }
    }
}

impl Guest for AuthScopePlugin {
    #[psibase_plugin::authorized(Medium)]
    fn new_account(
        name: String,
        pubkey_pem: String,
        owner: String,
        allowed: Vec<WitAllowed>,
    ) -> Result<(), Error> {
        let name = parse_account(&name)?;
        let owner = parse_account(&owner)?;
        let key = parse_pubkey_pem(&pubkey_pem)?;
        let allowed = allowed
            .into_iter()
            .map(|action| {
                Ok(AllowedAction {
                    service: parse_account(&action.service)?,
                    method: MethodNumber::from(action.method.as_str()),
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        AuthScope::add_to_tx().newAccount(name, key, owner, allowed);
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_key(account: String, pubkey_pem: String) -> Result<(), Error> {
        let account = parse_account(&account)?;
        let key = parse_pubkey_pem(&pubkey_pem)?;
        AuthScope::add_to_tx().setKey(account, key);
        Ok(())
    }
}

fn parse_account(name: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_exact(name)
        .map_err(|_| Error::from(ErrorType::InvalidAccount(name.to_string())))
}

fn parse_pubkey_pem(pubkey_pem: &str) -> Result<SubjectPublicKeyInfo, Error> {
    SubjectPublicKeyInfo::deserialize(serde_json::Value::String(pubkey_pem.to_string()))
        .map_err(|_| Error::from(ErrorType::InvalidPublicKey))
}

bindings::export!(AuthScopePlugin with_types_in bindings);
