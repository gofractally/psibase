#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::Unauthorized;

use bindings::exports::auth_any::plugin::session::Guest as Session;
use bindings::host::accounts::auth_svc as HostAccounts;
use bindings::host::client::api as Client;
use bindings::host::types::types::{Error, Pem};

struct AuthAny;

fn from_host() -> bool {
    Client::get_sender() == "host"
}

impl Session for AuthAny {
    fn add_account(account_name: String, _private_key: Pem) -> Result<(), Error> {
        if !from_host() {
            return Err(Unauthorized("session::add_account").into());
        }
        HostAccounts::add_account(&account_name)
    }

    fn authorize(_account_name: String) -> Result<(), Error> {
        Ok(())
    }

    fn login(account_name: String) -> Result<(), Error> {
        if !from_host() {
            return Err(Unauthorized("session::login").into());
        }
        HostAccounts::login(&account_name, None)
    }
}

bindings::export!(AuthAny with_types_in bindings);
