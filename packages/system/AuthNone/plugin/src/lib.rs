#[allow(warnings)]
mod bindings;

use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};
use bindings::host::types::types as CommonTypes;

struct AuthNone;

fn denied() -> CommonTypes::Error {
    CommonTypes::Error {
        code: 0,
        producer: CommonTypes::PluginId {
            service: "auth-none".to_string(),
            plugin: "plugin".to_string(),
        },
        message: "Account cannot authorize: auth-none rejects all authorization".to_string(),
    }
}

impl HookUserAuth for AuthNone {
    fn on_user_auth_claim(_: String) -> Result<Option<Claim>, CommonTypes::Error> {
        Err(denied())
    }

    fn on_user_auth_proof(_: String, _: Vec<u8>) -> Result<Option<Proof>, CommonTypes::Error> {
        Err(denied())
    }
}

bindings::export!(AuthNone with_types_in bindings);
