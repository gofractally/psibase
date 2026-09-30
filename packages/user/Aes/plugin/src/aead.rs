use aes_gcm::aead::generic_array::typenum::Unsigned;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
#[cfg(not(target_arch = "wasm32"))]
use aes_gcm::Aes256Gcm;
use aes_gcm::Nonce;

pub(crate) fn encrypt<C>(key: &[u8], data: &[u8], associated_data: &[u8]) -> Vec<u8>
where
    C: AeadCore + Aead + KeyInit,
{
    let cipher = C::new_from_slice(key).unwrap();
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

pub(crate) fn decrypt<C>(
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

    let mut nonce = Nonce::<C::NonceSize>::default();
    nonce.copy_from_slice(&encrypted_data[..nonce_len]);
    let cipher = C::new_from_slice(key).unwrap();
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &encrypted_data[nonce_len..],
                aad: associated_data,
            },
        )
        .map_err(|_| ())
}

/// AES-256-GCM. Ciphertext layout is `nonce || ciphertext || tag`.
#[cfg(not(target_arch = "wasm32"))]
pub fn encrypt_aes256(key: &[u8], data: &[u8], associated_data: &[u8]) -> Vec<u8> {
    encrypt::<Aes256Gcm>(key, data, associated_data)
}

/// Decrypts AES-256-GCM. Fails when authentication fails.
#[cfg(not(target_arch = "wasm32"))]
pub fn decrypt_aes256(key: &[u8], cipher: &[u8], associated_data: &[u8]) -> Result<Vec<u8>, ()> {
    decrypt::<Aes256Gcm>(key, cipher, associated_data)
}
