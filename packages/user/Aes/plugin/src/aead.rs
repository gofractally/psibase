use aes_gcm::aead::generic_array::typenum::Unsigned;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, Nonce, OsRng, Payload};

/// Encrypts with AES-GCM. Output is `nonce || ciphertext || tag`.
pub(crate) fn encrypt<C>(key: &[u8], data: &[u8], associated_data: &[u8]) -> Vec<u8>
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
        .expect("Failed to encrypt data");

    let mut result = Vec::with_capacity(C::NonceSize::USIZE + ciphertext.len());
    result.extend_from_slice(nonce.as_ref());
    result.extend_from_slice(&ciphertext);
    result
}

/// Decrypts AES-GCM ciphertext from [`encrypt`]. Fails on auth failure or malformed input.
pub(crate) fn decrypt<C>(
    key: &[u8],
    encrypted_data: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, DecryptError>
where
    C: AeadCore + Aead + KeyInit,
{
    let nonce_len = C::NonceSize::USIZE;
    if encrypted_data.len() < nonce_len + C::TagSize::USIZE {
        return Err(DecryptError::Malformed);
    }

    let nonce: &Nonce<C> = (&encrypted_data[..nonce_len]).into();
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
        .map_err(|_| DecryptError::AuthFailed)
}

#[derive(Debug)]
pub(crate) enum DecryptError {
    Malformed,
    AuthFailed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::Aes256Gcm;

    #[test]
    fn round_trip_aes256() {
        let key = [1u8; 32];
        let data = b"hello";
        let aad = b"storage-key";
        let stored = encrypt::<Aes256Gcm>(&key, data, aad);
        assert_eq!(decrypt::<Aes256Gcm>(&key, &stored, aad).unwrap(), data);
    }

    #[test]
    fn aad_mismatch_fails_decrypt() {
        let key = [2u8; 32];
        let stored = encrypt::<Aes256Gcm>(&key, b"value", b"key-a");
        assert!(matches!(
            decrypt::<Aes256Gcm>(&key, &stored, b"key-b"),
            Err(DecryptError::AuthFailed)
        ));
    }
}
