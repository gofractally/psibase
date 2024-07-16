#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server as CommonServer, types as CommonTypes};
use bindings::exports::identity::plugin::api::Guest;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::*;

struct IdentityPlugin;

#[derive(Serialize, Deserialize, Debug)]
struct Attestation {
    subject: String,
    attestation_type: String,
    score: f32,
}

impl Guest for IdentityPlugin {
    fn attest_identity_claim(subject: String, value: f32) -> Result<(), CommonTypes::Error> {
        if !(value >= 0.0 && value <= 1.0) {
            return Err(InvalidClaim.err(&format!("{value}")));
        }
        if let Err(err) = AccountNumber::from_exact(&subject) {
            return Err(InvalidAccountNumber.err(&err.to_string()));
        }

        let packed_a = identity::action_structs::attest {
            subject: subject.clone(),
            value,
        }
        .packed();

        CommonServer::add_action_to_transaction("attest", &packed_a)
    }
}

// CONSIDER: Query definition here for attestations for each user access, to complete the abstraction from the Attestation service

bindings::export!(IdentityPlugin with_types_in bindings);
