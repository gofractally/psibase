use crate::bindings::auth_sig::plugin::types::Pem;
use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::types as CommonTypes;
use crate::types::*;

fn get_hash(key: &Pem) -> Result<String, CommonTypes::Error> {
    let pem = pem::Pem::try_from_pem_str(&key)?;
    let digest = seahash::hash(&pem.contents().to_vec());
    Ok(format!("{:x}", digest))
}

pub struct ManagedKeys;

impl ManagedKeys {
    pub fn add(pubkey: &Pem, privkey: &[u8]) {
        let hash = get_hash(pubkey).expect("ManagedKeys::set: Failed to hash public key");
        Keyvalue::set(&hash, &privkey).expect("Failed to set key");
    }

    pub fn get(pubkey: &Pem) -> Vec<u8> {
        let hash = get_hash(pubkey).expect("ManagedKeys::get: Failed to hash public key");
        Keyvalue::get(&hash).expect("ManagedKeys::get: Key not found")
    }

    pub fn has(pubkey: &Pem) -> bool {
        let hash = get_hash(pubkey).expect("ManagedKeys::get: Failed to hash public key");
        Keyvalue::get(&hash).is_some()
    }

    pub fn _delete(pubkey: &Pem) {
        Keyvalue::delete(&get_hash(pubkey).expect("ManagedKeys::get: Failed to hash public key"));
    }
}
