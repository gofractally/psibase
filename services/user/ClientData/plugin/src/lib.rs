#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;

use bindings::exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use bindings::host::common::client as Client;
use bindings::host::common::types as CommonTypes;
use bindings::wasi::keyvalue as Kv;

struct ClientData;

fn get_sender() -> Result<String, CommonTypes::Error> {
    let sender_app = Client::get_sender_app();
    Ok(sender_app.app.ok_or_else(|| InvalidSender.err(&sender_app.origin))?)
}

impl KeyValue for ClientData {
    fn get(key: String) -> Result<Option<Vec<u8>>, CommonTypes::Error> {
        let bucket = Kv::store::open(&get_sender()?)
            .map_err(|_| KvError.err("Failed to open table in keyvalue store"))?;

        // Check that it exists before getting it, because get on a non-existent record
        // will create an empty record. That's not what we want.
        let exists = bucket
            .exists(&key)
            .map_err(|_| KvError.err("Error determining key existence"))?;
        if !exists {
            return Ok(None);
        }

        // It exists, so get it
        let record = bucket
            .get(&key)
            .map_err(|_| KvError.err("Failed to get record value"))?;
        let value = record.unwrap();

        // An empty record is considered corrupt.
        // Auto-delete the record if this is detected, and treat this call as though an
        //   nonexistent key was accessed.
        if value.len() == 0 {
            bucket
                .delete(&key)
                .map_err(|_| KvError.err("Failed to recover from corruption"))?;

            return Ok(None);
        }

        // Return the pre-existing nonempty record value
        Ok(Some(value))
    }

    fn set(key: String, value: Vec<u8>) -> Result<(), CommonTypes::Error> {
        // Don't set empty records
        if value.len() == 0 {
            return Err(EmptyValue.err(&key));
        }

        let bucket = Kv::store::open(&get_sender()?)
            .map_err(|_| KvError.err("Failed to open table in keyvalue store"))?;

        // Set the value on the key
        bucket
            .set(&key, &value)
            .map_err(|e| KvError.err(&format!("Error setting value on key: {}", e.to_string())))?;

        Ok(())
    }

    fn delete(key: String) -> Result<(), CommonTypes::Error> {
        let bucket = Kv::store::open(&get_sender()?)
            .map_err(|_| KvError.err("Failed to open table in keyvalue store"))?;

        bucket
            .delete(&key)
            .map_err(|_| KvError.err("Error deleting key"))?;

        Ok(())
    }
}

bindings::export!(ClientData with_types_in bindings);
