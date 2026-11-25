use psibase::HttpStatus::{BadRequest, Forbidden, Unauthorized};
use psibase::*;

use crate::batch::{batch_ops_from_body, decode_fixed_hex, BatchOp, Duration};
use crate::policy::{DEVICE_COOKIE, DEVICE_ID_LEN, KEY_LEN, SESSION_COOKIE};

use super::reply::HostDbReply;

const KV_BATCH_PATH: &str = "/kv/batch";
const KV_DEVICE_PATH: &str = "/kv/device";
const KV_PERSISTENT_PREFIX: &str = "/kv/persistent/";
const KV_SESSION_PREFIX: &str = "/kv/session/";

/// Parsed HTTP method, path, and batch body when applicable.
pub(crate) enum Route {
    CorsPreflight,
    PutDevice,
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

enum DeviceState {
    Missing,
    Valid(Vec<u8>),
    Malformed,
}

enum Attempt {
    CorsPreflight,
    PutDevice,
    Storage(Route),
    InvalidStorage(HttpStatus),
    NotFound,
}

/// Device id when one was presented or minted, session id when that cookie
/// parsed, and the route `serveSys` should run.
pub(crate) struct HostDbRequest {
    device: Option<Vec<u8>>,
    session: Option<u32>,
    route: Route,
}

impl HostDbRequest {
    /// Resolves cookies and the route for `serveSys`.
    ///
    /// `root` is the request host's root. `Origin` must be the supervisor
    /// service origin on that root; otherwise `403` with no CORS headers.
    /// An accepted reply allows that origin with credentials. A presented
    /// device cookie is re-set. `PUT /kv/device` mints one when it is absent.
    /// Any other storage read or write without a device cookie is `401` and
    /// sends no `Set-Cookie`.
    pub(crate) fn accept(http: &HttpRequest, root: &str) -> Result<(Self, HostDbReply), HttpReply> {
        let mut reply = HostDbReply::empty();
        let Some(origin) = service_origin(http, account!("supervisor"), root) else {
            return Err(reply.set_status(Forbidden));
        };
        reply.allow_origin(origin);
        let device = match Self::device_state(http) {
            DeviceState::Malformed => return Err(reply.set_status(BadRequest)),
            DeviceState::Missing => None,
            DeviceState::Valid(device) => Some(device),
        };
        let session_state = Self::session_state(http);
        match read_attempt(http) {
            Attempt::CorsPreflight => {
                let device = echo_device(&mut reply, device);
                reply.set_preflight(http);
                Ok((Self::new(device, None, Route::CorsPreflight), reply))
            }
            Attempt::PutDevice => {
                if matches!(session_state, SessionState::Malformed) {
                    return Err(reply.set_status(BadRequest));
                }
                let device = device.unwrap_or_else(|| random_bytes(DEVICE_ID_LEN));
                reply.set_device(&device);
                Ok((
                    Self::new(
                        Some(device),
                        usable_session(session_state),
                        Route::PutDevice,
                    ),
                    reply,
                ))
            }
            Attempt::InvalidStorage(status) => {
                let Some(device) = device else {
                    return Err(reply.set_status(Unauthorized));
                };
                reply.set_device(&device);
                Err(reply.set_status(status))
            }
            Attempt::Storage(route) => {
                let Some(device) = device else {
                    return Err(reply.set_status(Unauthorized));
                };
                if matches!(session_state, SessionState::Malformed) && route_uses_session(&route) {
                    return Err(reply.set_status(BadRequest));
                }
                reply.set_device(&device);
                Ok((
                    Self::new(Some(device), usable_session(session_state), route),
                    reply,
                ))
            }
            Attempt::NotFound => {
                let device = echo_device(&mut reply, device);
                Ok((Self::new(device, None, Route::NotFound), reply))
            }
        }
    }

    fn new(device: Option<Vec<u8>>, session: Option<u32>, route: Route) -> Self {
        Self {
            device,
            session,
            route,
        }
    }

