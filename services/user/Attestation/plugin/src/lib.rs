#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server as CommonServer, types as CommonTypes};
use bindings::exports::attestation::plugin::api::Guest;

mod errors;
use errors::ErrorType::*;

struct AttestationPlugin;

impl Guest for AttestationPlugin {
    /// Say hello!
    fn attest(
        attestation_type: String,
        // subject: String,
        claim: String,
    ) -> Result<(), CommonTypes::Error> {
        let packed_a = attestation::action_structs::attest { vc: todo!() }.packed();

        if true {
            // CommonServer::add_action_to_transaction(
            //     "attest",
            //     &AttestationService::action_structs::attest {
            //     vc: Attestation {
            //         attester: get_sender(),
            //         subject,
            //         claim,
            //     },
            //   }.packed(),
            // );
            // psibase::services::invite::action_structs::accept { inviteKey: todo!() };
            return Ok(());
        } else {
            return Err(NotYetImplemented.err("add attest fn"));
        }
    }
}

bindings::export!(AttestationPlugin with_types_in bindings);
