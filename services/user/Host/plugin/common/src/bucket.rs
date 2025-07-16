use crate::exports::host::common::{
    client::Guest as Client,
    store::{Database, GuestBucket},
    types::Error,
};
use crate::make_error;
use crate::supervisor::bridge::database as HostDb;
use crate::HostCommon;

pub struct Bucket {
    bucket_id: String,
    db: Database,
}

impl Bucket {
    pub fn new(db: Database, identifier: String) -> Self {
        let service_account = HostCommon::get_sender_app().app.unwrap();
        let bucket_id = format!("{}:{}", service_account, identifier);
        Self { bucket_id, db }
    }

    fn get_key(&self, key: &str) -> String {
        format!("{}:{}", self.bucket_id, key)
    }

    fn validate_key_size(&self, key: &str) -> Result<(), Error> {
        // ~80 bytes per key, so `listKeys` pagesize limit of 1000 yield an ~80kb payload
        if key.len() >= 80 {
            return Err(make_error("key must be less than 80 characters"));
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
}

impl GuestBucket for Bucket {
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
