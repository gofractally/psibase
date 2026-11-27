//! Curve-agnostic handling of account keys: P-256 and secp256k1.
//!
//! Everything in this module is pure (no host calls) so it runs in native
//! unit tests.

use p256::pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePublicKey, LineEnding};

/// A private key on one of the curves that have a verifier service.
pub enum PrivateKey {
    P256(p256::ecdsa::SigningKey),
    K256(k256::ecdsa::SigningKey),
}

/// A public key on one of the curves that have a verifier service.
pub enum PublicKey {
    P256(p256::ecdsa::VerifyingKey),
    K256(k256::ecdsa::VerifyingKey),
}

impl PrivateKey {
    /// Parses a PKCS #8 DER private key. The curve is taken from the
    /// algorithm parameters; the optional public key field may be absent.
    pub fn from_pkcs8_der(der: &[u8]) -> Result<Self, String> {
        let p256_error = match p256::ecdsa::SigningKey::from_pkcs8_der(der) {
            Ok(key) => return Ok(Self::P256(key)),
            Err(e) => e,
        };
        match k256::ecdsa::SigningKey::from_pkcs8_der(der) {
            Ok(key) => Ok(Self::K256(key)),
            Err(k256_error) => Err(format!(
                "not a P-256 ({p256_error}) or secp256k1 ({k256_error}) PKCS #8 private key"
            )),
        }
    }

    pub fn public_key(&self) -> PublicKey {
        match self {
            Self::P256(key) => PublicKey::P256(*key.verifying_key()),
            Self::K256(key) => PublicKey::K256(*key.verifying_key()),
        }
    }

    /// Signs a message digest and returns the 64-byte signature r || s in
    /// the low-S form (s <= n/2), the only form the verifiers accept. A signer
    /// may produce either s; (r, n - s) is the same signature in its other
    /// encoding.
    pub fn sign_prehash(&self, hashed_message: &[u8]) -> Result<Vec<u8>, String> {
        match self {
            Self::P256(key) => {
                use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature};
                let signature: Signature = key
                    .sign_prehash(hashed_message)
                    .map_err(|e| e.to_string())?;
                let signature = signature.normalize_s().unwrap_or(signature);
                Ok(signature.to_bytes().to_vec())
            }
            Self::K256(key) => {
                use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature};
                let signature: Signature = key
                    .sign_prehash(hashed_message)
                    .map_err(|e| e.to_string())?;
                let signature = signature.normalize_s().unwrap_or(signature);
                Ok(signature.to_bytes().to_vec())
            }
        }
    }
}

impl PublicKey {
    /// Parses a DER SubjectPublicKeyInfo. The point may be compressed or
    /// uncompressed.
    pub fn from_spki_der(der: &[u8]) -> Result<Self, String> {
        let p256_error = match p256::ecdsa::VerifyingKey::from_public_key_der(der) {
            Ok(key) => return Ok(Self::P256(key)),
            Err(e) => e,
        };
        match k256::ecdsa::VerifyingKey::from_public_key_der(der) {
            Ok(key) => Ok(Self::K256(key)),
            Err(k256_error) => Err(format!(
                "not a P-256 ({p256_error}) or secp256k1 ({k256_error}) public key"
            )),
        }
    }

    /// The canonical encoding of this key: SubjectPublicKeyInfo with an
    /// uncompressed point. Every encoding of the same key gives the same
    /// bytes here.
    pub fn to_spki_der(&self) -> Result<Vec<u8>, String> {
        let document = match self {
            Self::P256(key) => key.to_public_key_der(),
            Self::K256(key) => key.to_public_key_der(),
        };
        Ok(document.map_err(|e| e.to_string())?.into_vec())
    }

    /// PEM armor of `to_spki_der`.
    pub fn to_pem(&self) -> Result<String, String> {
        match self {
            Self::P256(key) => key.to_public_key_pem(LineEnding::LF),
            Self::K256(key) => key.to_public_key_pem(LineEnding::LF),
        }
        .map_err(|e| e.to_string())
    }

    /// The name under which the private key of this public key is stored:
    /// hex(seahash(canonical SubjectPublicKeyInfo)). It does not depend on
    /// how the public key was encoded by whoever names it.
    pub fn storage_id(&self) -> Result<String, String> {
        Ok(format!("{:x}", seahash::hash(&self.to_spki_der()?)))
    }
}

/// Where private keys are kept, by `PublicKey::storage_id`.
pub trait KeyStore {
    fn put(&self, id: &str, private_key: &[u8]);
    fn fetch(&self, id: &str) -> Option<Vec<u8>>;
    fn remove(&self, id: &str);
}

/// Removes the private key of a DER SubjectPublicKeyInfo from a store,
/// however the public key is encoded.
pub fn forget(store: &dyn KeyStore, public_key: &[u8]) -> Result<(), String> {
    store.remove(&PublicKey::from_spki_der(public_key)?.storage_id()?);
    Ok(())
}

/// Stores a PKCS #8 DER private key and returns its public key.
pub fn import(store: &dyn KeyStore, private_key: &[u8]) -> Result<PublicKey, String> {
    let public_key = PrivateKey::from_pkcs8_der(private_key)?.public_key();
    store.put(&public_key.storage_id()?, private_key);
    Ok(public_key)
}

/// Finds the private key of a DER SubjectPublicKeyInfo in the first store
/// that has it.
pub fn find(stores: &[&dyn KeyStore], public_key: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let id = PublicKey::from_spki_der(public_key)?.storage_id()?;
    Ok(stores.iter().find_map(|store| store.fetch(&id)))
}
