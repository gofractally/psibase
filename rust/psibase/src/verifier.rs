//! Which services verify signatures made with which kind of key.
//!
//! Each verifier service handles one kind of key. A kind of key has a
//! default verifier and may have others that an account can choose instead;
//! a claim for a key names one of them. Everything that builds or checks a
//! claim asks here instead of naming a service. This mirrors
//! `psibase/verifier.hpp`; the two must agree.
//!
//! - A claim on its own (a credential, a guest key) is acceptable if it
//!   names any verifier allowed for its key: `is_allowed_verifier`.
//! - A claim for an account must name the verifier the account stored with
//!   its key (auth-sig). The default is `verifier_for`.

use crate::{account_raw, AccountNumber};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyType {
    /// "K1"
    Secp256k1,
    /// "R1", P-256
    Secp256r1,
}

/// Verifies secp256k1 signatures
pub const VERIFY_K1: AccountNumber = AccountNumber::new(account_raw!("verify-k1"));
/// Verifies secp256r1 (P-256) signatures. The default for that curve.
pub const VERIFY_R1: AccountNumber = AccountNumber::new(account_raw!("verify-r1"));
/// Verifies secp256r1 (P-256) signatures with a second, independent
/// implementation. An account may choose it in place of the default.
pub const VERIFY_BEAR1: AccountNumber = AccountNumber::new(account_raw!("verify-br1"));

// The verifiers allowed for each key type, the default first.
const K1_VERIFIERS: [AccountNumber; 1] = [VERIFY_K1];
const R1_VERIFIERS: [AccountNumber; 2] = [VERIFY_R1, VERIFY_BEAR1];

// AlgorithmIdentifier { id-ecPublicKey, namedCurve }
const K1_ALGORITHM: [u8; 18] = [
    0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04,
    0x00, 0x0a,
];
const R1_ALGORITHM: [u8; 21] = [
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x03, 0x01, 0x07,
];

const KEY_TYPES: [KeyType; 2] = [KeyType::Secp256k1, KeyType::Secp256r1];

impl KeyType {
    fn algorithm(self) -> &'static [u8] {
        match self {
            KeyType::Secp256k1 => &K1_ALGORITHM,
            KeyType::Secp256r1 => &R1_ALGORITHM,
        }
    }

    /// The verifiers allowed for keys of this type, the default first
    pub const fn allowed_verifiers(self) -> &'static [AccountNumber] {
        match self {
            KeyType::Secp256k1 => &K1_VERIFIERS,
            KeyType::Secp256r1 => &R1_VERIFIERS,
        }
    }

    /// The default verifier for keys of this type
    pub const fn verifier(self) -> AccountNumber {
        self.allowed_verifiers()[0]
    }
}

/// If `spki` is exactly the DER SubjectPublicKeyInfo of a key of the given
/// type, returns the encoded point.
///
/// The encoding is SEQUENCE { algorithm, BIT STRING point } with the fixed
/// AlgorithmIdentifier of the curve and a point of 65 bytes (uncompressed,
/// or the hybrid form that the verifiers go on to reject) or 33 bytes
/// (compressed). Nothing else that a general DER parser would tolerate
/// matches: no trailing bytes, no unused bits, no alternative identifier
/// encodings. Whether the point is on the curve is not examined.
pub fn ec_point(spki: &[u8], key_type: KeyType) -> Option<&[u8]> {
    let algorithm = key_type.algorithm();
    // outer SEQUENCE header, algorithm, BIT STRING header with zero unused bits
    let header = 2 + algorithm.len() + 3;
    if spki.len() != header + 65 && spki.len() != header + 33 {
        return None;
    }
    let point_size = spki.len() - header;
    if spki[0] != 0x30 || spki[1] as usize != spki.len() - 2 {
        return None;
    }
    if &spki[2..2 + algorithm.len()] != algorithm {
        return None;
    }
    let bits = &spki[2 + algorithm.len()..];
    if bits[0] != 0x03 || bits[1] as usize != point_size + 1 || bits[2] != 0x00 {
        return None;
    }
    Some(&spki[header..])
}

/// The type of the key whose DER SubjectPublicKeyInfo is `spki`, if a
/// verifier exists for it and it is encoded as that verifier requires.
pub fn key_type(spki: &[u8]) -> Option<KeyType> {
    KEY_TYPES
        .into_iter()
        .find(|t| ec_point(spki, *t).is_some())
}

/// The default verifier for the key whose DER SubjectPublicKeyInfo is
/// `spki`: the service a claim for this key names unless another allowed
/// verifier was chosen for it. `None` if no verifier accepts the key.
pub fn verifier_for(spki: &[u8]) -> Option<AccountNumber> {
    key_type(spki).map(KeyType::verifier)
}

/// The verifiers allowed for the key whose DER SubjectPublicKeyInfo is
/// `spki`, the default first. Empty if no verifier accepts the key.
pub fn allowed_verifiers(spki: &[u8]) -> &'static [AccountNumber] {
    key_type(spki).map_or(&[], KeyType::allowed_verifiers)
}

/// The type of key that `service` verifies, if it is one of the verifiers
pub fn verified_key_type(service: AccountNumber) -> Option<KeyType> {
    KEY_TYPES
        .into_iter()
        .find(|t| t.allowed_verifiers().contains(&service))
}

