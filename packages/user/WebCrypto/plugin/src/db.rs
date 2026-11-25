use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use crate::keys::KeyStore;

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

pub struct ManagedKeys;

impl KeyStore for ManagedKeys {
    fn put(&self, id: &str, private_key: &[u8]) {
        keys_table().set(id, private_key);
    }

    fn fetch(&self, id: &str) -> Option<Vec<u8>> {
        keys_table().get(id)
    }
}

pub struct TempKeys;

impl KeyStore for TempKeys {
    fn put(&self, id: &str, private_key: &[u8]) {
        temp_keys_table().set(id, private_key);
    }

    fn fetch(&self, id: &str) -> Option<Vec<u8>> {
        temp_keys_table().get(id)
    }
}
