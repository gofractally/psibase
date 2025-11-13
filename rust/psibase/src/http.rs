#![allow(non_snake_case)]

use crate::{AccountNumber, Hex, Pack, ToKey, ToSchema, Unpack};
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

impl HttpHeader {
    pub fn new(name: &str, value: &str) -> Self {
        HttpHeader {
            name: name.to_string(),
            value: value.to_string(),
        }
    }
    pub fn matches(&self, name: &str) -> bool {
        self.name.eq_ignore_ascii_case(name)
    }
}

/// HTTP Status codes
#[derive(Debug, PartialEq, Eq, Clone, Copy, Serialize, Deserialize)]
#[repr(u16)]
pub enum HttpStatus {
    Ok = 200,
    MovedPermanently = 301,
    Found = 302,
    NotModified = 304,
    Unauthorized = 401,
    Forbidden = 403,
    NotFound = 404,
    MethodNotAllowed = 405,
    NotAcceptable = 406,
    UnsupportedMediaType = 415,
    InternalServerError = 500,
    ServiceUnavailable = 503,
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
    pub fn get_header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|h| h.matches(name))
            .map(|h| h.value.as_str())
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

struct Origin {
    scheme: String,
    host: String,
}

impl Origin {
    fn new(url: &str) -> Self {
        let mut scheme = String::new();
        let mut host = String::new();
        if let Some(pos) = url.find("://") {
            scheme = url[..pos].to_string();
            let after_scheme = &url[pos + 3..];
            if let Some(colon_pos) = after_scheme.rfind(':') {
                if !after_scheme[..colon_pos].contains(']') {
                    host = after_scheme[..colon_pos].to_string();
                } else {
                    host = after_scheme.to_string();
                }
            } else {
                host = after_scheme.to_string();
            }
        }
        Origin { scheme, host }
    }

    fn is_secure(&self) -> bool {
        self.scheme == "https" || self.host == "localhost" || self.host.ends_with(".localhost")
    }

    fn is_service(&self, root_host: &str, account: AccountNumber) -> bool {
        self.is_secure() && self.host == format!("{}.{}", account, root_host)
    }

    fn is_subdomain(&self, root_host: &str) -> bool {
        self.is_secure()
            && (self.host == root_host || self.host.ends_with(&format!(".{}", root_host)))
    }
}

pub fn root_host(req: &HttpRequest, host_is_subdomain: bool) -> &str {
    if host_is_subdomain {
        let pos = req.host.find('.').expect("Subdomain expected");
        &req.host[pos + 1..]
    } else {
        &req.host
    }
}

pub fn allow_cors_for_account(
    req: &HttpRequest,
    account: AccountNumber,
    host_is_subdomain: bool,
) -> Vec<HttpHeader> {
    if let Some(o) = req.get_header("origin") {
        let origin = Origin::new(o);
        if origin.is_service(root_host(req, host_is_subdomain), account) {
            return allow_cors_with_origin(o);
        }
    }
    Vec::new()
}

pub fn allow_cors_for_subdomains(req: &HttpRequest, host_is_subdomain: bool) -> Vec<HttpHeader> {
    if let Some(origin) = req.get_header("origin") {
        let origin_obj = Origin::new(origin);
        if origin_obj.is_subdomain(root_host(req, host_is_subdomain)) {
            return allow_cors_with_origin(origin);
        }
    }
    Vec::new()
}

pub fn allow_cors_with_origin(origin: &str) -> Vec<HttpHeader> {
    vec![
        HttpHeader::new("Access-Control-Allow-Origin", origin),
        HttpHeader::new("Access-Control-Allow-Methods", "POST, GET, OPTIONS, HEAD"),
        HttpHeader::new("Access-Control-Allow-Headers", "*"),
    ]
}
