#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::accounts;
use bindings::common::plugin::{server as CommonServer, types as CommonTypes};
use bindings::exports::identity::plugin::api::Guest;
use bindings::exports::identity::plugin::queries::Guest as QueriesGuest;
use bindings::exports::identity::plugin::types as IdentityTypes;
use psibase::fracpack::Pack;

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

        accounts::get_account(&subject)?;

        let int_score = (score * 100.0).trunc() as u8;

        let packed_a = identity::action_structs::attest {
            subject: subject.clone(),
            value: int_score,
        }
        .packed();

        CommonServer::add_action_to_transaction("attest", &packed_a)
    }
}

#[derive(Deserialize, Debug)]
#[allow(non_snake_case)]
struct IdentitySummary {
    percHighConf: f32,
    uniqueAttesters: u32,
}

#[derive(Deserialize, Debug)]
#[allow(non_snake_case)]
struct IdentitySummaryResponseData {
    subjectStats: IdentitySummary,
}

#[derive(Deserialize, Debug)]
struct IdentitySummaryResponse {
    data: IdentitySummaryResponseData,
}

impl QueriesGuest for IdentityPlugin {
    fn summary(subject: String) -> Result<IdentityTypes::IdentitySummary, CommonTypes::Error> {
        let graphql_str = format!(
            "query {{ subjectStats(subject:\"{}\") {{ percHighConf, uniqueAttesters }} }}",
            subject
        );
        let summary = CommonServer::post_graphql_get_json(&graphql_str).unwrap();
        println!("summary: {}", summary);
        let summary_val = serde_json::from_str::<IdentitySummaryResponse>(&summary).unwrap();
        println!("summary stats: {:#?}", summary_val.data.subjectStats);
        Ok(IdentityTypes::IdentitySummary {
            perc_high_confidence: summary_val.data.subjectStats.percHighConf,
            num_unique_attestations: summary_val.data.subjectStats.uniqueAttesters,
        })
    }
}

// CONSIDER: Query definition here for attestations

bindings::export!(IdentityPlugin with_types_in bindings);
