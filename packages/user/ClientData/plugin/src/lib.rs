#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use host::common::{
    client::get_sender, store as KvStore, store::Database, store::DbMode, store::StorageDuration,
};

struct ClientData;

impl KeyValue for ClientData {
    fn get(key: String) -> Option<Vec<u8>> {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        let record = bucket.get(&key);

        if let Some(value) = record {
            return Some(value);
        }
        None
    }

    fn set(key: String, value: Vec<u8>) {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        // Set the value on the key
        bucket.set(&key, &value)
    }

    fn delete(key: String) {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        bucket.delete(&key);
    }
}

bindings::export!(ClientData with_types_in bindings);
