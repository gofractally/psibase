#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::credentials::plugin::types::InviteToken;
use bindings::host::common::client as Client;
//use bindings::host::crypto::keyvault as KeyVault;
use bindings::host::types::types::Error;
use bindings::transact::plugin::{hooks::*, types::*};

// Exported interfaces/types
use bindings::exports::credentials::plugin::api::Guest as Api;
use bindings::exports::transact_hook_action_auth::Guest as HookActionAuth;

struct Credentials;

impl Api for Credentials {
    fn notify(_token: InviteToken) -> Result<(), Error> {
        // Store the credential private key in transient storage
        //InviteKeys::add(&deserialize(&token)?);

        hook_action_auth();

        Ok(())
    }
}

impl HookActionAuth for Credentials {
    fn on_action_auth_claims(_action: Action) -> Result<Vec<Claim>, Error> {
        return Ok(vec![Claim {
            verify_service: credentials::VERIFY_SERVICE.to_string(),
            raw_data: vec![], // TODO use pubkey here
        }]);
    }

    fn on_action_auth_proofs(
        _claims: Vec<Claim>,
        transaction_hash: Vec<u8>,
    ) -> Result<Vec<Proof>, Error> {
        if Client::get_sender() != "transact" {
            return Err(Unauthorized("on_action_auth_proofs").into());
        }

        //let private_key = InviteKeys::get_private_key(); //TODO: get private key from transient storage

        Ok(vec![Proof {
            signature: vec![], // TODO: sign transaction hash with private key using host:crypto sign_explicit
        }])
    }
}

bindings::export!(Credentials with_types_in bindings);
