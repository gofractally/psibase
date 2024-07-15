#[allow(warnings)]
mod bindings;

use std::error::Error;

use bindings::common::plugin::{
    client as CommonClient, server as CommonServer, types as CommonTypes,
};
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
        AccountNumber::from_exact(&subject)
            .map_err(|err| InvalidAccountNumber.err(&err.to_string()));

        let packed_a = identity::action_structs::attest_identity_claim {
            subject: subject.clone(),
            value,
        }
        .packed();

        CommonServer::add_action_to_transaction("attest_identity_claim", &packed_a)
    }
}

// CONSIDER: Query definition here for attestations for each user access, to complete the abstraction from the Attestation service

bindings::export!(IdentityPlugin with_types_in bindings);
