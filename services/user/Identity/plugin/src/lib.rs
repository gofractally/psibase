#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types as CommonTypes;
use bindings::exports::identity::plugin::api::Guest;

mod errors;
use errors::ErrorType::*;

struct IdentityPlugin;

impl Guest for IdentityPlugin {
    fn attest(subject: String, confidence: f32) -> Result<(), CommonTypes::Error> {
        if true {
            // claims = <claims>
            // attest("identity", claims); // -> Result<(), CommonTypes::Error> {
            return Ok(());
        } else {
            return Err(NotYetImplemented.err("add attest fn"));
        }
    }
}

bindings::export!(IdentityPlugin with_types_in bindings);
