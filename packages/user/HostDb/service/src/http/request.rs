use psibase::HttpStatus::{BadRequest, Forbidden};
use psibase::*;

use crate::batch::{batch_ops_from_body, decode_fixed_hex, BatchOp, Duration};
use crate::policy::{DEVICE_COOKIE, DEVICE_ID_LEN, KEY_LEN, SESSION_COOKIE, SESSION_ID_LEN};

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

enum CookieValue {
    Id(Vec<u8>),
    Missing,
    Malformed,
}

enum SessionState {
    Absent,
    Valid(Vec<u8>),
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
        let session = match Self::cookie_id::<SESSION_ID_LEN>(http, SESSION_COOKIE) {
            CookieValue::Id(id) => SessionState::Valid(id),
            CookieValue::Missing => SessionState::Absent,
            CookieValue::Malformed => SessionState::Malformed,
        };
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

    /// Session id for session-scoped routes; mints when the cookie was absent.
    pub(crate) fn required_session(&mut self) -> Result<&[u8], HttpStatus> {
        if matches!(self.session, SessionState::Absent) {
            self.session = SessionState::Valid(random_bytes(SESSION_ID_LEN));
        }
        match &self.session {
            SessionState::Valid(id) => Ok(id),
            SessionState::Malformed => Err(BadRequest),
            SessionState::Absent => unreachable!(),
        }
    }

    /// `Some(session)` when `ops` include session-scoped work; mints when needed.
    pub(crate) fn batch_session(&mut self, ops: &[BatchOp]) -> Result<Option<&[u8]>, HttpStatus> {
        if ops.iter().any(|op| op.duration == Duration::Session) {
            self.required_session().map(Some)
        } else {
            Ok(None)
        }
    }

    fn device_id(http: &HttpRequest) -> Option<Vec<u8>> {
        Self::cookie_or_mint::<DEVICE_ID_LEN>(http, DEVICE_COOKIE)
    }

    fn cookie_or_mint<const N: usize>(http: &HttpRequest, name: &str) -> Option<Vec<u8>> {
        match Self::cookie_id::<N>(http, name) {
            CookieValue::Id(id) => Some(id),
            CookieValue::Missing => Some(random_bytes(N)),
            CookieValue::Malformed => None,
        }
    }

    fn cookie_id<const N: usize>(http: &HttpRequest, name: &str) -> CookieValue {
        let mut found = None;
        for part in http.cookies() {
            match part {
                CookiePart::Malformed => return CookieValue::Malformed,
                CookiePart::Pair {
                    name: cookie_name,
                    value,
                } if cookie_name == name => {
                    if found.is_some() {
                        return CookieValue::Malformed;
                    }
                    found = Some(value);
                }
                _ => {}
            }
        }
        match found {
            None => CookieValue::Missing,
            Some(value) => match decode_fixed_hex::<N>(value) {
                Some(id) => CookieValue::Id(id),
                None => CookieValue::Malformed,
            },
        }
    }
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