    pub(crate) fn device(&self) -> &[u8] {
        self.device.as_deref().expect("storage route")
    }

    pub(crate) fn take_route(&mut self) -> Route {
        std::mem::replace(&mut self.route, Route::NotFound)
    }

    /// `Some(id)` when the session cookie is present, `None` when it is absent.
    pub(crate) fn session_cookie(&self) -> Option<u32> {
        self.session
    }

    pub(crate) fn batch_session(&self, ops: &[BatchOp]) -> BatchSession {
        if !batch_has_session(ops) {
            return BatchSession::NotNeeded;
        }
        match self.session_cookie() {
            None => BatchSession::Absent,
            Some(id) => BatchSession::Present(id),
        }
    }

    fn device_state(http: &HttpRequest) -> DeviceState {
        match Self::cookie_value(http, DEVICE_COOKIE) {
            CookieLookup::Missing => DeviceState::Missing,
            CookieLookup::Malformed => DeviceState::Malformed,
            CookieLookup::Value(value) => match decode_fixed_hex::<DEVICE_ID_LEN>(value) {
                Some(id) => DeviceState::Valid(id),
                None => DeviceState::Malformed,
            },
        }
    }

    fn session_state(http: &HttpRequest) -> SessionState {
        match Self::cookie_value(http, SESSION_COOKIE) {
            CookieLookup::Missing => SessionState::Absent,
            CookieLookup::Malformed => SessionState::Malformed,
            CookieLookup::Value(value) => match value.parse().ok() {
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

fn usable_session(state: SessionState) -> Option<u32> {
    match state {
        SessionState::Valid(id) => Some(id),
        SessionState::Absent | SessionState::Malformed => None,
    }
}

fn echo_device(reply: &mut HostDbReply, device: Option<Vec<u8>>) -> Option<Vec<u8>> {
    if let Some(device) = &device {
        reply.set_device(device);
    }
    device
}

fn batch_has_session(ops: &[BatchOp]) -> bool {
    ops.iter().any(|op| op.duration == Duration::Session)
}

fn route_uses_session(route: &Route) -> bool {
    match route {
        Route::GetSession(_) => true,
        Route::PostBatch(ops) => batch_has_session(ops),
        _ => false,
    }
}

fn read_attempt(http: &HttpRequest) -> Attempt {
    let method = http.method.as_str();
    let path = http.path();
    let path = path.as_ref();
    if method == "OPTIONS" && is_preflight_path(path) {
        return Attempt::CorsPreflight;
    }
    if method == "PUT" && path == KV_DEVICE_PATH {
        return Attempt::PutDevice;
    }
    if method == "GET" {
        if let Some(key_hex) = path.strip_prefix(KV_PERSISTENT_PREFIX) {
            return storage_key(key_hex, Route::GetPersistent);
        }
        if let Some(key_hex) = path.strip_prefix(KV_SESSION_PREFIX) {
            return storage_key(key_hex, Route::GetSession);
        }
    }
    if method == "POST" && path == KV_BATCH_PATH {
        return match batch_ops_from_body(&http.body.0) {
            Some(ops) => Attempt::Storage(Route::PostBatch(ops)),
            None => Attempt::InvalidStorage(BadRequest),
        };
    }
    Attempt::NotFound
}

fn storage_key(key_hex: &str, route: fn(Vec<u8>) -> Route) -> Attempt {
    match decode_fixed_hex::<KEY_LEN>(key_hex) {
        Some(key) => Attempt::Storage(route(key)),
        None => Attempt::InvalidStorage(BadRequest),
    }
}

fn is_preflight_path(path: &str) -> bool {
    path == KV_DEVICE_PATH || is_storage_path(path)
}

fn is_storage_path(path: &str) -> bool {
    path == KV_BATCH_PATH
        || path.starts_with(KV_PERSISTENT_PREFIX)
        || path.starts_with(KV_SESSION_PREFIX)
}
