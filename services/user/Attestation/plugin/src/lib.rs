#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types::PluginId;
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
        println!("Attestation.attest()");
        #[derive(Serialize, Deserialize, Debug)]
        struct CredentialSubjectArg {
            subject: String,
            attestation_type: String,
            score: f32,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct CredentialSubject {
            creating_app: String,
            subject: String,
            attestation_type: String,
            score: f32,
        }
        println!("Attestation.claim: {}", claim.as_str());
        let mut claim_arg_as_obj: CredentialSubjectArg;
        match serde_json::from_str(claim.as_str()) {
            Ok(v) => claim_arg_as_obj = v,
            Err(e) => {
                return Err(CommonTypes::Error {
                    code: 0,
                    message: format!("Error: {} parsing claim: {}", e.to_string(), claim.as_str()),
                    producer: PluginId {
                        service: String::from("Attestation"),
                        plugin: String::from("Attestation"),
                    },
                })
            }
        };
        let calling_app = CommonClient::get_sender_app().ok().unwrap().app.unwrap();
        // namespace the attestation type with the calling app's name so different apps can use common names for types and not confliect
        let claim_as_obj = CredentialSubject {
            creating_app: calling_app,
            subject: claim_arg_as_obj.subject,
            attestation_type: claim_arg_as_obj.attestation_type,
            score: claim_arg_as_obj.score,
        };
        println!("{:?}", claim_as_obj);
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
            println!("Adding action to tx");
            return CommonServer::add_action_to_transaction("attest", &packed_a);
        } else {
            return Err(NotYetImplemented.err("add attest fn"));
        }
    }
}

bindings::export!(AttestationPlugin with_types_in bindings);
