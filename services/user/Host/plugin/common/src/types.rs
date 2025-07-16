use crate::bindings::supervisor::bridge::types::{self as BridgeTypes, HttpRequest, HttpResponse};
use crate::exports::host::common::{
    client::Guest as Client,
    store::GuestBucket,
    types::{BodyTypes, Error, PluginId},
};
use crate::supervisor::bridge::intf as Supervisor;
use crate::HostCommon;

use crate::make_error;
use base64::{engine::general_purpose::STANDARD as b64, Engine};

impl From<BridgeTypes::PluginId> for PluginId {
    fn from(e: BridgeTypes::PluginId) -> Self {
        PluginId {
            service: e.service,
            plugin: e.plugin,
        }
    }
}

impl From<BridgeTypes::Error> for Error {
    fn from(e: BridgeTypes::Error) -> Self {
        Error {
            code: e.code,
            producer: e.producer.into(),
            message: e.message,
        }
    }
}

impl From<BridgeTypes::BodyTypes> for BodyTypes {
    fn from(e: BridgeTypes::BodyTypes) -> Self {
        match e {
            BridgeTypes::BodyTypes::Text(t) => BodyTypes::Text(t),
            BridgeTypes::BodyTypes::Bytes(b) => BodyTypes::Bytes(b),
            BridgeTypes::BodyTypes::Json(j) => BodyTypes::Json(j),
        }
    }
}

impl From<BodyTypes> for BridgeTypes::BodyTypes {
    fn from(e: BodyTypes) -> Self {
        match e {
            BodyTypes::Text(t) => BridgeTypes::BodyTypes::Text(t),
            BodyTypes::Bytes(b) => BridgeTypes::BodyTypes::Bytes(b),
            BodyTypes::Json(j) => BridgeTypes::BodyTypes::Json(j),
        }
    }
}

impl BodyTypes {
    pub fn get_content(&self) -> (String, BridgeTypes::BodyTypes) {
        match self {
            BodyTypes::Bytes(_) => ("application/octet-stream".to_string(), self.clone().into()),
            BodyTypes::Json(_) => ("application/json".to_string(), self.clone().into()),
            BodyTypes::Text(_) => ("text/plain".to_string(), self.clone().into()),
        }
    }
}

impl HttpRequest {
    pub fn send(&self) -> Result<HttpResponse, Error> {
        Ok(Supervisor::send_request(self).map_err(|e| Error::from(e))?)
    }
}

pub struct Bucket {
    bucket_id: String,
}

impl Bucket {
    pub fn new(identifier: String) -> Self {
        let service_account = HostCommon::get_sender_app().app.unwrap();
        let bucket_id = format!("{}:{}", service_account, identifier);
        Self { bucket_id }
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

        match local_storage_get(&self.get_key(&key)) {
            Some(item) => {
                let bytes = b64
                    .decode(&item)
                    .map_err(|_| make_error("invalid base64"))?;
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    fn set(&self, key: String, value: Vec<u8>) -> Result<(), Error> {
        self.validate_key_size(&key)?;
        self.validate_value_size(&value)?;

        let base64_value = b64.encode(&value);

        local_storage_set(&self.get_key(&key), &base64_value)?;
        Ok(())
    }

    fn delete(&self, key: String) -> Result<(), Error> {
        self.validate_key_size(&key)?;

        local_storage_remove(&self.get_key(&key))?;
        Ok(())
    }

    fn exists(&self, key: String) -> Result<bool, Error> {
        match self.validate_key_size(&key) {
            Ok(_) => Ok(local_storage_get(&self.get_key(&key)).is_some()),
            Err(_) => Ok(false),
        }
    }
}

// Stub functions - to be implemented later
fn local_storage_get(_key: &str) -> Option<String> {
    todo!()
}

fn local_storage_set(_key: &str, _value: &str) -> Result<(), Error> {
    todo!()
}

fn local_storage_remove(_key: &str) -> Result<(), Error> {
    todo!()
}
