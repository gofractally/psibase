#![allow(non_snake_case)]

use crate::{Hex, Pack, ToKey, ToSchema, Unpack};
use anyhow::anyhow;
use percent_encoding::percent_decode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;

/// An HTTP header
///
/// Note: `http-server` aborts when most services set HTTP headers. It only allows services
/// it trust to set them in order to enforce security rules.
#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, ToKey, ToSchema, Serialize, Deserialize,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
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
/// action. The `http-server` service receives it via its `serve` exported function.

#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, ToKey, ToSchema, Serialize, Deserialize,
)]
#[fracpack(fracpack_mod = "fracpack")]
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

    /// HTTP Headers
    pub headers: Vec<HttpHeader>,

    /// Request body, e.g. POST data
    pub body: Hex<Vec<u8>>,
}

impl HttpRequest {
    pub fn path<'a>(&'a self) -> Cow<'a, str> {
        let encoded = self
            .target
            .split_once('?')
            .map_or(self.target.as_str(), |s| s.0);
        return percent_decode(encoded.as_bytes()).decode_utf8_lossy();
    }
    pub fn query(&self) -> HashMap<String, String> {
        let encoded = self.target.split_once('?').map_or("", |s| s.1);
        return form_urlencoded::parse(encoded.as_bytes())
            .into_owned()
            .collect();
    }
}

pub struct HttpBody {
    pub contentType: String,
    pub body: Hex<Vec<u8>>,
}

impl HttpBody {
    pub fn json(data: &str) -> Self {
        HttpBody {
            contentType: "application/json".into(),
            body: data.to_string().into_bytes().into(),
        }
    }
    pub fn graphql(query: &str) -> Self {
        HttpBody {
            contentType: "application/graphql".into(),
            body: query.to_string().into_bytes().into(),
        }
    }
}

/// An HTTP reply
///
/// Services return this from their [serveSys](crate::server_interface::ServerActions::serveSys) action.
#[derive(
    Debug, Default, PartialEq, Eq, Clone, Pack, Unpack, ToSchema, ToKey, Serialize, Deserialize,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[to_key(psibase_mod = "crate")]
pub struct HttpReply {
    pub status: u16,

    /// "application/json", "text/html", ...
    pub contentType: String,

    /// Response body
    pub body: Hex<Vec<u8>>,

    /// HTTP Headers
    pub headers: Vec<HttpHeader>,
}

impl HttpReply {
    pub fn text(self) -> Result<String, anyhow::Error> {
        Ok(String::from_utf8(self.body.0)?)
    }
    pub fn json<T: DeserializeOwned>(self) -> Result<T, anyhow::Error> {
        if self.status != 200 {
            let status = self.status;
            if self.contentType == "text/html" {
                if let Ok(msg) = self.text() {
                    Err(anyhow!("Request returned {} {}", status, msg))?
                }
            }
            return Err(anyhow!("Request returned {}", status));
        }
        Ok(serde_json::de::from_str(&self.text()?)?)
    }
}
