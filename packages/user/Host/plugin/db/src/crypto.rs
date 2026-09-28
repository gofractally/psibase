use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const HMAC_INFO: &[u8] = b"host:db hmac-sha256";
const AES_INFO: &[u8] = b"host:db aes-256-gcm";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

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
    hex_encode(&mac.finalize().into_bytes())
}

/// `nonce || ciphertext || tag`. `associated_data` is authenticated with the value.
pub(crate) fn encrypt_value(
    aes_key: &[u8; 32],
    associated_data: &[u8],
    plaintext: &[u8],
) -> Vec<u8> {
    let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(*aes_key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: associated_data,
            },
        )
        .expect("AES-256-GCM encrypt");
    let mut stored = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    stored.extend_from_slice(nonce.as_ref());
    stored.extend_from_slice(&ciphertext);
    stored
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DecryptError;

/// Decrypts a stored value. Fails when authentication fails, including when
/// `associated_data` is not the HMAC'd key the value was encrypted under.
pub(crate) fn decrypt_value(
    aes_key: &[u8; 32],
    associated_data: &[u8],
    stored: &[u8],
) -> Result<Vec<u8>, DecryptError> {
    if stored.len() < NONCE_LEN + TAG_LEN {
        return Err(DecryptError);
    }
    let mut nonce = Nonce::default();
    nonce.copy_from_slice(&stored[..NONCE_LEN]);
    let cipher = Aes256Gcm::new(&Key::<Aes256Gcm>::from(*aes_key));
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &stored[NONCE_LEN..],
                aad: associated_data,
            },
        )
        .map_err(|_| DecryptError)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xf) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_keys() -> StorageKeys {
        derive_storage_keys(&[7u8; 32])
    }

    #[test]
    fn derivation_is_stable_and_separates_keys() {
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
    fn hmac_is_lowercase_hex_of_the_plaintext_key() {
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
    fn encrypt_decrypt_round_trip() {
        let keys = sample_keys();
        let storage_key = hmac_storage_key(&keys.hmac_key, "chain:trx:bob:bucket:k");
        let plaintext = b"value-bytes";
        let stored = encrypt_value(&keys.aes_key, storage_key.as_bytes(), plaintext);
        assert_eq!(stored.len(), NONCE_LEN + plaintext.len() + TAG_LEN);
        let opened = decrypt_value(&keys.aes_key, storage_key.as_bytes(), &stored).unwrap();
        assert_eq!(opened, plaintext);
    }

    #[test]
    fn decrypt_fails_under_a_different_hmac_key() {
        let keys = sample_keys();
        let storage_key = hmac_storage_key(&keys.hmac_key, "chain:trx:bob:bucket:k");
        let other_key = hmac_storage_key(&keys.hmac_key, "chain:trx:bob:bucket:other");
        let stored = encrypt_value(&keys.aes_key, storage_key.as_bytes(), b"value-bytes");
        assert!(decrypt_value(&keys.aes_key, other_key.as_bytes(), &stored).is_err());
    }
}
