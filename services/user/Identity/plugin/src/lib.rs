#[allow(warnings)]
mod bindings;

use bindings::attestation::plugin::api::attest;
use bindings::common::plugin::types::{self as CommonTypes};
use bindings::exports::identity::plugin::api::Guest;
use psibase::AccountNumber;

mod errors;
use errors::ErrorType::*;

struct IdentityPlugin;

impl Guest for IdentityPlugin {
    fn attest(subject: String, confidence: f32) -> Result<(), CommonTypes::Error> {
        if !(confidence >= 0.0 && confidence <= 1.0) {
            return Err(InvalidClaim.err(&format!("{confidence}")));
        }
        match AccountNumber::from_exact(&subject) {
            Ok(_) => (),
            Err(e) => return Err(InvalidAccountNumber.err(&subject)),
        }

        let claim = format!("{{\"subject\": \"{subject}\", \"attestation_type\": \"identity\", \"score\": {confidence}}}");
        return attest(
            "identity", // subject.as_str(),
            claim.as_str(),
        );
    }
}

// CONSIDER: Query definition here for attestations for each user access, to complete the abstraction from the Attestation service

bindings::export!(IdentityPlugin with_types_in bindings);
