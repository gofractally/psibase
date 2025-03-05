#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::kdf::plugin::api::{Guest as Api, *};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

const PBKDF2_ITERATIONS: u32 = 10000;
const AES_KEY_SIZE: usize = 32; // 256 bits

struct KdfPlugin;
impl Api for KdfPlugin {
    fn derive_key(type_: Keytype, seed: Vec<u8>, salt: String) -> Vec<u8> {
        match type_ {
            Keytype::Aes => {
                let seed_bytes = seed.as_slice();
                let mut key = [0u8; AES_KEY_SIZE];
                // Use a fixed salt for simplicity (in a real-world scenario, you might want to use a unique salt)
                let salt = salt.as_bytes();
                pbkdf2_hmac::<Sha256>(&seed_bytes, salt, PBKDF2_ITERATIONS, &mut key);
                key.to_vec()
            }
        }
    }
}

bindings::export!(KdfPlugin with_types_in bindings);
