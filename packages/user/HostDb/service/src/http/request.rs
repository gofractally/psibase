use psibase::HttpStatus::{BadRequest, Forbidden};
use psibase::*;

use crate::batch::{batch_ops_from_body, decode_fixed_hex, BatchOp, Duration};
use crate::policy::{DEVICE_COOKIE, DEVICE_ID_LEN, KEY_LEN, SESSION_COOKIE};

use super::reply::HostDbReply;

const KV_BATCH_PATH: &str = "/kv/batch";
const KV_PERSISTENT_PREFIX: &str = "/kv/persistent/";
const KV_SESSION_PREFIX: &str = "/kv/session/";

/// Parsed HTTP method, path, and batch body when applicable.
pub(crate) enum Route {
    CorsPreflight,
    GetPersistent(Vec<u8>),
    GetSession(Vec<u8>),
    PostBatch(Vec<BatchOp>),
    NotFound,
}

enum CookieLookup<'a> {
    Value(&'a str),
    Missing,
    Malformed,
}

/// How a batch should scope session storage.
#[derive(Copy, Clone)]
pub(crate) enum BatchSession {
    NotNeeded,
    Absent,
    Present(u32),
}

#[derive(Copy, Clone)]
enum SessionState {
    Absent,
    Valid(u32),
    Malformed,
}

/// `HttpRequest` plus HostDb-parsed identity and route.
pub(crate) struct HostDbRequest<'a> {
    http: &'a HttpRequest,
    device: Vec<u8>,
    session: SessionState,
    route: Route,
}

impl<'a> HostDbRequest<'a> {
    /// Entry point for `serveSys`: checks the supervisor `Origin`, resolves the
    /// device cookie, and parses the route. The returned `HostDbReply` already
    /// includes CORS and `Set-Cookie` for the device when applicable.
    pub(crate) fn accept(
        http: &'a HttpRequest,
        root: &str,
    ) -> Result<(Self, HostDbReply), HttpReply> {
        let mut reply = HostDbReply::empty();
        let origin = service_origin(http, account!("supervisor"), root)
            .ok_or_else(|| reply.set_status(Forbidden))?;
        reply.allow_origin(origin);
        let device = Self::device_id(http).ok_or_else(|| reply.set_status(BadRequest))?;
        reply.set_device(&device);
        let request = Self::new(http, device).map_err(|status| reply.set_status(status))?;
        Ok((request, reply))
    }

    fn new(http: &'a HttpRequest, device: Vec<u8>) -> Result<Self, HttpStatus> {
        let session = Self::session_state(http);
        let route = parse_route(http)?;
        Ok(Self {
            http,
            device,
            session,
            route,
        })
    }

    pub(crate) fn http(&self) -> &HttpRequest {
        self.http
    }

    pub(crate) fn device(&self) -> &[u8] {
        &self.device
    }

    pub(crate) fn take_route(&mut self) -> Route {
        std::mem::replace(&mut self.route, Route::NotFound)
    }

    /// `Some(id)` when the session cookie is present, `None` when it is absent.
    pub(crate) fn session_cookie(&self) -> Result<Option<u32>, HttpStatus> {
        match self.session {
            SessionState::Valid(id) => Ok(Some(id)),
            SessionState::Absent => Ok(None),
            SessionState::Malformed => Err(BadRequest),
        }
    }

    pub(crate) fn batch_session(&self, ops: &[BatchOp]) -> Result<BatchSession, HttpStatus> {
        if !ops.iter().any(|op| op.duration == Duration::Session) {
            return Ok(BatchSession::NotNeeded);
        }
        match self.session_cookie()? {
            None => Ok(BatchSession::Absent),
            Some(id) => Ok(BatchSession::Present(id)),
        }
    }

    fn device_id(http: &HttpRequest) -> Option<Vec<u8>> {
        match Self::cookie_value(http, DEVICE_COOKIE) {
            CookieLookup::Value(value) => decode_fixed_hex::<DEVICE_ID_LEN>(value),
            CookieLookup::Missing => Some(random_bytes(DEVICE_ID_LEN)),
            CookieLookup::Malformed => None,
        }
    }

    fn session_state(http: &HttpRequest) -> SessionState {
        match Self::cookie_value(http, SESSION_COOKIE) {
            CookieLookup::Missing => SessionState::Absent,
            CookieLookup::Malformed => SessionState::Malformed,
            CookieLookup::Value(value) => match parse_session_id(value) {
                Some(id) => SessionState::Valid(id),
                None => SessionState::Malformed,
            },
        }
    }

    fn cookie_value<'b>(http: &'b HttpRequest, name: &str) -> CookieLookup<'b> {
        let mut found = None;
        for part in http.cookies() {
            let Ok((cookie_name, value)) = part else {
                return CookieLookup::Malformed;
            };
            if cookie_name != name {
                continue;
            }
            if found.is_some() {
                return CookieLookup::Malformed;
            }
            found = Some(value);
        }
        match found {
            Some(value) => CookieLookup::Value(value),
            None => CookieLookup::Missing,
        }
    }
}

/// Decimal `u32` with no leading zeros.
fn parse_session_id(value: &str) -> Option<u32> {
    if value.len() > 1 && value.starts_with('0') {
        return None;
    }
    value.parse().ok()
}

fn is_storage_path(path: &str) -> bool {
    path == KV_BATCH_PATH
        || path.starts_with(KV_PERSISTENT_PREFIX)
        || path.starts_with(KV_SESSION_PREFIX)
}

fn parse_storage_key(key_hex: &str) -> Result<Vec<u8>, HttpStatus> {
    decode_fixed_hex::<KEY_LEN>(key_hex).ok_or(BadRequest)
}

fn parse_route(http: &HttpRequest) -> Result<Route, HttpStatus> {
    let method = http.method.as_str();
    let path = http.path();
    let path = path.as_ref();
    match method {
        "OPTIONS" if is_storage_path(path) => Ok(Route::CorsPreflight),
        "GET" => {
            if let Some(key_hex) = path.strip_prefix(KV_PERSISTENT_PREFIX) {
                parse_storage_key(key_hex).map(Route::GetPersistent)
            } else if let Some(key_hex) = path.strip_prefix(KV_SESSION_PREFIX) {
                parse_storage_key(key_hex).map(Route::GetSession)
            } else {
                Ok(Route::NotFound)
            }
        }
        "POST" if path == KV_BATCH_PATH => {
            let ops = batch_ops_from_body(&http.body.0).ok_or(BadRequest)?;
            Ok(Route::PostBatch(ops))
        }
        _ => Ok(Route::NotFound),
    }
}
