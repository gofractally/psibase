use crate::exports::host::common::{
    client::Guest as Client,
    store::{Database, DbMode, GuestBucket, StorageDuration},
    types::Error,
};
use crate::make_error;
use crate::supervisor::bridge::database as HostDb;
use crate::supervisor::bridge::intf::get_chain_id;
use crate::HostCommon;
use regex::Regex;

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
            return Err(make_error("key must be less than 256 bytes"));
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
        let valid_identifier_regex = Regex::new(r"^[0-9a-zA-Z-]+$").unwrap();
        if !valid_identifier_regex.is_match(&identifier) {
            return Err(make_error(
                "Invalid bucket identifier: Identifier must conform to /^[0-9a-zA-Z-]+$/",
            )
            .into());
        }
        Ok(())
    }

    // +---------------------+---------------------+---------------------+
    // |                     |  NonTransactional   |    Transactional*   |
    // +---------------------+---------------------+---------------------+
    // | Ephemeral*          |      Valid          |      Not valid      |
    // +---------------------+---------------------+---------------------+
    // | Session*            |      Valid          |        Valid        |
    // +---------------------+---------------------+---------------------+
    // | Persistent          |      Valid          |        Valid        |
    // +---------------------+---------------------+---------------------+
    //
    // * Not yet supported
    //
    fn validate_db(db: &Database) -> Result<(), Error> {
        if db.mode == DbMode::Transactional {
            return Err(make_error("Transactional database not yet supported"));
        }
        if db.duration == StorageDuration::Ephemeral {
            return Err(make_error("Transient database not yet supported"));
        }
        if db.duration == StorageDuration::Session {
            return Err(make_error("Session database not yet supported"));
        }
        if db.duration == StorageDuration::Ephemeral {
            if db.mode == DbMode::Transactional {
                return Err(make_error(
                    "Ephemeral database not supported in transactional mode",
                ));
            }
        }
        Ok(())
    }
}

impl GuestBucket for Bucket {
    fn new(db: Database, identifier: String) -> Self {
        Self::validate_db(&db).unwrap();
        Self::validate_identifier(&identifier).unwrap();
        let service_account = HostCommon::get_sender_app().app.unwrap();
        let chain_id = get_chain_id();
        let bucket_id = format!("{}:{}:{}", chain_id, service_account, identifier);
        Self { bucket_id, db }
    }

    fn get(&self, key: String) -> Result<Option<Vec<u8>>, Error> {
        self.validate_key_size(&key)?;

        match HostDb::get(
            self.db.mode as u8,
            self.db.duration as u8,
            &self.get_key(&key),
        ) {
            Some(data) => Ok(Some(data)),
            None => Ok(None),
        }
    }

    fn set(&self, key: String, value: Vec<u8>) -> Result<(), Error> {
        self.validate_key_size(&key)?;
        self.validate_value_size(&value)?;

        HostDb::set(
            self.db.mode as u8,
            self.db.duration as u8,
            &self.get_key(&key),
            &value,
        );
        Ok(())
    }

    fn delete(&self, key: String) -> Result<(), Error> {
        self.validate_key_size(&key)?;

        HostDb::remove(
            self.db.mode as u8,
            self.db.duration as u8,
            &self.get_key(&key),
        );
        Ok(())
    }

    fn exists(&self, key: String) -> Result<bool, Error> {
        match self.validate_key_size(&key) {
            Ok(_) => Ok(HostDb::get(
                self.db.mode as u8,
                self.db.duration as u8,
                &self.get_key(&key),
            )
            .is_some()),
            Err(_) => Ok(false),
        }
    }
}
