use psibase::native_raw;
use psibase::*;

use super::constants::{ID_LEN, SESSION_COOKIE};
use super::encoding::decode_fixed_hex;

enum CookieValue {
    Id(Vec<u8>),
    Missing,
    Malformed,
}

fn cookie_id(request: &HttpRequest, name: &str) -> CookieValue {
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

fn mint_id() -> Vec<u8> {
    let mut id = vec![0u8; ID_LEN];
    unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
    id
}
