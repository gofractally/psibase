//! Given a 32-byte client key, derives host:db sealing keys.
//!
//! HKDF-SHA256 expands the client key into separate HMAC and AES-256-GCM keys
//! using distinct `info` strings (`HMAC_INFO`, `AES_INFO`).
//!
//! Storage keys are HMAC-SHA256 of the plaintext host:db key, encoded as
//! lowercase hex (64 characters).

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
}
