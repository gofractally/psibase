#[allow(warnings)]
mod bindings;

use bindings::attestation::plugin::api::attest;
use bindings::common::plugin::types as CommonTypes;
use bindings::exports::identity::plugin::api::Guest;
use psibase::AccountNumber;

mod errors;

struct IdentityPlugin;

impl Guest for IdentityPlugin {
    fn attest(subject: String, confidence: f32) -> Result<(), CommonTypes::Error> {
        psibase::write_console("Identity.attest()");
        // verify this is an AccountNumber-like thing
        AccountNumber::from_exact(subject.as_str()).expect("Invalid `subject` account name");

        return attest(
            "identity",
            // subject.as_str(),
            format!("{{subject: {subject}, attestationType: \"identity\", score: {confidence}}}")
                .as_str(),
        ); // -> Result<(), CommonTypes::Error>
    }
}

bindings::export!(IdentityPlugin with_types_in bindings);
