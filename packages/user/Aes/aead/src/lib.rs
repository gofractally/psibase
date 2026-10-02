use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::generic_array::typenum::Unsigned;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::Aes256Gcm;

pub fn encrypt<C>(key: &[u8], data: &[u8], associated_data: &[u8]) -> Vec<u8>
where
    C: AeadCore + Aead + KeyInit,
{
    let cipher = C::new_from_slice(key)
        .expect("AES-GCM key length matches the selected cipher");
    let nonce = C::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: data,
                aad: associated_data,
            },
        )
        .unwrap_or_else(|e| panic!("Failed to encrypt data: {e}"));

    let mut result = Vec::with_capacity(C::NonceSize::USIZE + ciphertext.len());
    result.extend_from_slice(nonce.as_ref());
    result.extend_from_slice(&ciphertext);
    result
}

pub fn decrypt<C>(
    key: &[u8],
    encrypted_data: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, ()>
where
    C: AeadCore + Aead + KeyInit,
{
    let nonce_len = C::NonceSize::USIZE;
    if encrypted_data.len() < nonce_len + C::TagSize::USIZE {
        return Err(());
    }

    let nonce = GenericArray::from_slice(&encrypted_data[..nonce_len]);
    let cipher = C::new_from_slice(key)
        .expect("AES-GCM key length matches the selected cipher");
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &encrypted_data[nonce_len..],
                aad: associated_data,
            },
        )
        .map_err(|_| ())
}

/// AES-256-GCM. Ciphertext layout is `nonce || ciphertext || tag`.
pub fn encrypt_aes256(key: &[u8], data: &[u8], associated_data: &[u8]) -> Vec<u8> {
    encrypt::<Aes256Gcm>(key, data, associated_data)
}

/// Decrypts AES-256-GCM. Fails when authentication fails.
pub fn decrypt_aes256(key: &[u8], cipher: &[u8], associated_data: &[u8]) -> Result<Vec<u8>, ()> {
    decrypt::<Aes256Gcm>(key, cipher, associated_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_aes256() {
        let key = [1u8; 32];
        let data = b"hello";
        let aad = b"storage-key";
        let stored = encrypt_aes256(&key, data, aad);
        assert_eq!(decrypt_aes256(&key, &stored, aad).unwrap(), data);
    }

    #[test]
    fn aad_mismatch_fails_decrypt() {
        let key = [2u8; 32];
        let stored = encrypt_aes256(&key, b"value", b"key-a");
        assert!(decrypt_aes256(&key, &stored, b"key-b").is_err());
    }
}
