//! Generic BIP32 secp256k1 key isolation and ECDSA signing of an exact 32-byte digest.
//! No transactions, Bitcoin networks, addresses, fees, proofs or application policy.
use bip32::{ChildNumber, Prefix, XPrv, XPub};
use k256::ecdsa::{
    signature::hazmat::{PrehashSigner, PrehashVerifier},
    Signature,
};
pub type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn path(path: &[u32]) -> Result<Vec<ChildNumber>> {
    if path.len() > 8 {
        return Err("Derivation path limit".into());
    }
    path.iter()
        .map(|i| ChildNumber::new(*i, false).map_err(error))
        .collect()
}
fn private(seed: &str, key_id: u32, children: &[u32]) -> Result<XPrv> {
    let mut key = XPrv::new(hex::decode(seed).map_err(error)?).map_err(error)?;
    // Every owner receives its own hardened branch; child-private leaks cannot cross owner branches.
    key = key
        .derive_child(ChildNumber::new(key_id, true).map_err(error)?)
        .map_err(error)?;
    for child in path(children)? {
        key = key.derive_child(child).map_err(error)?;
    }
    Ok(key)
}
pub fn public_key(seed: &str, key_id: u32) -> Result<String> {
    Ok(private(seed, key_id, &[])?
        .public_key()
        .to_string(Prefix::XPUB))
}
pub fn child_public(root: &str, children: &[u32]) -> Result<String> {
    let mut key: XPub = root.parse().map_err(error)?;
    for child in path(children)? {
        key = key.derive_child(child).map_err(error)?;
    }
    Ok(hex::encode(key.to_bytes()))
}
pub fn valid_hash(hash: &str) -> Result<[u8; 32]> {
    hex::decode(hash)
        .map_err(error)?
        .try_into()
        .map_err(|_| "Expected a 32-byte digest".into())
}
pub fn sign(seed: &str, key_id: u32, children: &[u32], hash: &str) -> Result<String> {
    let key = private(seed, key_id, children)?;
    let signature: Signature = key
        .private_key()
        .sign_prehash(&valid_hash(hash)?)
        .map_err(error)?;
    Ok(hex::encode(
        signature.normalize_s().unwrap_or(signature).to_bytes(),
    ))
}
pub fn verify(public: &str, hash: &str, signature: &str) -> Result<()> {
    let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(&hex::decode(public).map_err(error)?)
        .map_err(error)?;
    let sig = Signature::from_slice(&hex::decode(signature).map_err(error)?).map_err(error)?;
    if sig.normalize_s().is_some() {
        return Err("High-S signature rejected".into());
    }
    key.verify_prehash(&valid_hash(hash)?, &sig).map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generic_prehash_signature_and_owner_branch_isolation() {
        let seed = "07".repeat(32);
        let root = public_key(&seed, 1).unwrap();
        let hash = "ab".repeat(32);
        let public = child_public(&root, &[0, 9]).unwrap();
        let sig = sign(&seed, 1, &[0, 9], &hash).unwrap();
        verify(&public, &hash, &sig).unwrap();
        assert!(verify(&public, &"ac".repeat(32), &sig).is_err());
        let other = child_public(&public_key(&seed, 2).unwrap(), &[0, 9]).unwrap();
        assert!(verify(&other, &hash, &sig).is_err());
        assert!(child_public(&root, &[1 << 31]).is_err());
        assert!(valid_hash("ab").is_err());
    }
}
