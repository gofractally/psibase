// use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
// use crate::bindings::exports::host::crypto::types::Pem;
// use crate::types::*;

// fn get_hash(key: &Pem) -> String {
//     let pem = pem::Pem::try_from_pem_str(&key).expect("Failed to hash key");
//     let digest = seahash::hash(&pem.contents().to_vec());
//     format!("{:x}", digest)
// }

// pub struct ManagedKeys;

// impl ManagedKeys {
//     pub fn add(pubkey: &Pem, privkey: &[u8]) {
//         Keyvalue::set(&get_hash(pubkey), &privkey);
//     }

//     pub fn get(pubkey: &Pem) -> Vec<u8> {
//         Keyvalue::get(&get_hash(pubkey)).expect("ManagedKeys::get: Key not found")
//     }

//     pub fn has(pubkey: &Pem) -> bool {
//         Keyvalue::get(&get_hash(pubkey)).is_some()
//     }

//     pub fn _delete(pubkey: &Pem) {
//         Keyvalue::delete(&get_hash(pubkey));
//     }
// }
