#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::auth_svc as AccountsAuthSvc;
use bindings::exports::auth_any::plugin::session::Guest as Session;
use bindings::host::types::types::Error;

struct AuthAny;

impl Session for AuthAny {
    fn authorize(_account_name: String) -> Result<(), Error> {
        Ok(())
    }

    fn login(account_name: String) -> Result<(), Error> {
        AccountsAuthSvc::login(&account_name, None)
    }
}

bindings::export!(AuthAny with_types_in bindings);
