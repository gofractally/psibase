#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::auth_svc as AccountsAuthSvc;
use bindings::exports::auth_any::plugin::session::Guest as Session;
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};
use bindings::host::types::types::{self as CommonTypes, Error};

struct AuthAny;

impl HookUserAuth for AuthAny {
    fn on_user_auth_claim(_: String) -> Result<Option<Claim>, CommonTypes::Error> {
        Ok(None)
    }

    fn on_user_auth_proof(_: String, _: Vec<u8>) -> Result<Option<Proof>, CommonTypes::Error> {
        Ok(None)
    }
}

impl Session for AuthAny {
    fn login(account_name: String) -> Result<(), Error> {
        AccountsAuthSvc::login(&account_name, None)
    }
}

bindings::export!(AuthAny with_types_in bindings);
