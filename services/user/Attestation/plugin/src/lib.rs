#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types as CommonTypes;
use bindings::exports::attestation::plugin::api::Guest;

mod errors;
use errors::ErrorType::*;

struct AttestationPlugin;

impl Guest for AttestationPlugin {
    /// Say hello!
    fn attest(identity_type: String, claim: String) -> Result<(), CommonTypes::Error> {
        if true {
            return Ok(());
        } else {
            return Err(NotYetImplemented.err("add attest fn"));
        }
    }
}

bindings::export!(AttestationPlugin with_types_in bindings);
