#[allow(warnings)]
mod bindings;

use bindings::exports::auth_sys::plugin::keyvault::Guest as KeyVault;
use bindings::exports::auth_sys::plugin::smart_auth;
use smart_auth::Guest as SmartAuth;

struct Component;

impl SmartAuth for Component {
    fn get_claim() -> Result<smart_auth::Claim, String> {
        Err("Not yet implemented".to_string())
    }

    fn get_proof(_message: Vec<u8>) -> Result<smart_auth::Proof, String> {
        Err("Not yet implemented".to_string())
    }
}

impl KeyVault for Component {
    fn generate_keypair() -> Result<String, String> {
        // Mock data for now
        Ok("NotRealKey".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
