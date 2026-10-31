use psibase::*;

use super::constants::{DEVICE_COOKIE, DEVICE_ID_LEN, ID_LEN, SESSION_COOKIE};
use super::encoding::decode_fixed_hex;
use super::ids::mint_random;

enum CookieValue {
    Id(Vec<u8>),
    Missing,
    Malformed,
}

fn cookie_id<const N: usize>(request: &HttpRequest, name: &str) -> CookieValue {
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
        Some(value) => match decode_fixed_hex::<N>(value) {
            Some(id) => CookieValue::Id(id),
            None => CookieValue::Malformed,
        },
    }
}

fn cookie_or_mint<const N: usize>(request: &HttpRequest, name: &str) -> Option<Vec<u8>> {
    match cookie_id::<N>(request, name) {
        CookieValue::Id(id) => Some(id),
        CookieValue::Missing => Some(mint_random::<N>()),
        CookieValue::Malformed => None,
    }
}

/// Device id for a read or write. `None` when the cookie is present and
/// malformed; a missing cookie starts a new id.
pub(crate) fn device_id(request: &HttpRequest) -> Option<Vec<u8>> {
    cookie_or_mint::<DEVICE_ID_LEN>(request, DEVICE_COOKIE)
}

/// Session id for a session read or write. `None` when the cookie is present
/// and malformed; a missing cookie starts a new session id.
pub(crate) fn session_id(request: &HttpRequest) -> Option<Vec<u8>> {
    cookie_or_mint::<ID_LEN>(request, SESSION_COOKIE)
}