/// Whether `service` is one of the verifiers allowed for the key whose DER
/// SubjectPublicKeyInfo is `spki`: whether a claim of `service` and this key
/// is one that can be verified.
pub fn is_allowed_verifier(service: AccountNumber, spki: &[u8]) -> bool {
    allowed_verifiers(spki).contains(&service)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spki(key_type: KeyType, point: &[u8]) -> Vec<u8> {
        let algorithm = key_type.algorithm();
        let mut result = vec![0x30, (algorithm.len() + 3 + point.len()) as u8];
        result.extend_from_slice(algorithm);
        result.extend_from_slice(&[0x03, (point.len() + 1) as u8, 0x00]);
        result.extend_from_slice(point);
        result
    }

    #[test]
    fn account_names_round_trip() {
        assert_eq!(VERIFY_K1.to_string(), "verify-k1");
        assert_eq!(VERIFY_R1.to_string(), "verify-r1");
        assert_eq!("verify-k1".parse::<AccountNumber>().unwrap(), VERIFY_K1);
        assert_eq!("verify-r1".parse::<AccountNumber>().unwrap(), VERIFY_R1);
        assert_eq!(VERIFY_BEAR1.to_string(), "verify-br1");
        assert_eq!("verify-br1".parse::<AccountNumber>().unwrap(), VERIFY_BEAR1);
        assert_ne!(VERIFY_K1, VERIFY_R1);
        assert_ne!(VERIFY_R1, VERIFY_BEAR1);
        assert_ne!(VERIFY_K1, VERIFY_BEAR1);
    }

    #[test]
    fn allowed_verifiers_per_key_type() {
        let mut point = vec![0x04];
        point.extend_from_slice(&[0x11; 64]);
        let k1 = spki(KeyType::Secp256k1, &point);
        let r1 = spki(KeyType::Secp256r1, &point);
        assert_eq!(allowed_verifiers(&k1), &[VERIFY_K1]);
        assert_eq!(allowed_verifiers(&r1), &[VERIFY_R1, VERIFY_BEAR1]);
        assert!(allowed_verifiers(&[]).is_empty());

        assert!(is_allowed_verifier(VERIFY_K1, &k1));
        assert!(!is_allowed_verifier(VERIFY_R1, &k1));
        assert!(!is_allowed_verifier(VERIFY_BEAR1, &k1));
        assert!(is_allowed_verifier(VERIFY_R1, &r1));
        assert!(is_allowed_verifier(VERIFY_BEAR1, &r1));
        assert!(!is_allowed_verifier(VERIFY_K1, &r1));
        assert!(!is_allowed_verifier(VERIFY_R1, &[]));
        assert!(!is_allowed_verifier(AccountNumber::new(account_raw!("auth-sig")), &r1));

        assert_eq!(verified_key_type(VERIFY_BEAR1), Some(KeyType::Secp256r1));
        // The default is the first of the allowed verifiers.
        assert_eq!(verifier_for(&r1), Some(VERIFY_R1));
        assert_eq!(verifier_for(&k1), Some(VERIFY_K1));
    }

    #[test]
    fn both_curves_and_both_point_encodings() {
        let mut uncompressed = vec![0x04];
        uncompressed.extend_from_slice(&[0x11; 64]);
        let mut compressed = vec![0x02];
        compressed.extend_from_slice(&[0x11; 32]);
        for (key_type, service) in [
            (KeyType::Secp256k1, VERIFY_K1),
            (KeyType::Secp256r1, VERIFY_R1),
        ] {
            for point in [&uncompressed, &compressed] {
                let key = spki(key_type, point);
                assert_eq!(verifier_for(&key), Some(service));
                assert_eq!(super::key_type(&key), Some(key_type));
                assert_eq!(ec_point(&key, key_type), Some(&point[..]));
            }
            assert_eq!(verified_key_type(service), Some(key_type));
            assert_eq!(key_type.verifier(), service);
        }
        assert_eq!(verified_key_type(AccountNumber::new(account_raw!("auth-sig"))), None);
    }

    #[test]
    fn anything_else_has_no_verifier() {
        let mut point = vec![0x04];
        point.extend_from_slice(&[0x11; 64]);
        let good = spki(KeyType::Secp256r1, &point);
        assert!(verifier_for(&good).is_some());

        assert_eq!(verifier_for(&[]), None);
        assert_eq!(verifier_for(&[0x30]), None);
        assert_eq!(verifier_for(&[0u8; 91]), None);
        assert_eq!(verifier_for(b"-----BEGIN PUBLIC KEY-----"), None);

        let mut trailing = good.clone();
        trailing.push(0);
        assert_eq!(verifier_for(&trailing), None);

        let mut truncated = good.clone();
        truncated.pop();
        assert_eq!(verifier_for(&truncated), None);

        // last byte of the curve identifier
        let mut other_curve = good.clone();
        other_curve[22] ^= 1;
        assert_eq!(verifier_for(&other_curve), None);

        let mut unused_bits = good.clone();
        let at = unused_bits.len() - 66;
        unused_bits[at] = 1;
        assert_eq!(verifier_for(&unused_bits), None);

        let mut wrong_length = good.clone();
        wrong_length[1] += 1;
        assert_eq!(verifier_for(&wrong_length), None);
    }
}
