#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types as CommonTypes;
use bindings::exports::auth_sig::plugin::keyvault::Guest as KeyVault;
use bindings::exports::auth_sig::plugin::smart_auth;
use smart_auth::Guest as SmartAuth;

mod errors;
use errors::ErrorType::*;

struct Component;

impl SmartAuth for Component {
    fn get_claim() -> Result<smart_auth::Claim, CommonTypes::Error> {
        Err(NotYetImplemented.err())
    }

    fn get_proof(_message: Vec<u8>) -> Result<smart_auth::Proof, CommonTypes::Error> {
        Err(NotYetImplemented.err())
    }
}

impl KeyVault for Component {
    fn generate_keypair() -> Result<String, CommonTypes::Error> {
        // Mock data for now
        Ok("PUB_K1_7jTdMYEaHi66ZEcrh7To9XKingVkRdBuz6abm3meFbGw8zFFve".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
