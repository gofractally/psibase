#[allow(warnings)]
mod bindings;

// use bindings::common;
use bindings::common::plugin::{
    client as CommonClient, server as CommonServer, types as CommonTypes,
};
use bindings::exports::attestation::plugin::api::Guest;
use psibase::fracpack::Pack;
// use psibase::services::common_api;
// use psibase::AccountNumber;
use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::*;

struct AttestationPlugin;

impl Guest for AttestationPlugin {
    fn attest(attestation_type: String, claim: String) -> Result<(), CommonTypes::Error> {
        psibase::write_console("Attestation.attest()");
        #[derive(Serialize, Deserialize)]
        struct CredentialSubject {
            subject: String,
            attestation_type: String,
            score: f32,
        }
        let mut claim_as_obj: CredentialSubject =
            serde_json::from_str(claim.as_str()).expect("Failed to parse claim");
        let calling_app = CommonClient::get_sender_app().ok().unwrap().app.unwrap();
        // namespace the attestation type with the calling app's name so different apps can use common names for types and not confliect
        claim_as_obj.attestation_type = calling_app + claim_as_obj.attestation_type.as_str();
        let packed_a = attestation::action_structs::attest {
            vc: attestation::VerifiableCredential {
                // subject: AccountNumber::from_exact(subject.as_str())
                //     .expect("invalid `subject` account"),
                // TODO: tack on name of calling plugin's service to type as a namespace
                credentialSubject: serde_json::to_string(&claim_as_obj)
                    .expect("failed to reserialize namespaced claim"),
            },
        }
        .packed();

        if true {
            return CommonServer::add_action_to_transaction("attest", &packed_a);
        } else {
            return Err(NotYetImplemented.err("add attest fn"));
        }
    }
}

bindings::export!(AttestationPlugin with_types_in bindings);
