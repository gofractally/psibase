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
        println!("Identity.attest()");
        // verify this is an AccountNumber-like thing
        if !(confidence >= 0.0 && confidence <= 1.0) {
            return Err(InvalidClaim.err(&format!("{confidence}")));
        }
        match AccountNumber::from_exact(&subject) {
            Ok(_) => (),
            Err(e) => return Err(InvalidAccountNumber.err(&subject)),
        }
        println!("subject is an AccountNumber: {}", subject);

        let claim = format!("{{\"subject\": \"{subject}\", \"attestation_type\": \"identity\", \"score\": {confidence}}}");
        println!("{}", claim);
        return attest(
            "identity", // subject.as_str(),
            claim.as_str(),
        ); // -> Result<(), CommonTypes::Error>
    }
}

bindings::export!(IdentityPlugin with_types_in bindings);
