use crate::bindings::supervisor::bridge::types::{self as BridgeTypes, HttpRequest, HttpResponse};
use crate::exports::host::common::types::{BodyTypes, Error, PluginId};
use crate::supervisor::bridge::intf as Supervisor;

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
