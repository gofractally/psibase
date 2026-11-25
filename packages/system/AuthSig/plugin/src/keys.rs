//! Comparison of account keys as curve points.
//!
//! The same public key has more than one DER SubjectPublicKeyInfo encoding
//! (compressed or uncompressed point), and the chain stores whichever one the
//! account was given. Keys derived in the browser come out of the curve
//! library with an uncompressed point, so keys must be compared as points,
//! never as text or bytes.

use p256::pkcs8::DecodePublicKey;

/// A public key on one of the curves that have a verifier service.
#[derive(PartialEq, Eq, Debug)]
pub enum AccountKey {
    P256(p256::PublicKey),
    K256(k256::PublicKey),
}

impl AccountKey {
    /// Parses a DER SubjectPublicKeyInfo holding a compressed or
    /// uncompressed P-256 or secp256k1 point.
    pub fn from_spki_der(der: &[u8]) -> Option<Self> {
        if let Ok(key) = p256::PublicKey::from_public_key_der(der) {
            return Some(Self::P256(key));
        }
        k256::PublicKey::from_public_key_der(der)
            .ok()
            .map(Self::K256)
    }

    /// Parses the PEM armor of a DER SubjectPublicKeyInfo.
    pub fn from_pem(key: &str) -> Option<Self> {
        Self::from_spki_der(pem::parse(key.trim()).ok()?.contents())
    }
}

/// True if the two PEM public keys are the same key.
pub fn same_key(a: &str, b: &str) -> bool {
    match (AccountKey::from_pem(a), AccountKey::from_pem(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    use p256::pkcs8::{EncodePublicKey, LineEnding};

    // id-ecPublicKey, then the curve
    const K256_ALGORITHM: [u8; 18] = [
        0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81,
        0x04, 0x00, 0x0a,
    ];
    const P256_ALGORITHM: [u8; 21] = [
        0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86,
        0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    ];

    fn spki_pem(algorithm: &[u8], point: &[u8]) -> String {
        let mut body = algorithm.to_vec();
        body.extend_from_slice(&[0x03, point.len() as u8 + 1, 0x00]);
        body.extend_from_slice(point);
        let mut der = vec![0x30, body.len() as u8];
        der.extend_from_slice(&body);
        pem::encode(&pem::Pem::new("PUBLIC KEY", der))
    }

    #[test]
    fn k256_compressed_matches_uncompressed() {
        for index in 1u8..=8 {
            let key = k256::SecretKey::from_slice(&[index; 32])
                .unwrap()
                .public_key();
            let other = k256::SecretKey::from_slice(&[index + 8; 32])
                .unwrap()
                .public_key();
            // What host:crypto pub-from-priv returns
            let library = key.to_public_key_pem(LineEnding::LF).unwrap();
            let compressed = spki_pem(&K256_ALGORITHM, key.to_encoded_point(true).as_bytes());
            let uncompressed = spki_pem(&K256_ALGORITHM, key.to_encoded_point(false).as_bytes());
            assert_ne!(library, compressed);

            assert!(same_key(&library, &compressed));
            assert!(same_key(&compressed, &library));
            assert!(same_key(&library, &uncompressed));
            assert!(same_key(&compressed, &compressed));

            let other = spki_pem(&K256_ALGORITHM, other.to_encoded_point(true).as_bytes());
            assert!(!same_key(&library, &other));
            assert!(!same_key(&compressed, &other));
        }
    }

    #[test]
    fn p256_compressed_matches_uncompressed() {
        for index in 1u8..=8 {
            let key = p256::SecretKey::from_slice(&[index; 32])
                .unwrap()
                .public_key();
            let other = p256::SecretKey::from_slice(&[index + 8; 32])
                .unwrap()
                .public_key();
            let library = key.to_public_key_pem(LineEnding::LF).unwrap();
            let compressed = spki_pem(&P256_ALGORITHM, key.to_encoded_point(true).as_bytes());
            let uncompressed = spki_pem(&P256_ALGORITHM, key.to_encoded_point(false).as_bytes());
            assert_ne!(library, compressed);

            assert!(same_key(&library, &compressed));
            assert!(same_key(&compressed, &library));
            assert!(same_key(&library, &uncompressed));
            // Surrounding whitespace, as in a GraphQL reply
            assert!(same_key(&format!("\n{library}\n"), &compressed));

            let other = spki_pem(&P256_ALGORITHM, other.to_encoded_point(true).as_bytes());
            assert!(!same_key(&library, &other));
        }
    }

    #[test]
    fn the_curve_is_part_of_the_key() {
        // The same secret on the two curves, and a point whose bytes are
        // labelled with the wrong curve
        let secret = [7u8; 32];
        let p256_key = p256::SecretKey::from_slice(&secret).unwrap().public_key();
        let k256_key = k256::SecretKey::from_slice(&secret).unwrap().public_key();
        let p256_pem = p256_key.to_public_key_pem(LineEnding::LF).unwrap();
        let k256_pem = k256_key.to_public_key_pem(LineEnding::LF).unwrap();
        assert!(!same_key(&p256_pem, &k256_pem));

        let mislabelled = spki_pem(&K256_ALGORITHM, p256_key.to_encoded_point(false).as_bytes());
        assert!(!same_key(&p256_pem, &mislabelled));
    }

    #[test]
    fn unparsable_keys_never_match() {
        assert!(!same_key("", ""));
        assert!(!same_key("not a key", "not a key"));
        let garbage = pem::encode(&pem::Pem::new("PUBLIC KEY", vec![0x30, 0x00]));
        assert!(!same_key(&garbage, &garbage));
    }
}
