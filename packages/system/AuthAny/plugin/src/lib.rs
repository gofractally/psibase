#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::Unauthorized;

use bindings::exports::auth_any::plugin::session::Guest as Session;
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};
use bindings::host::accounts::auth_svc as HostAccounts;
use bindings::host::client::api as Client;
use bindings::host::types::types::{self as CommonTypes, Error, Pem};

struct AuthAny;

fn from_host() -> bool {
    Client::get_sender() == "host"
}

impl HookUserAuth for AuthAny {
    fn on_user_auth_claim(_: String) -> Result<Option<Claim>, CommonTypes::Error> {
        Ok(None)
    }

    fn on_user_auth_proof(_: String, _: Vec<u8>) -> Result<Option<Proof>, CommonTypes::Error> {
        Ok(None)
    }
}

impl Session for AuthAny {
    fn add_account(account_name: String, _private_key: Pem) -> Result<(), Error> {
        if !from_host() {
            return Err(Unauthorized("session::add_account").into());
        }
        HostAccounts::add_account(&account_name)
    }

    fn login(account_name: String) -> Result<(), Error> {
        if !from_host() {
            return Err(Unauthorized("session::login").into());
        }
        HostAccounts::login(&account_name, None)
    }
}

bindings::export!(AuthAny with_types_in bindings);
