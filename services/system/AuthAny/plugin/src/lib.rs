#[allow(warnings)]
mod bindings;

use bindings::accounts::smart_auth::types::{Action, Claim, Proof};
use bindings::exports::accounts::smart_auth::smart_auth::Guest as SmartAuth;
use bindings::host::common::types as CommonTypes;

struct AuthAny;

impl SmartAuth for AuthAny {
    fn get_claims(_: String, _: Vec<Action>) -> Result<Vec<Claim>, CommonTypes::Error> {
        Ok(vec![])
    }

    fn get_proofs(_: String, _: Vec<u8>) -> Result<Vec<Proof>, CommonTypes::Error> {
        Ok(vec![])
    }
}

bindings::export!(AuthAny with_types_in bindings);
