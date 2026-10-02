use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use psibase::native_raw;
use psibase::*;
use serde::Deserialize;
use std::str::FromStr;

pub(crate) const DEVICE_COOKIE: &str = "__Host-HOSTDB-DEVICE";
pub(crate) const SESSION_COOKIE: &str = "__Host-HOSTDB-SESSION";
pub(crate) const ID_LEN: usize = 16;
pub(crate) const KEY_LEN: usize = 32;
/// 100 KB plaintext plus the 12-byte nonce and 16-byte GCM tag `host:db` stores.
pub(crate) const MAX_VALUE_LEN: usize = 100 * 1024 + 28;
pub(crate) const NS_PER_SEC: u64 = 1_000_000_000;
pub(crate) const DAY_SECS: u64 = 24 * 60 * 60;
/// Device cookie `Max-Age`.
pub(crate) const DEVICE_MAX_AGE_SECS: u64 = 400 * DAY_SECS;
pub(crate) const DEVICE_IDLE_NS: u64 = DEVICE_MAX_AGE_SECS * NS_PER_SEC;
/// `__WASI_CLOCKID_REALTIME`: wall-clock nanoseconds since the unix epoch.
pub(crate) const CLOCK_REALTIME: u32 = 0;
pub(crate) const SESSION_IDLE_NS: u64 = 7 * DAY_SECS * NS_PER_SEC;
pub(crate) const GC_LIMIT: usize = 16;

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Duration {
    Persistent,
    Session,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchBody {
    ops: Vec<BatchOp>,
}

/// Ciphertext observed by GET: absent, or the SHA-256 of the value returned.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ReadExpect {
    Absent,
    Hash(Checksum256),
}

/// Read-time precondition for one batch op.
/// Missing `expected` is unconditional. Null means the GET was absent.
/// A hex string is the SHA-256 of the ciphertext that GET returned.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum Precondition {
    #[default]
    Unconditional,
    Read(ReadExpect),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchOp {
    duration: Duration,
    key: String,
    value: Option<String>,
    #[serde(default, deserialize_with = "deserialize_precondition")]
    expected: Precondition,
}

pub(crate) struct Change {
    pub(crate) duration: Duration,
    pub(crate) key: Vec<u8>,
    pub(crate) value: Option<Vec<u8>>,
    pub(crate) expected: Precondition,
}

pub(crate) enum CookieValue {
    Id(Vec<u8>),
    Missing,
    Malformed,
}

pub(crate) fn cookie_id(request: &HttpRequest, name: &str) -> CookieValue {
    let mut found = None;
    for part in request.cookies() {
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
        Some(value) => match decode_fixed_hex::<ID_LEN>(value) {
            Some(id) => CookieValue::Id(id),
            None => CookieValue::Malformed,
        },
    }
}

/// Cookie id for a read or write. `None` when the cookie is present and
/// malformed; a missing cookie starts a new id.
pub(crate) fn cookie_or_mint(request: &HttpRequest, name: &str) -> Option<Vec<u8>> {
    match cookie_id(request, name) {
        CookieValue::Id(id) => Some(id),
        CookieValue::Missing => Some(mint_id()),
        CookieValue::Malformed => None,
    }
}

/// Session id for a session read or write. `None` when the cookie is present
/// and malformed; a missing cookie starts an empty session.
pub(crate) fn session_id(request: &HttpRequest) -> Option<Vec<u8>> {
    cookie_or_mint(request, SESSION_COOKIE)
}

pub(crate) fn mint_id() -> Vec<u8> {
    let mut id = vec![0u8; ID_LEN];
    unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
    id
}

pub(crate) fn wall_time_ns() -> u64 {
    let mut time = 0u64;
    let err = unsafe { native_raw::clockTimeGet(CLOCK_REALTIME, &mut time) };
    if err != 0 {
        abort_message("clockTimeGet failed");
    }
    time
}

pub(crate) fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
    let body: BatchBody = serde_json::from_slice(body).ok()?;
    let mut changes = Vec::with_capacity(body.ops.len());
    for op in body.ops {
        let key = decode_fixed_hex::<KEY_LEN>(&op.key)?;
        let value = match op.value {
            None => None,
            Some(value) => {
                let value = URL_SAFE_NO_PAD.decode(value).ok()?;
                if value.len() > MAX_VALUE_LEN {
                    return None;
                }
                Some(value)
            }
        };
        changes.push(Change {
            duration: op.duration,
            key,
            value,
            expected: op.expected,
        });
    }
    Some(changes)
}

fn deserialize_precondition<'de, D>(deserializer: D) -> Result<Precondition, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<String>::deserialize(deserializer)? {
        None => Ok(Precondition::Read(ReadExpect::Absent)),
        Some(hex) => Checksum256::from_str(&hex)
            .map(|hash| Precondition::Read(ReadExpect::Hash(hash)))
            .map_err(|_| serde::de::Error::custom("expected must be a SHA-256 hex digest")),
    }
}

pub(crate) fn decode_fixed_hex<const N: usize>(input: &str) -> Option<Vec<u8>> {
    Hex::<[u8; N]>::from_str(input)
        .ok()
        .map(|hex| hex.0.to_vec())
}

/// Cookie values are lowercase hex.
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    Hex(bytes).to_string().to_ascii_lowercase()
}

/// 409 when the read-time expectation does not describe `stored`.
pub(crate) fn check_precondition(stored: Option<&[u8]>, expected: &ReadExpect) -> Result<(), u16> {
    let matches = match expected {
        ReadExpect::Absent => stored.is_none(),
        ReadExpect::Hash(hash) => stored.is_some_and(|value| sha256(value) == *hash),
    };
    if matches {
        Ok(())
    } else {
        Err(409)
    }
}

pub(crate) fn status_reply(status: u16) -> HttpReply {
    HttpReply {
        status,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: Vec::new(),
    }
}

pub(crate) fn reply(
    request: &HttpRequest,
    origin: &str,
    status: u16,
    body: Option<Vec<u8>>,
    device_cookie: Option<String>,
    session_cookie: Option<String>,
) -> HttpReply {
    let content_type = if body.is_some() {
        "application/octet-stream"
    } else {
        ""
    };
    // Not every OPTIONS response is a preflight: a malformed cookie is 400 and
    // an unknown path is 404.
    let preflight = request.method == "OPTIONS" && status == 204;
    let mut headers = vec![
        HttpHeader::new("Access-Control-Allow-Origin", origin),
        HttpHeader::new("Access-Control-Allow-Credentials", "true"),
    ];
    if preflight {
        headers.push(HttpHeader::new("Access-Control-Allow-Methods", "GET, POST"));
        if let Some(requested) = request.get_header("access-control-request-headers") {
            headers.push(HttpHeader::new("Access-Control-Allow-Headers", requested));
        }
    }
    if let Some(cookie) = device_cookie {
        headers.push(HttpHeader::new(
            "Set-Cookie",
            &format!(
                "{DEVICE_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; Max-Age={DEVICE_MAX_AGE_SECS}; HttpOnly;"
            ),
        ));
    }
    if let Some(cookie) = session_cookie {
        headers.push(HttpHeader::new(
            "Set-Cookie",
            &format!("{SESSION_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; HttpOnly;"),
        ));
    }
    HttpReply {
        status,
        contentType: content_type.to_string(),
        body: body.unwrap_or_default().into(),
        headers,
    }
}
