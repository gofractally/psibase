#![allow(non_snake_case)]

use crate::Fracpack;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, PartialEq, Eq, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Default, PartialEq, Eq, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct HttpRequest {
    pub host: String,
    pub rootHost: String,
    pub method: String,
    pub target: String,
    pub contentType: String,
    pub body: Vec<u8>,
}

#[derive(Debug, Default, PartialEq, Eq, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct HttpReply {
    pub contentType: String,
    pub body: Vec<u8>,
    pub headers: Vec<HttpHeader>,
}
