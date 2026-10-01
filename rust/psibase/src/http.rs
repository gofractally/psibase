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

    /// Every `Cookie` header value, in header order, split on `;`.
    ///
    /// Segments without `=` yield [`CookiePart::Malformed`]. Empty segments
    /// (including from `;;`) are skipped. Names and values are trimmed; values
    /// are not URL-decoded.
    pub fn cookies(&self) -> impl Iterator<Item = CookiePart<'_>> + '_ {
        self.headers
            .iter()
            .filter(|h| h.matches("cookie"))
            .flat_map(|h| h.value.split(';').filter_map(parse_cookie_segment))
    }
}

/// One name/value pair from a `Cookie` header, or a malformed segment.
#[derive(Debug, PartialEq, Eq)]
pub enum CookiePart<'a> {
    Pair { name: &'a str, value: &'a str },
    Malformed,
}

fn parse_cookie_segment(segment: &str) -> Option<CookiePart<'_>> {
    let segment = segment.trim();
    if segment.is_empty() {
        return None;
    }
    let Some((name, value)) = segment.split_once('=') else {
        return Some(CookiePart::Malformed);
    };
    Some(CookiePart::Pair {
        name: name.trim(),
        value: value.trim(),
    })
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

struct Origin<'a> {
    scheme: &'a str,
    host: &'a str,
}

impl<'a> Origin<'a> {
    fn new(url: &'a str) -> Self {
        let mut scheme = "";
        let mut host = "";
        if let Some(pos) = url.find("://") {
            scheme = &url[..pos];
            let after_scheme = &url[pos + 3..];
            host = if let Some(colon_pos) = after_scheme.rfind(':') {
                if !after_scheme[..colon_pos].contains(']') {
                    &after_scheme[..colon_pos]
                } else {
                    after_scheme
                }
            } else {
                after_scheme
            };
        }
        Origin { scheme, host }
    }

    fn is_secure(&self) -> bool {
        self.scheme == "https" || self.host == "localhost" || self.host.ends_with(".localhost")
    }

    fn is_service(&self, root_host: &str, account: AccountNumber) -> bool {
        if !self.is_secure() {
            return false;
        }
        let Some((prefix, suffix)) = self.host.split_once('.') else {
            return false;
        };
        suffix == root_host && prefix.parse::<AccountNumber>().ok() == Some(account)
    }

    fn is_subdomain(&self, root_host: &str) -> bool {
        if !self.is_secure() {
            return false;
        }
        self.host == root_host
            || self
                .host
                .strip_suffix(root_host)
                .is_some_and(|prefix| prefix.ends_with('.'))
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

pub fn service_origin_str<'a>(
    origin: &'a str,
    account: AccountNumber,
    root_host: &str,
) -> Option<&'a str> {
    Origin::new(origin)
        .is_service(root_host, account)
        .then_some(origin)
}

pub fn subdomain_origin_str<'a>(origin: &'a str, root_host: &str) -> Option<&'a str> {
    Origin::new(origin)
        .is_subdomain(root_host)
        .then_some(origin)
}

pub fn service_origin<'a>(
    req: &'a HttpRequest,
    account: AccountNumber,
    root_host: &str,
) -> Option<&'a str> {
    req.get_header("origin")
        .and_then(|origin| service_origin_str(origin, account, root_host))
}

pub fn subdomain_origin<'a>(req: &'a HttpRequest, root_host: &str) -> Option<&'a str> {
    req.get_header("origin")
        .and_then(|origin| subdomain_origin_str(origin, root_host))
}

pub fn allow_cors_for_account(
    req: &HttpRequest,
    account: AccountNumber,
    host_is_subdomain: bool,
) -> Vec<HttpHeader> {
    service_origin(req, account, root_host(req, host_is_subdomain))
        .map(allow_cors_with_origin)
        .unwrap_or_default()
}

pub fn allow_cors_for_subdomains(req: &HttpRequest, host_is_subdomain: bool) -> Vec<HttpHeader> {
    subdomain_origin(req, root_host(req, host_is_subdomain))
        .map(allow_cors_with_origin)
        .unwrap_or_default()
}

pub fn allow_cors_with_origin(origin: &str) -> Vec<HttpHeader> {
    vec![
        HttpHeader::new("Access-Control-Allow-Origin", origin),
        HttpHeader::new("Access-Control-Allow-Methods", "POST, GET, OPTIONS, HEAD"),
        HttpHeader::new("Access-Control-Allow-Headers", "*"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie_parts(request: &HttpRequest) -> Vec<CookiePart<'_>> {
        request.cookies().collect()
    }

    #[test]
    fn cookies_single_header() {
        let request = HttpRequest {
            headers: vec![HttpHeader::new(
                "Cookie",
                "foo=10; bar=27; session=xxx",
            )],
            ..Default::default()
        };
        assert_eq!(
            cookie_parts(&request),
            vec![
                CookiePart::Pair {
                    name: "foo",
                    value: "10"
                },
                CookiePart::Pair {
                    name: "bar",
                    value: "27"
                },
                CookiePart::Pair {
                    name: "session",
                    value: "xxx"
                },
            ]
        );
    }

    #[test]
    fn cookies_multiple_headers() {
        let request = HttpRequest {
            headers: vec![
                HttpHeader::new("CooKiE", "foo=10; bar=27"),
                HttpHeader::new("cookie", "bar=7"),
                HttpHeader::new("cookie", "bar=17; extra=9"),
            ],
            ..Default::default()
        };
        assert_eq!(
            cookie_parts(&request),
            vec![
                CookiePart::Pair {
                    name: "foo",
                    value: "10"
                },
                CookiePart::Pair {
                    name: "bar",
                    value: "27"
                },
                CookiePart::Pair {
                    name: "bar",
                    value: "7"
                },
                CookiePart::Pair {
                    name: "bar",
                    value: "17"
                },
                CookiePart::Pair {
                    name: "extra",
                    value: "9"
                },
            ]
        );
    }

    #[test]
    fn cookies_trims_and_skips_empty() {
        let request = HttpRequest {
            headers: vec![HttpHeader::new(
                "cookie",
                "  foo = 10 ; ; bar=27  ",
            )],
            ..Default::default()
        };
        assert_eq!(
            cookie_parts(&request),
            vec![
                CookiePart::Pair {
                    name: "foo",
                    value: "10"
                },
                CookiePart::Pair {
                    name: "bar",
                    value: "27"
                },
            ]
        );
    }

    #[test]
    fn cookies_malformed() {
        let request = HttpRequest {
            headers: vec![HttpHeader::new("cookie", "foo=10; badsegment")],
            ..Default::default()
        };
        assert_eq!(
            cookie_parts(&request),
            vec![
                CookiePart::Pair {
                    name: "foo",
                    value: "10"
                },
                CookiePart::Malformed,
            ]
        );
    }
}
