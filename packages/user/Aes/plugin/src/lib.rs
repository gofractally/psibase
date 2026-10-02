#[cfg(target_arch = "wasm32")]
mod aead;
#[allow(warnings)]
mod bindings;

#[cfg(target_arch = "wasm32")]
use aead::{decrypt, encrypt};
#[cfg(target_arch = "wasm32")]
use aes_gcm::{Aes128Gcm, Aes256Gcm};
#[cfg(target_arch = "wasm32")]
use bindings::*;
#[cfg(target_arch = "wasm32")]
use exports::aes::plugin::types as AesTypes;
#[cfg(target_arch = "wasm32")]
use exports::aes::plugin::with_key::Guest as WithKey;
#[cfg(target_arch = "wasm32")]
use exports::aes::plugin::with_password::Guest as WithPassword;
#[cfg(target_arch = "wasm32")]
use host::types::types::{Error, PluginId};
#[cfg(target_arch = "wasm32")]
use kdf::plugin::api as Kdf;

#[cfg(target_arch = "wasm32")]
fn decrypt_error() -> Error {
    Error {
        code: 0,
        producer: PluginId {
            service: "aes".to_string(),
            plugin: "plugin".to_string(),
        },
        message: "Failed to decrypt data".to_string(),
    }
}

#[cfg(target_arch = "wasm32")]
struct AesPlugin;

#[cfg(target_arch = "wasm32")]
impl WithKey for AesPlugin {
    fn encrypt(key: AesTypes::Key, data: Vec<u8>, associated_data: Vec<u8>) -> Vec<u8> {
        match key.strength {
            AesTypes::Strength::Aes128 => {
                encrypt::<Aes128Gcm>(&key.key_data, &data, &associated_data)
            }
            AesTypes::Strength::Aes256 => {
                encrypt::<Aes256Gcm>(&key.key_data, &data, &associated_data)
            }
        }
    }

    fn decrypt(
        key: AesTypes::Key,
        cipher: Vec<u8>,
        associated_data: Vec<u8>,
    ) -> Result<Vec<u8>, Error> {
        let opened = match key.strength {
            AesTypes::Strength::Aes128 => {
                decrypt::<Aes128Gcm>(&key.key_data, &cipher, &associated_data)
            }
            AesTypes::Strength::Aes256 => {
                decrypt::<Aes256Gcm>(&key.key_data, &cipher, &associated_data)
            }
        };
        opened.map_err(|_| decrypt_error())
    }
}

#[cfg(target_arch = "wasm32")]
impl WithPassword for AesPlugin {
    fn encrypt(password: Vec<u8>, data: Vec<u8>, salt: String) -> Vec<u8> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        encrypt::<Aes256Gcm>(&aes_key, &data, &[])
    }

    fn decrypt(password: Vec<u8>, encrypted: Vec<u8>, salt: String) -> Result<Vec<u8>, Error> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        decrypt::<Aes256Gcm>(&aes_key, &encrypted, &[]).map_err(|_| decrypt_error())
    }
}

#[cfg(target_arch = "wasm32")]
bindings::export!(AesPlugin with_types_in bindings);
