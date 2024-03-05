#[allow(warnings)]
mod bindings;

use bindings::exports::auth::plugin::keyvault;
use bindings::exports::auth::plugin::smart_auth;

struct Component;

impl smart_auth::Guest for Component {
    fn get_claim() -> Result<smart_auth::Claim, String> {
        Err("Not yet implemented".to_string())
    }

    fn get_proof(_message: Vec<u8>) -> Result<smart_auth::Proof, String> {
        Err("Not yet implemented".to_string())
    }
}

impl keyvault::Guest for Component {
    fn generate_keypair() -> Result<String, String> {
        // Mock data for now
        Ok("NotRealKey".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
