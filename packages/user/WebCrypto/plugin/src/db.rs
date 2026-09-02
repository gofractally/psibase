use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use crate::bindings::host::types::types::Pem;
use crate::types::*;

fn keys_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "keys",
    )
}

fn temp_keys_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Ephemeral,
        },
        "temp_keys",
    )
}

fn get_hash(key: &Pem) -> String {
    let pem = pem::Pem::try_from_pem_str(&key).expect("Failed to hash key");
    let digest = seahash::hash(&pem.contents().to_vec());
    format!("{:x}", digest)
}

pub struct ManagedKeys;

impl ManagedKeys {
    pub fn add(pubkey: &Pem, privkey: &[u8]) {
        keys_table().set(&get_hash(pubkey), &privkey);
    }

    pub fn get(pubkey: &Pem) -> Option<Vec<u8>> {
        keys_table().get(&get_hash(pubkey))
    }
}

pub struct TempKeys;

impl TempKeys {
    pub fn add(pubkey: &Pem, privkey: &[u8]) {
        temp_keys_table().set(&get_hash(pubkey), &privkey);
    }

    pub fn get(pubkey: &Pem) -> Option<Vec<u8>> {
        temp_keys_table().get(&get_hash(pubkey))
    }
}
