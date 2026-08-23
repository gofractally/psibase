use crate::bindings::host::types::types::{BodyTypes, Error};
use crate::bindings::supervisor::bridge::types::{self as BridgeTypes, HttpRequest, HttpResponse};
use crate::supervisor::bridge::intf as Supervisor;

// BridgeTypes::Error / PluginId are now `use`d from host:types (so wac can
// merge supervisor:bridge/intf across host plugins) — no conversion needed.

impl From<BridgeTypes::BodyTypes> for BodyTypes {
    fn from(e: BridgeTypes::BodyTypes) -> Self {
        match e {
            BridgeTypes::BodyTypes::Text(t) => BodyTypes::Text(t),
            BridgeTypes::BodyTypes::Bytes(b) => BodyTypes::Bytes(b),
            BridgeTypes::BodyTypes::Json(j) => BodyTypes::Json(j),
            BridgeTypes::BodyTypes::Graphql(g) => BodyTypes::Graphql(g),
        }
    }
}

impl From<BodyTypes> for BridgeTypes::BodyTypes {
    fn from(e: BodyTypes) -> Self {
        match e {
            BodyTypes::Text(t) => BridgeTypes::BodyTypes::Text(t),
            BodyTypes::Bytes(b) => BridgeTypes::BodyTypes::Bytes(b),
            BodyTypes::Json(j) => BridgeTypes::BodyTypes::Json(j),
            BodyTypes::Graphql(g) => BridgeTypes::BodyTypes::Graphql(g),
        }
    }
}

impl BodyTypes {
    pub fn get_content(&self) -> (String, BridgeTypes::BodyTypes) {
        match self {
            BodyTypes::Bytes(_) => ("application/octet-stream".to_string(), self.clone().into()),
            BodyTypes::Json(_) => ("application/json".to_string(), self.clone().into()),
            BodyTypes::Text(_) => ("text/plain".to_string(), self.clone().into()),
            BodyTypes::Graphql(_) => ("application/graphql".to_string(), self.clone().into()),
        }
    }
}

impl HttpRequest {
    pub fn send(&self) -> Result<HttpResponse, Error> {
        Ok(Supervisor::send_request(self, false).map_err(Error::from)?)
    }
}
