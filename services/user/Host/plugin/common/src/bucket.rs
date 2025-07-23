use crate::exports::host::common::{
    store::{Database, DbMode, GuestBucket, StorageDuration},
    types::Error,
};
use crate::make_error;
use crate::supervisor::bridge::database as HostDb;
use crate::supervisor::bridge::intf::get_chain_id;
use regex::Regex;
use std::cell::RefCell;
use std::collections::HashMap;

pub mod host_buffer {
    use super::*;

    #[derive(Debug, Clone)]
    pub struct Op(pub Option<Vec<u8>>); // None for Delete, Some for Set

    fn get_buffer_key(db: &Database) -> String {
        format!("{:?}:{:?}", db.duration, db.mode)
    }

    thread_local! {
        static WRITE_BUFFERS: RefCell<HashMap<String, HashMap<String, Op>>> =
            RefCell::new(HashMap::new());
    }

    pub fn get(db: &Database, key: &str) -> Option<Vec<u8>> {
        let buffer_key = get_buffer_key(db);

        WRITE_BUFFERS.with(|buffers| {
            buffers
                .borrow()
                .get(&buffer_key)
                .and_then(|buffer| buffer.get(key))
                .and_then(|entry| entry.0.clone())
        })
    }

    pub fn exists(db: &Database, key: &str) -> bool {
        let buffer_key = get_buffer_key(db);

        WRITE_BUFFERS.with(|buffers| {
            buffers
                .borrow()
                .get(&buffer_key)
                .map_or(false, |buffer| buffer.contains_key(key))
        })
    }

    pub fn set(db: &Database, key: &str, value: &[u8]) {
        let buffer_key = get_buffer_key(db);

        WRITE_BUFFERS.with(|buffers| {
            let mut buffers_ref = buffers.borrow_mut();
            let buffer = buffers_ref.entry(buffer_key).or_insert_with(HashMap::new);

            buffer.insert(key.to_string(), Op(Some(value.to_vec())));
        });
    }

    pub fn remove(db: &Database, key: &str) {
        let buffer_key = get_buffer_key(db);

        WRITE_BUFFERS.with(|buffers| {
            let mut buffers_ref = buffers.borrow_mut();
            let buffer = buffers_ref.entry(buffer_key).or_insert_with(HashMap::new);

            buffer.insert(key.to_string(), Op(None));
        });
    }

    pub fn drain_all(mode: DbMode) -> Vec<(Database, HashMap<String, Op>)> {
        let mut results = Vec::new();

        for duration in [StorageDuration::Session, StorageDuration::Persistent] {
            let db = Database { duration, mode };

            let entries = WRITE_BUFFERS.with(|buffers| {
                let mut buffers_ref = buffers.borrow_mut();
                if let Some(buffer) = buffers_ref.get_mut(&get_buffer_key(&db)) {
                    buffer.drain().collect()
                } else {
                    HashMap::new()
                }
            });

            if !entries.is_empty() {
                results.push((db, entries));
            }
        }

        results
    }

    pub fn clear_all() {
        WRITE_BUFFERS.with(|buffers| {
            buffers.borrow_mut().clear();
        });
    }
}

// +---------------------+---------------------+---------------------+
// |                     |  NonTransactional   |    Transactional    |
// +---------------------+---------------------+---------------------+
// | Ephemeral           |      N/A            |        N/A          |
// +---------------------+---------------------+---------------------+
// | Session             |      Valid          |        Valid        |
// +---------------------+---------------------+---------------------+
// | Persistent          |      Valid          |        Valid        |
// +---------------------+---------------------+---------------------+
//
// The ephemeral database never is written to the host.
// The Non-transactional database is never written to the buffer, always directly to the host.
// The Transactional database is written to the buffer, flushed to host when instructed by `transact`

pub struct Bucket {
    bucket_id: String,
    db: Database,
}

impl Bucket {
    fn get_key(&self, key: &str) -> String {
        format!("{}:{}", self.bucket_id, key)
    }

    fn validate_key_size(&self, key: &str) -> Result<(), Error> {
        if key.len() >= 256 {
            return Err(make_error("key must be <= 256 bytes"));
        }
        Ok(())
    }

