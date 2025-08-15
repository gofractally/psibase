#[allow(warnings)]
mod bindings;
use bindings::*;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use exports::aes::plugin::with_key::Guest as WithKey;
use exports::aes::plugin::with_password::Guest as WithPassword;
use host::types::types::{Error, PluginId};
use kdf::plugin::api as Kdf;

const AES_KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 12;

fn encrypt_with_aes(key: &[u8; AES_KEY_SIZE], data: &[u8]) -> Vec<u8> {
    let aes_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(aes_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = match cipher.encrypt(&nonce, data) {
        Ok(ct) => ct,
        Err(e) => {
            panic!("Failed to encrypt data: {}", e.to_string());
        }
    };

    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(nonce.as_slice());
    result.extend_from_slice(&ciphertext);
    result
}

fn decrypt_with_aes(key: &[u8; AES_KEY_SIZE], encrypted_data: &[u8]) -> Result<Vec<u8>, Error> {
    if encrypted_data.len() < NONCE_SIZE {
        panic!("Encrypted data too short");
    }

    // The first NONCE_SIZE bytes are the nonce, the rest is the ciphertext
    let nonce_bytes = &encrypted_data[..NONCE_SIZE];
    let nonce = Nonce::from_slice(nonce_bytes);

    let aes_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(aes_key);

    let ciphertext = &encrypted_data[NONCE_SIZE..];
    let decrypted = match cipher.decrypt(nonce, ciphertext) {
        Ok(pt) => pt,
        Err(_) => {
            return Err(Error {
                code: 0,
                producer: PluginId {
                    service: "aes".to_string(),
                    plugin: "plugin".to_string(),
                },
                message: "Failed to decrypt data".to_string(),
            });
        }
    };

    Ok(decrypted)
}

impl WithKey for AesPlugin {
    fn encrypt(key: Vec<u8>, data: Vec<u8>) -> Vec<u8> {
        encrypt_with_aes(&key.as_slice().try_into().unwrap(), &data)
    }

    fn decrypt(key: Vec<u8>, cipher: Vec<u8>) -> Result<Vec<u8>, Error> {
        decrypt_with_aes(&key.as_slice().try_into().unwrap(), &cipher)
    }
}

struct AesPlugin;
impl WithPassword for AesPlugin {
    fn encrypt(password: Vec<u8>, data: Vec<u8>, salt: String) -> Vec<u8> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        encrypt_with_aes(&aes_key.as_slice().try_into().unwrap(), &data)
    }

    fn decrypt(password: Vec<u8>, encrypted: Vec<u8>, salt: String) -> Result<Vec<u8>, Error> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        Ok(decrypt_with_aes(
            &aes_key.as_slice().try_into().unwrap(),
            &encrypted,
        )?)
    }
}

bindings::export!(AesPlugin with_types_in bindings);
