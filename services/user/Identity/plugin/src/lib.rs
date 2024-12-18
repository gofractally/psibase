#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin as Accounts;
use bindings::exports::identity::plugin::api::Guest as Api;
use bindings::exports::identity::plugin::queries::Guest as QueriesApi;
use bindings::exports::identity::plugin::types as IdentityTypes;
use bindings::host::common::{server as CommonServer, types as CommonTypes};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::{self, *};

struct IdentityPlugin;

#[derive(Serialize, Deserialize, Debug)]
struct Attestation {
    subject: String,
    attestation_type: String,
    score: f32,
}

impl Api for IdentityPlugin {
    fn attest_identity_claim(subject: String, score: f32) -> Result<(), CommonTypes::Error> {
        if !(score >= 0.0 && score <= 1.0) {
            return Err(InvalidClaim(score).into());
        }

        Accounts::api::get_account(&subject)?;

        let int_score = (score * 100.0).trunc() as u8;

        let packed_a = identity::action_structs::attest {
            subject: AccountNumber::from(subject.as_str()),
            value: int_score,
        }
        .packed();

        Transact::add_action_to_transaction("attest", &packed_a)
    }
}

#[derive(Deserialize, Debug)]
#[allow(non_snake_case)]
struct IdentitySummaryFromService {
    numHighConfAttestations: u16,
    uniqueAttesters: u16,
}

#[derive(Deserialize, Debug)]
#[allow(non_snake_case)]
struct IdentitySummaryResponseData {
    subjectStats: IdentitySummaryFromService,
}

#[derive(Deserialize, Debug)]
struct IdentitySummaryResponse {
    data: IdentitySummaryResponseData,
}

impl QueriesApi for IdentityPlugin {
    fn summary(
        subject: String,
    ) -> Result<Option<IdentityTypes::IdentitySummary>, CommonTypes::Error> {
        let graphql_str = format!(
            "query {{ subjectStats(subject:\"{}\") {{ numHighConfAttestations, uniqueAttesters }} }}",
            subject
        );
        let summary_val = serde_json::from_str::<IdentitySummaryResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        )
        .map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(Some(IdentityTypes::IdentitySummary {
            perc_high_confidence: (summary_val.data.subjectStats.numHighConfAttestations as f32
                / summary_val.data.subjectStats.uniqueAttesters as f32
                * 100.0)
                .round() as u8,
            num_unique_attestations: summary_val.data.subjectStats.uniqueAttesters,
        }))
    }
}

// CONSIDER: Query definition here for attestations

bindings::export!(IdentityPlugin with_types_in bindings);
