use psibase::{account, AccountNumber, HttpHeader, HttpReply, HttpRequest};
#[cfg(not(test))]
use psibase::ServiceWrapper;

use crate::protocol::REALTIME_SUBPROTOCOL_V1;
use crate::r_transact::Wrapper as RTransact;

const BEARER_SUBPROTOCOL_PREFIX: &str = "psibase.bearer.";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RouteTarget {
    Login,
    WebSocket,
    NotFound,
}

pub(crate) fn plain_reply(status: u16, message: &str) -> HttpReply {
    HttpReply {
        status,
        contentType: "text/plain".into(),
        body: message.as_bytes().to_vec().into(),
        headers: Vec::new(),
    }
}

pub(crate) fn rtransact_login(
    request: HttpRequest,
    socket: Option<i32>,
    user: Option<AccountNumber>,
) -> Option<HttpReply> {
    RTransact::call_from(account!("x-http")).serveSys(request, socket, user)
}

pub(crate) fn route_target(request: &HttpRequest) -> RouteTarget {
    match request.path().as_ref() {
        "/login" => RouteTarget::Login,
        "/ws" => RouteTarget::WebSocket,
        _ => RouteTarget::NotFound,
    }
}

pub(crate) fn header_contains(request: &HttpRequest, name: &str, expected: &str) -> bool {
    request
        .headers
        .iter()
        .filter(|header| header.matches(name))
        .flat_map(|header| header.value.split(','))
        .any(|value| value.trim().eq_ignore_ascii_case(expected))
}

pub(crate) fn bearer_subprotocol_token(request: &HttpRequest) -> Option<&str> {
    request
        .headers
        .iter()
        .filter(|header| header.matches("Sec-WebSocket-Protocol"))
        .flat_map(|header| header.value.split(','))
        .map(str::trim)
        .find_map(|value| value.strip_prefix(BEARER_SUBPROTOCOL_PREFIX))
        .filter(|token| !token.is_empty())
}

pub(crate) fn authenticated_user(request: &HttpRequest) -> Option<AccountNumber> {
    if let Some(user) = RTransact::call().getUser(request.clone()) {
        return Some(user);
    }

    let token = bearer_subprotocol_token(request)?;
    let mut request = request.clone();
    request
        .headers
        .push(HttpHeader::new("Authorization", &format!("Bearer {token}")));
    RTransact::call().getUser(request)
}

pub(crate) fn negotiate_realtime_subprotocol(request: &HttpRequest) -> Option<&'static str> {
    for header in request
        .headers
        .iter()
        .filter(|h| h.matches("Sec-WebSocket-Protocol"))
    {
        for part in header.value.split(',') {
            if part.trim().eq_ignore_ascii_case(REALTIME_SUBPROTOCOL_V1) {
                return Some(REALTIME_SUBPROTOCOL_V1);
            }
        }
    }
    None
}