    fn validate_value_size(&self, value: &[u8]) -> Result<(), Error> {
        // 100kb
        const MAX_SIZE: usize = 100 * 1024;
        if value.len() >= MAX_SIZE {
            return Err(make_error("value must be less than 100KB"));
        }
        Ok(())
    }

    fn validate_identifier(identifier: &str) -> Result<(), Error> {
        // Validate identifier with regex /^[0-9a-zA-Z-]+$/
        let valid_identifier_regex = Regex::new(r"^[0-9a-zA-Z_-]+$").unwrap();
        if !valid_identifier_regex.is_match(&identifier) {
            return Err(make_error(
                "Invalid bucket identifier: Identifier must conform to /^[0-9a-zA-Z_-]+$/",
            )
            .into());
        }
        Ok(())
    }
}

impl GuestBucket for Bucket {
    fn new(db: Database, identifier: String) -> Self {
        Self::validate_identifier(&identifier).unwrap();
        let service_account = crate::caller();
        let mode = match db.mode {
            DbMode::NonTransactional => "non-trx",
            DbMode::Transactional => "trx",
        };
        let chain_id = get_chain_id();
        let bucket_id = format!("{}:{}:{}:{}", chain_id, mode, service_account, identifier);
        Self { bucket_id, db }
    }

    fn get(&self, key: String) -> Result<Option<Vec<u8>>, Error> {
        self.validate_key_size(&key)?;
        let prefixed_key = self.get_key(&key);

        match (self.db.duration, self.db.mode) {
            (StorageDuration::Ephemeral, _) => Ok(host_buffer::get(&self.db, &prefixed_key)),
            (_, DbMode::NonTransactional) => Ok(HostDb::get(self.db.duration as u8, &prefixed_key)),
            (_, DbMode::Transactional) => {
                if host_buffer::exists(&self.db, &prefixed_key) {
                    Ok(host_buffer::get(&self.db, &prefixed_key))
                } else {
                    Ok(HostDb::get(self.db.duration as u8, &prefixed_key))
                }
            }
        }
    }

    fn set(&self, key: String, value: Vec<u8>) -> Result<(), Error> {
        self.validate_key_size(&key)?;
        self.validate_value_size(&value)?;

        match (self.db.duration, self.db.mode) {
            (StorageDuration::Ephemeral, _) => {
                host_buffer::set(&self.db, &self.get_key(&key), &value);
            }
            (_, DbMode::NonTransactional) => {
                HostDb::set(self.db.duration as u8, &self.get_key(&key), &value);
            }
            (_, DbMode::Transactional) => {
                host_buffer::set(&self.db, &self.get_key(&key), &value);
            }
        }
        Ok(())
    }

    fn delete(&self, key: String) -> Result<(), Error> {
        self.validate_key_size(&key)?;

        match (self.db.duration, self.db.mode) {
            (StorageDuration::Ephemeral, _) => {
                host_buffer::remove(&self.db, &self.get_key(&key));
            }
            (_, DbMode::NonTransactional) => {
                HostDb::remove(self.db.duration as u8, &self.get_key(&key));
            }
            (_, DbMode::Transactional) => {
                host_buffer::remove(&self.db, &self.get_key(&key));
            }
        }
        Ok(())
    }

    fn exists(&self, key: String) -> Result<bool, Error> {
        self.validate_key_size(&key)?;
        let prefixed_key = self.get_key(&key);

        match (self.db.duration, self.db.mode) {
            (StorageDuration::Ephemeral, _) => {
                // Doesn't matter if the key dne, or if it does but is a delete OP
                Ok(host_buffer::get(&self.db, &prefixed_key).is_some())
            }
            (_, DbMode::NonTransactional) => {
                Ok(HostDb::get(self.db.duration as u8, &prefixed_key).is_some())
            }
            (_, DbMode::Transactional) => {
                if host_buffer::exists(&self.db, &prefixed_key) {
                    match host_buffer::get(&self.db, &prefixed_key) {
                        Some(_) => Ok(true),
                        None => Ok(false), // Key was deleted
                    }
                } else {
                    Ok(HostDb::get(self.db.duration as u8, &prefixed_key).is_some())
                }
            }
        }
    }
}
