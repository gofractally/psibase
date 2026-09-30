//! Given a 32-byte client key, derives sealing keys and applies host:db's
//! at-rest crypto.
//!
//! HKDF-SHA256 expands the client key into separate HMAC and AES-256-GCM keys
//! using distinct `info` strings (`HMAC_INFO`, `AES_INFO`).
//!
//! Storage keys are HMAC-SHA256 of the plaintext host:db key, encoded as
//! lowercase hex (64 characters). Values are AES-256-GCM with associated data
//! set to the HMAC'd storage key; ciphertext layout is `nonce || ciphertext ||
//! tag` (12-byte nonce). Decryption fails when authentication fails, including
//! when AAD does not match the key the value was stored under.

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// HKDF info for the HMAC sealing key.
const HMAC_INFO: &[u8] = b"host:db hmac-sha256";
/// HKDF info for the AES-256-GCM key.
const AES_INFO: &[u8] = b"host:db aes-256-gcm";

#[derive(Clone, Copy)]
pub(crate) struct StorageKeys {
    pub(crate) hmac_key: [u8; 32],
    pub(crate) aes_key: [u8; 32],
}

fn expand_key(hk: &Hkdf<Sha256>, info: &[u8]) -> [u8; 32] {
    let mut okm = [0u8; 32];
    hk.expand(info, &mut okm)
        .expect("HKDF-SHA256 expands a 32-byte key");
    okm
}

pub(crate) fn derive_storage_keys(client_key: &[u8]) -> StorageKeys {
    let hk = Hkdf::<Sha256>::new(None, client_key);
    StorageKeys {
        hmac_key: expand_key(&hk, HMAC_INFO),
        aes_key: expand_key(&hk, AES_INFO),
    }
}

pub(crate) fn hmac_storage_key(hmac_key: &[u8; 32], plaintext_key: &str) -> String {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(hmac_key).expect("HMAC-SHA256 accepts a 32-byte key");
    mac.update(plaintext_key.as_bytes());
    hex::encode(&mac.finalize().into_bytes())
}

pub(crate) fn encrypt_value(
    aes_key: &[u8; 32],
    associated_data: &[u8],
    plaintext: &[u8],
) -> Vec<u8> {
    #[cfg(target_arch = "wasm32")]
    {
        crate::aes::plugin::with_key::encrypt(&aes256_key(aes_key), plaintext, associated_data)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        aes_plugin::encrypt_aes256(aes_key, plaintext, associated_data)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DecryptError;

pub(crate) fn decrypt_value(
    aes_key: &[u8; 32],
    associated_data: &[u8],
    stored: &[u8],
) -> Result<Vec<u8>, DecryptError> {
    #[cfg(target_arch = "wasm32")]
    {
        crate::aes::plugin::with_key::decrypt(&aes256_key(aes_key), stored, associated_data)
            .map_err(|_| DecryptError)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        aes_plugin::decrypt_aes256(aes_key, stored, associated_data).map_err(|_| DecryptError)
    }
}

#[cfg(target_arch = "wasm32")]
fn aes256_key(aes_key: &[u8; 32]) -> crate::aes::plugin::types::Key {
    use crate::aes::plugin::types::{Key, Strength};

    Key {
        strength: Strength::Aes256,
        key_data: aes_key.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_keys() -> StorageKeys {
        derive_storage_keys(&[7u8; 32])
    }

    #[test]
    fn hkdf_stable_and_separate() {
        let client_key = [7u8; 32];
        let first = derive_storage_keys(&client_key);
        let second = derive_storage_keys(&client_key);
        assert_eq!(first.hmac_key, second.hmac_key);
        assert_eq!(first.aes_key, second.aes_key);
        assert_ne!(first.hmac_key, first.aes_key);

        let other = derive_storage_keys(&[8u8; 32]);
        assert_ne!(first.hmac_key, other.hmac_key);
        assert_ne!(first.aes_key, other.aes_key);
    }

    #[test]
    fn hmac_storage_key_hex() {
        let keys = sample_keys();
        let plaintext = "chain:non-trx:alice:contacts:id";
        let sealed = hmac_storage_key(&keys.hmac_key, plaintext);
        assert_eq!(sealed.len(), 64);
        assert!(sealed.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_eq!(sealed, hmac_storage_key(&keys.hmac_key, plaintext));
        assert_ne!(
            sealed,
            hmac_storage_key(&keys.hmac_key, "chain:non-trx:alice:contacts:other")
        );
    }

    #[test]
    fn aad_mismatch_fails_decrypt() {
        let keys = sample_keys();
        let storage_key = hmac_storage_key(&keys.hmac_key, "chain:trx:bob:bucket:k");
        let other_key = hmac_storage_key(&keys.hmac_key, "chain:trx:bob:bucket:other");
        let stored = encrypt_value(&keys.aes_key, storage_key.as_bytes(), b"value-bytes");
        assert!(decrypt_value(&keys.aes_key, other_key.as_bytes(), &stored).is_err());
    }
}
