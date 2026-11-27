use crate::keys::PrivateKey;

/// Signs a message digest with a PKCS #8 P-256 or secp256k1 private key and
/// returns the 64-byte signature r || s in the low-S form (s <= n/2), the
/// only form the verifiers accept.
pub fn sign_prehashed(hashed_message: &[u8], private_key: &[u8]) -> Result<Vec<u8>, String> {
    PrivateKey::from_pkcs8_der(private_key)?.sign_prehash(hashed_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{self, KeyStore, PublicKey};
    use std::cell::RefCell;
    use std::collections::HashMap;

    // n / 2 for P-256, big-endian
    const P256_HALF_ORDER: [u8; 32] = [
        0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b, 0xcf, 0x42, 0x79, 0xdc, 0xe5, 0x61, 0x7e, 0x31,
        0x92, 0xa8,
    ];

    // n / 2 for secp256k1, big-endian
    const K256_HALF_ORDER: [u8; 32] = [
        0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b,
        0x20, 0xa0,
    ];

    fn is_low_s(signature: &[u8], half_order: &[u8; 32]) -> bool {
        signature[32..] <= half_order[..]
    }

    fn digest(key_index: u8, message: u8) -> [u8; 32] {
        let mut digest = [message ^ key_index.rotate_left(3); 32];
        digest[0] = message;
        digest[31] = key_index;
        digest
    }

    #[test]
    fn p256_signatures_are_low_s_and_valid() {
        use p256::ecdsa::signature::hazmat::{PrehashSigner, PrehashVerifier};
        use p256::ecdsa::{Signature, SigningKey};
        use p256::pkcs8::EncodePrivateKey;

        let mut unnormalized_high = 0;
        for key_index in 1u8..=8 {
            let key = SigningKey::from_slice(&[key_index; 32]).unwrap();
            let pkcs8 = key.to_pkcs8_der().unwrap();
            for message in 0u8..64 {
                let digest = digest(key_index, message);

                let signature = sign_prehashed(&digest, pkcs8.as_bytes()).unwrap();
                assert_eq!(signature.len(), 64);
                assert!(
                    is_low_s(&signature, &P256_HALF_ORDER),
                    "key {key_index} message {message}"
                );
                key.verifying_key()
                    .verify_prehash(&digest, &Signature::from_slice(&signature).unwrap())
                    .unwrap();

                let raw: Signature = key.sign_prehash(&digest).unwrap();
                if !is_low_s(&raw.to_bytes(), &P256_HALF_ORDER) {
                    unnormalized_high += 1;
                }
            }
        }
        // The signer itself returns high-S about half the time; without
        // normalization this test would have failed above.
        assert!(unnormalized_high > 0);
    }

    #[test]
    fn k256_signatures_are_low_s_and_valid() {
        use k256::ecdsa::signature::hazmat::PrehashVerifier;
        use k256::ecdsa::{Signature, SigningKey};
        use k256::pkcs8::EncodePrivateKey;

        for key_index in 1u8..=8 {
            let key = SigningKey::from_slice(&[key_index; 32]).unwrap();
            let pkcs8 = key.to_pkcs8_der().unwrap();
            for message in 0u8..64 {
                let digest = digest(key_index, message);

                let signature = sign_prehashed(&digest, pkcs8.as_bytes()).unwrap();
                assert_eq!(signature.len(), 64);
                assert!(
                    is_low_s(&signature, &K256_HALF_ORDER),
                    "key {key_index} message {message}"
                );
                key.verifying_key()
                    .verify_prehash(&digest, &Signature::from_slice(&signature).unwrap())
                    .unwrap();
            }
        }
    }

    // The half orders above are what the curve libraries call n / 2: s = n/2
    // is low and s = n/2 + 1 is high.
    #[test]
    fn half_orders_match_the_curves() {
        fn plus_one(mut value: [u8; 32]) -> [u8; 32] {
            for byte in value.iter_mut().rev() {
                *byte = byte.wrapping_add(1);
                if *byte != 0 {
                    break;
                }
            }
            value
        }
        let r = [1u8; 32];

        let at = p256::ecdsa::Signature::from_scalars(r, P256_HALF_ORDER).unwrap();
        let above = p256::ecdsa::Signature::from_scalars(r, plus_one(P256_HALF_ORDER)).unwrap();
        assert!(at.normalize_s().is_none());
        assert!(above.normalize_s().is_some());

        let at = k256::ecdsa::Signature::from_scalars(r, K256_HALF_ORDER).unwrap();
        let above = k256::ecdsa::Signature::from_scalars(r, plus_one(K256_HALF_ORDER)).unwrap();
        assert!(at.normalize_s().is_none());
        assert!(above.normalize_s().is_some());
    }

    #[derive(Default)]
    struct MemoryStore(RefCell<HashMap<String, Vec<u8>>>);

    impl KeyStore for MemoryStore {
        fn put(&self, id: &str, private_key: &[u8]) {
            self.0.borrow_mut().insert(id.to_string(), private_key.to_vec());
        }
        fn fetch(&self, id: &str) -> Option<Vec<u8>> {
            self.0.borrow().get(id).cloned()
        }
        fn remove(&self, id: &str) {
            self.0.borrow_mut().remove(id);
        }
    }

    #[test]
    fn a_forgotten_key_is_gone_whichever_encoding_names_it() {
        use k256::elliptic_curve::sec1::ToEncodedPoint;
        use k256::pkcs8::EncodePrivateKey;
        let store = MemoryStore::default();
        let key = k256::ecdsa::SigningKey::from_slice(&[7; 32]).unwrap();
        let other = k256::ecdsa::SigningKey::from_slice(&[9; 32]).unwrap();
        for k in [&key, &other] {
            keys::import(&store, k.to_pkcs8_der().unwrap().as_bytes()).unwrap();
        }
        let spki = |k: &k256::ecdsa::SigningKey, compress: bool| {
            let point = k.verifying_key().to_encoded_point(compress);
            let mut der = vec![0x30, (K256_ALGORITHM.len() + 3 + point.len()) as u8];
            der.extend_from_slice(&K256_ALGORITHM);
            der.extend_from_slice(&[0x03, (point.len() + 1) as u8, 0x00]);
            der.extend_from_slice(point.as_bytes());
            der
        };
        assert!(keys::find(&[&store], &spki(&key, false)).unwrap().is_some());
        // Named by its compressed encoding; stored under the canonical one
        keys::forget(&store, &spki(&key, true)).unwrap();
        assert!(keys::find(&[&store], &spki(&key, false)).unwrap().is_none());
        assert!(keys::find(&[&store], &spki(&key, true)).unwrap().is_none());
        // The other key is untouched, and forgetting again is harmless.
        assert!(keys::find(&[&store], &spki(&other, false)).unwrap().is_some());
        keys::forget(&store, &spki(&key, false)).unwrap();
        assert!(keys::forget(&store, b"not a key").is_err());
    }

    // id-ecPublicKey, then the curve
    const K256_ALGORITHM: [u8; 18] = [
        0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81,
        0x04, 0x00, 0x0a,
    ];
    const P256_ALGORITHM: [u8; 21] = [
        0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86,
        0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    ];

    /// PKCS #8 whose ECPrivateKey has neither the optional parameters nor
    /// the optional public key.
    fn pkcs8_without_public_key(algorithm: &[u8], secret: &[u8; 32]) -> Vec<u8> {
        let mut ec_private_key = vec![0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20];
        ec_private_key.extend_from_slice(secret);

        let mut body = vec![0x02, 0x01, 0x00];
        body.extend_from_slice(algorithm);
        body.extend_from_slice(&[0x04, ec_private_key.len() as u8]);
        body.extend_from_slice(&ec_private_key);

        let mut result = vec![0x30, body.len() as u8];
        result.extend_from_slice(&body);
        result
    }

    /// SubjectPublicKeyInfo holding a SEC1 point of any length below 100.
    fn spki(algorithm: &[u8], point: &[u8]) -> Vec<u8> {
        let mut body = algorithm.to_vec();
        body.extend_from_slice(&[0x03, point.len() as u8 + 1, 0x00]);
        body.extend_from_slice(point);

        let mut result = vec![0x30, body.len() as u8];
        result.extend_from_slice(&body);
        result
    }

    #[test]
    fn k256_key_without_public_key_field_signs_by_compressed_spki() {
        use k256::ecdsa::signature::hazmat::PrehashVerifier;
        use k256::ecdsa::{Signature, SigningKey};

        let managed = MemoryStore::default();
        let transient = MemoryStore::default();
        for key_index in 1u8..=4 {
            let mut secret = [key_index; 32];
            secret[0] = 0x80;
            let key = SigningKey::from_slice(&secret).unwrap();
            let verifying_key = key.verifying_key();
            let compressed = spki(
                &K256_ALGORITHM,
                verifying_key.to_encoded_point(true).as_bytes(),
            );
            let uncompressed = spki(
                &K256_ALGORITHM,
                verifying_key.to_encoded_point(false).as_bytes(),
            );
            assert_eq!(compressed.len(), 56);
            assert_eq!(uncompressed.len(), 88);

            // Not found before the import
            assert!(keys::find(&[&managed, &transient], &compressed)
                .unwrap()
                .is_none());

            let pkcs8 = pkcs8_without_public_key(&K256_ALGORITHM, &secret);
            let imported = keys::import(&managed, &pkcs8).unwrap();
            assert!(matches!(imported, PublicKey::K256(_)));
            assert_eq!(imported.to_spki_der().unwrap(), uncompressed);

            for public_key in [&compressed, &uncompressed] {
                let private_key = keys::find(&[&managed, &transient], public_key)
                    .unwrap()
                    .expect("key not found");
                assert_eq!(private_key, pkcs8);

                let digest = digest(key_index, 7);
                let signature = sign_prehashed(&digest, &private_key).unwrap();
                assert!(is_low_s(&signature, &K256_HALF_ORDER));
                verifying_key
                    .verify_prehash(&digest, &Signature::from_slice(&signature).unwrap())
                    .unwrap();
            }
        }
        assert_eq!(managed.0.borrow().len(), 4);
        assert!(transient.0.borrow().is_empty());
    }

    #[test]
    fn p256_key_signs_by_either_point_encoding() {
        use p256::ecdsa::signature::hazmat::PrehashVerifier;
        use p256::ecdsa::{Signature, SigningKey};
        use p256::pkcs8::{EncodePrivateKey, EncodePublicKey};

        let managed = MemoryStore::default();
        let transient = MemoryStore::default();
        let secret = [0x42u8; 32];
        let key = SigningKey::from_slice(&secret).unwrap();
        let verifying_key = key.verifying_key();
        let compressed = spki(
            &P256_ALGORITHM,
            verifying_key.to_encoded_point(true).as_bytes(),
        );
        let uncompressed = verifying_key.to_public_key_der().unwrap().into_vec();
        assert_eq!(
            uncompressed,
            spki(
                &P256_ALGORITHM,
                verifying_key.to_encoded_point(false).as_bytes()
            )
        );

        // With and without the public key field, into different stores
        let full = key.to_pkcs8_der().unwrap().as_bytes().to_vec();
        let bare = pkcs8_without_public_key(&P256_ALGORITHM, &secret);
        let imported = keys::import(&transient, &bare).unwrap();
        assert!(matches!(imported, PublicKey::P256(_)));
        // The id of a P-256 key is the one this plugin has always used
        assert_eq!(
            imported.storage_id().unwrap(),
            format!("{:x}", seahash::hash(&uncompressed))
        );
        assert_eq!(
            keys::find(&[&managed, &transient], &compressed).unwrap(),
            Some(bare)
        );
        keys::import(&managed, &full).unwrap();

        for public_key in [&compressed, &uncompressed] {
            let private_key = keys::find(&[&managed, &transient], public_key)
                .unwrap()
                .expect("key not found");
            assert_eq!(private_key, full);

            let digest = digest(1, 2);
            let signature = sign_prehashed(&digest, &private_key).unwrap();
            assert!(is_low_s(&signature, &P256_HALF_ORDER));
            verifying_key
                .verify_prehash(&digest, &Signature::from_slice(&signature).unwrap())
                .unwrap();
        }
    }

    #[test]
    fn curves_do_not_share_storage_ids() {
        let secret = [0x11u8; 32];
        let p256_key = keys::PrivateKey::from_pkcs8_der(&pkcs8_without_public_key(
            &P256_ALGORITHM,
            &secret,
        ))
        .unwrap();
        let k256_key = keys::PrivateKey::from_pkcs8_der(&pkcs8_without_public_key(
            &K256_ALGORITHM,
            &secret,
        ))
        .unwrap();
        assert!(matches!(p256_key, keys::PrivateKey::P256(_)));
        assert!(matches!(k256_key, keys::PrivateKey::K256(_)));
        assert_ne!(
            p256_key.public_key().storage_id().unwrap(),
            k256_key.public_key().storage_id().unwrap()
        );
    }

    #[test]
    fn other_keys_are_rejected() {
        assert!(keys::PrivateKey::from_pkcs8_der(&[0x30, 0x00]).is_err());
        assert!(PublicKey::from_spki_der(&[0x30, 0x00]).is_err());
        // An x coordinate that is not a field element
        let mut point = [0xffu8; 33];
        point[0] = 0x02;
        assert!(PublicKey::from_spki_der(&spki(&K256_ALGORITHM, &point)).is_err());
    }
}
