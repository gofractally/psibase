use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use p256::pkcs8::DecodePrivateKey;

/// Signs a message digest with a PKCS #8 P-256 private key and returns the
/// 64-byte signature r || s in the low-S form (s <= n/2), the only form
/// verify-sig accepts. The signer produces either s; (r, n - s) is the same
/// signature in its other encoding.
pub fn sign_prehashed(hashed_message: &[u8], private_key: &[u8]) -> Result<Vec<u8>, String> {
    let signing_key = SigningKey::from_pkcs8_der(private_key).map_err(|e| e.to_string())?;
    let signature: Signature = signing_key
        .sign_prehash(hashed_message)
        .map_err(|e| e.to_string())?;
    let signature = signature.normalize_s().unwrap_or(signature);
    Ok(signature.to_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::hazmat::PrehashVerifier;
    use p256::pkcs8::EncodePrivateKey;

    // n / 2 for P-256, big-endian
    const HALF_ORDER: [u8; 32] = [
        0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b, 0xcf, 0x42, 0x79, 0xdc, 0xe5, 0x61, 0x7e, 0x31,
        0x92, 0xa8,
    ];

    fn is_low_s(signature: &[u8]) -> bool {
        signature[32..] <= HALF_ORDER[..]
    }

    #[test]
    fn signatures_are_low_s_and_valid() {
        let mut unnormalized_high = 0;
        for key_index in 1u8..=4 {
            let key = SigningKey::from_slice(&[key_index; 32]).unwrap();
            let pkcs8 = key.to_pkcs8_der().unwrap();
            for message in 0u8..64 {
                let digest = [message ^ key_index.rotate_left(3); 32];

                let signature = sign_prehashed(&digest, pkcs8.as_bytes()).unwrap();
                assert_eq!(signature.len(), 64);
                assert!(is_low_s(&signature), "key {key_index} message {message}");
                key.verifying_key()
                    .verify_prehash(&digest, &Signature::from_slice(&signature).unwrap())
                    .unwrap();

                let raw: Signature = key.sign_prehash(&digest).unwrap();
                if !is_low_s(&raw.to_bytes()) {
                    unnormalized_high += 1;
                }
            }
        }
        // The signer itself returns high-S about half the time; without
        // normalization this test would have failed above.
        assert!(unnormalized_high > 0);
    }
}
