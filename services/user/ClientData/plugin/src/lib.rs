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
    let sender = sender_app.app;
    if sender.is_none() {
        return Err(InvalidSender.err(&sender_app.origin));
    }
    Ok(sender.unwrap())
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

        // An empty record is considered corrupt.
        // Auto-delete the record if this is detected, and treat this call as though an
        //   nonexistent key was accessed.
        if record.is_none() {
            bucket
                .delete(&key)
                .map_err(|_| KvError.err("Failed to recover from corruption"))?;

            return Ok(None);
        }

        // Return the pre-existing nonempty record value
        Ok(Some(record.unwrap()))
    }

    fn set(key: String, value: Vec<u8>) -> Result<(), CommonTypes::Error> {
        let bucket = Kv::store::open(&get_sender()?)
            .map_err(|_| KvError.err("Failed to open table in keyvalue store"))?;

        // If passed an empty value
        if value.len() == 0 {
            let exists = bucket
                .exists(&key)
                .map_err(|_| KvError.err("Error determining key existence"))?;
            if !exists {
                // Don't add a new empty record. Return an error.
                return Err(EmptyValue.err(&key));
            } else {
                // If the record already exists, treat this call as a delete
                bucket
                    .delete(&key)
                    .map_err(|_| KvError.err("Error deleting key"))?;
            }
        }

        // Set the non-empty value on the key
        bucket
            .set(&key, &value)
            .map_err(|_| KvError.err("Error setting value on key"))?;

        Ok(())
    }

    fn delete(key: String) -> Result<(), CommonTypes::Error> {
        let bucket = Kv::store::open(&get_sender()?)
            .map_err(|_| KvError.err("Failed to open table in keyvalue store"))?;

        // If the record already dne, do nothing
        let exists = bucket
            .exists(&key)
            .map_err(|_| KvError.err("Error determining key existence"))?;
        if !exists {
            return Ok(());
        }

        bucket
            .delete(&key)
            .map_err(|_| KvError.err("Error deleting key"))?;

        Ok(())
    }
}

bindings::export!(ClientData with_types_in bindings);
