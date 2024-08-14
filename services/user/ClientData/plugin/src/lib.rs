#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;

use bindings::exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use bindings::host::common::client as Client;
use bindings::host::common::types as CommonTypes;
use bindings::wasi::keyvalue as Kv;

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

        // Check that it exists before getting it, because get on a non-existent record
        // will create an empty record. That's not what we want.
        let exists = bucket
            .exists(&key)
            .expect("Error determining key existence");
        if !exists {
            return None;
        }

        // It exists, so get it
        let record = bucket.get(&key).expect("Failed to get record value");
        let value = record.unwrap();

        // An empty record is considered corrupt.
        // Auto-delete the record if this is detected, and treat this call as though an
        //   nonexistent key was accessed.
        if value.len() == 0 {
            bucket
                .delete(&key)
                .expect("Failed to recover from corruption");

            return None;
        }

        // Return the pre-existing nonempty record value
        Some(value)
    }

    fn set(key: String, value: Vec<u8>) -> Result<(), CommonTypes::Error> {
        // Don't set empty records
        if value.len() == 0 {
            return Err(EmptyValue.err(&key));
        }

        let bucket =
            Kv::store::open(&get_sender()).expect("Failed to open table in keyvalue store");

        // Set the value on the key
        bucket
            .set(&key, &value)
            .map_err(|e| format!("Error setting value on key: {}", e.to_string()))
            .unwrap_or_else(|e| panic!("{}", e));

        Ok(())
    }

    fn delete(key: String) {
        let bucket =
            Kv::store::open(&get_sender()).expect("Failed to open table in keyvalue store");

        bucket.delete(&key).expect("Error deleting key");
    }
}

bindings::export!(ClientData with_types_in bindings);
