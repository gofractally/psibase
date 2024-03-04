#[allow(warnings)]
mod bindings;

use bindings::exports::auth_sys::plugin::auth_sys::{Claim, Guest};

struct Component;

impl Guest for Component {
    fn get_claim() -> Result<Claim, String> {
        Err("Not yet implemented".to_string())
    }

    fn generate_keypair() -> Result<String, String> {
        // Mock data for now
        Ok("NotRealKey".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
