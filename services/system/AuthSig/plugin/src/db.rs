use crate::bindings::auth_sig::plugin::types::Pem;
use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::types as CommonTypes;
use crate::types::*;

fn get_hash(key: &Pem) -> String {
    let pem = pem::Pem::try_from_pem_str(&key).expect("Failed to hash key");
    let digest = seahash::hash(&pem.contents().to_vec());
    format!("{:x}", digest)
}

pub struct ManagedKeys;

impl ManagedKeys {
    pub fn add(pubkey: &Pem, privkey: &[u8]) {
        Keyvalue::set(&get_hash(pubkey), &privkey).expect("ManagedKeys::set: Failed to add key");
    }

    pub fn get(pubkey: &Pem) -> Vec<u8> {
        Keyvalue::get(&get_hash(pubkey)).expect("ManagedKeys::get: Key not found")
    }

    pub fn has(pubkey: &Pem) -> bool {
        Keyvalue::get(&get_hash(pubkey)).is_some()
    }

    pub fn _delete(pubkey: &Pem) {
        Keyvalue::delete(&get_hash(pubkey));
    }
}
