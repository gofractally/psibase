#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use exports::clientdata::plugin::tests::Guest as Tests;
use host::common::{
    client as Client, store as KvStore, store::Database, store::DbMode, store::StorageDuration,
    types::Error,
};

mod tests;
use tests::*;

struct ClientData;

fn get_sender() -> String {
    Client::get_sender_app()
        .app
        .expect("ClientData interface can only be used from plugins.")
}

impl KeyValue for ClientData {
    fn get(key: String) -> Option<Vec<u8>> {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket =
            KvStore::open(db, &get_sender()).expect("Failed to open table in keyvalue store");

        let record = bucket.get(&key).expect("Failed to get record value");

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
        let bucket =
            KvStore::open(db, &get_sender()).expect("Failed to open table in keyvalue store");

        // Set the value on the key
        bucket
            .set(&key, &value)
            .map_err(|e| format!("Error setting value on key {}: {}", key, e.to_string()))
            .unwrap_or_else(|e| panic!("{}", e));
    }

    fn delete(key: String) {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket =
            KvStore::open(db, &get_sender()).expect("Failed to open table in keyvalue store");

        bucket.delete(&key).expect("Error deleting key");
    }
}

impl Tests for ClientData {
    fn kv_test() -> Result<(), Error> {
        let bucket = test_open()?;

        test_set(&bucket)?;
        test_get(&bucket)?;
        test_exists(&bucket)?;
        test_delete(&bucket)?;

        Ok(())
    }
}

bindings::export!(ClientData with_types_in bindings);
