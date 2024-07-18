#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server as CommonServer, types as CommonTypes};
use bindings::accounts::plugin::
use bindings::exports::identity::plugin::api::Guest;
use psibase::fracpack::Pack;
use psibase::{AccountNumber, ToKey};

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
    fn attest_identity_claim(subject: String, score: f32) -> Result<(), CommonTypes::Error> {
        if !(score >= 0.0 && score <= 1.0) {
            return Err(InvalidClaim.err(&format!("{score}")));
        }

        println!(
            "subject AccountNumber.unwrap().to_string(): {}",
            AccountNumber::from_exact(&subject).unwrap().to_string()
        );
        println!(
            "subject AccountNumber.unwrap().value: {}",
            AccountNumber::from_exact(&subject).unwrap().value
        );

        if let Err(err) = AccountNumber::from_exact(&subject) {
            return Err(InvalidAccountNumber.err(&err.to_string()));
        }

        let int_score = (score * 100.0).trunc() as u8;

        let packed_a = identity::action_structs::attest {
            subject: subject.clone(),
            value: int_score,
        }
        .packed();

        CommonServer::add_action_to_transaction("attest", &packed_a)
    }
}

// CONSIDER: Query definition here for attestations for each user access, to complete the abstraction from the Attestation service

bindings::export!(IdentityPlugin with_types_in bindings);
