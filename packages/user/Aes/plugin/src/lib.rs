#[allow(warnings)]
mod bindings;
use bindings::*;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes128Gcm, Aes256Gcm, Key, Nonce,
};
use exports::aes::plugin::types as AesTypes;
use exports::aes::plugin::with_key::Guest as WithKey;
use exports::aes::plugin::with_password::Guest as WithPassword;
use host::types::types::{Error, PluginId};
use kdf::plugin::api as Kdf;

const NONCE_SIZE: usize = 12;

fn encrypt_with_aes<C>(key: &[u8], data: &[u8]) -> Vec<u8>
where
    C: AeadCore + Aead + KeyInit,
{
    let aes_key = Key::<C>::from_slice(key);
    let cipher = C::new(aes_key);
    let nonce = C::generate_nonce(&mut OsRng);

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

fn decrypt_with_aes<C>(key: &[u8], encrypted_data: &[u8]) -> Result<Vec<u8>, Error>
where
    C: AeadCore + Aead + KeyInit,
{
    if encrypted_data.len() < NONCE_SIZE {
        panic!("Encrypted data too short");
    }

    // The first NONCE_SIZE bytes are the nonce, the rest is the ciphertext
    let nonce_bytes = &encrypted_data[..NONCE_SIZE];
    let nonce = Nonce::from_slice(nonce_bytes);

    let aes_key = Key::<C>::from_slice(key);
    let cipher = C::new(aes_key);

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
    fn encrypt(key: AesTypes::Key, data: Vec<u8>) -> Vec<u8> {
        match key.size {
            AesTypes::KeySizeBytes::Sixteen => encrypt_with_aes::<Aes128Gcm>(&key.key_data, &data),
            AesTypes::KeySizeBytes::ThirtyTwo => {
                encrypt_with_aes::<Aes256Gcm>(&key.key_data, &data)
            }
        }
    }

    fn decrypt(key: AesTypes::Key, cipher: Vec<u8>) -> Result<Vec<u8>, Error> {
        match key.size {
            AesTypes::KeySizeBytes::Sixteen => {
                decrypt_with_aes::<Aes128Gcm>(&key.key_data, &cipher)
            }
            AesTypes::KeySizeBytes::ThirtyTwo => {
                decrypt_with_aes::<Aes256Gcm>(&key.key_data, &cipher)
            }
        }
    }
}

struct AesPlugin;
impl WithPassword for AesPlugin {
    fn encrypt(password: Vec<u8>, data: Vec<u8>, salt: String) -> Vec<u8> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        encrypt_with_aes::<Aes256Gcm>(&aes_key, &data)
    }

    fn decrypt(password: Vec<u8>, encrypted: Vec<u8>, salt: String) -> Result<Vec<u8>, Error> {
        let aes_key = Kdf::derive_key(Kdf::Keytype::Aes, &password, &salt);
        Ok(decrypt_with_aes::<Aes256Gcm>(&aes_key, &encrypted)?)
    }
}

bindings::export!(AesPlugin with_types_in bindings);
