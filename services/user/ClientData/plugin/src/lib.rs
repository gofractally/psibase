#[allow(warnings)]
mod bindings;

use bindings::exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use bindings::host::common::client as Client;
use bindings::wasi::keyvalue as Kv;

use bindings::exports::clientdata::plugin::tests::Guest as Tests;

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
        let bucket =
            Kv::store::open(&get_sender()).expect("Failed to open table in keyvalue store");

        let record = bucket.get(&key).expect("Failed to get record value");

        if let Some(value) = record {
            // An empty record is considered corrupt.
            // Auto-delete the record if this is detected, and treat this call as though an
            //   nonexistent key was accessed.
            if value.len() == 0 {
                bucket
                    .delete(&key)
                    .expect("Failed to recover from corruption");
                return None;
            }
            return Some(value);
        }
        None
    }

    fn set(key: String, value: Vec<u8>) {
        let bucket =
            Kv::store::open(&get_sender()).expect("Failed to open table in keyvalue store");

        // Set the value on the key
        bucket
            .set(&key, &value)
            .map_err(|e| format!("Error setting value on key {}: {}", key, e.to_string()))
            .unwrap_or_else(|e| panic!("{}", e));
    }

    fn delete(key: String) {
        let bucket =
            Kv::store::open(&get_sender()).expect("Failed to open table in keyvalue store");

        bucket.delete(&key).expect("Error deleting key");
    }
}

impl Tests for ClientData {
    fn kv_test() -> Result<(), Kv::store::Error> {
        let bucket = test_open()?;

        test_set(&bucket)?;
        test_get(&bucket)?;
        test_exists(&bucket)?;
        test_delete(&bucket)?;

        test_set_many(&bucket)?;
        test_get_many(&bucket)?;
        //test_list_keys(&bucket)?;
        test_delete_many(&bucket)?;

        test_increment(&bucket)?;

        //test_pagination(&bucket)?;

        Ok(())
    }
}

bindings::export!(ClientData with_types_in bindings);
