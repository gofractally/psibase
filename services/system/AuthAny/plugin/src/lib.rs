#[allow(warnings)]
mod bindings;

use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};
use bindings::host::common::types as CommonTypes;

struct AuthAny;

impl HookUserAuth for AuthAny {
    fn on_user_auth_claim(_: String) -> Result<Option<Claim>, CommonTypes::Error> {
        Ok(None)
    }

    fn on_user_auth_proof(_: String, _: Vec<u8>) -> Result<Option<Proof>, CommonTypes::Error> {
        Ok(None)
    }
}

bindings::export!(AuthAny with_types_in bindings);
