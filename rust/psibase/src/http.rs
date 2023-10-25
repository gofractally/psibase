#![allow(non_snake_case)]

use crate::{Hex, Pack, Reflect, ToKey, Unpack};
use serde::{Deserialize, Serialize};

/// An HTTP header
///
/// Note: `proxy-sys` aborts when most services set HTTP headers. It only allows services
/// it trust to set them in order to enforce security rules.
#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, Reflect, ToKey, Serialize, Deserialize,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct HttpHeader {
    /// Name of header, e.g. "Content-Security-Policy"
    pub name: String,

    /// Value of header
    pub value: String,
}

/// An HTTP Request
///
/// Most services receive this via their [serveSys](crate::server_interface::ServerActions::serveSys)
/// action. [proxy-sys](https://doc-sys.psibase.io/default-apps/proxy-sys.html) receives it via
/// its `serve` exported function.

#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, Reflect, ToKey, Serialize, Deserialize,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct HttpRequest {
    /// Fully-qualified domain name
    pub host: String,

    /// host name, but without service subdomain
    pub rootHost: String,

    /// "GET" or "POST"
    pub method: String,

    /// Absolute path, e.g. "/index.js"
    pub target: String,

    /// "application/json", "text/html", ...
    pub contentType: String,

    /// Request body, e.g. POST data
    pub body: Hex<Vec<u8>>,
}

/// An HTTP reply
///
/// Services return this from their [serveSys](crate::server_interface::ServerActions::serveSys) action.
#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, Reflect, ToKey, Serialize, Deserialize,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct HttpReply {
    /// "application/json", "text/html", ...
    pub contentType: String,

    /// Response body
    pub body: Hex<Vec<u8>>,

    /// HTTP Headers
    pub headers: Vec<HttpHeader>,
}
