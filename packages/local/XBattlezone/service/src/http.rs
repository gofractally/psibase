use base64::{engine::general_purpose::STANDARD, Engine as _};
use psibase::services::x_http::Wrapper as XHttp;
use psibase::{
    account, allow_cors_with_origin, AccountNumber, HttpHeader, HttpReply, HttpRequest,
    ServiceWrapper,
};
use sha1::{Digest, Sha1};

use crate::protocol::{
    encode_server_frame, BATTLEZONE_SUBPROTOCOL_V1, WEBSOCKET_TEXT, WS_TICKET_SUBPROTOCOL_PREFIX,
};
use crate::protocol::{ProtocolError, ServerFrame};
use crate::r_transact::Wrapper as RTransact;

/// CORS for Host `get-ws-ticket` sync XHR (supervisor origin).
pub(crate) fn ticket_cors_headers() -> Vec<HttpHeader> {
    allow_cors_with_origin("*")
}

pub(crate) fn with_ticket_cors(mut reply: HttpReply) -> HttpReply {
    reply.headers.extend(ticket_cors_headers());
    reply
}

pub(crate) fn options_reply() -> HttpReply {
    HttpReply {
        status: 204,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: ticket_cors_headers(),
    }
}

pub(crate) fn plain_reply(status: u16, message: &str) -> HttpReply {
    HttpReply {
        status,
        contentType: "text/plain".into(),
        body: message.as_bytes().to_vec().into(),
        headers: Vec::new(),
    }
}

pub(crate) fn json_reply(status: u16, body: &str) -> HttpReply {
    HttpReply {
        status,
        contentType: "application/json".into(),
        body: body.as_bytes().to_vec().into(),
        headers: Vec::new(),
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

fn websocket_key(request: &HttpRequest) -> Option<&str> {
    if request.method != "GET"
        || !header_contains(request, "Upgrade", "websocket")
        || !header_contains(request, "Connection", "upgrade")
        || request.get_header("Sec-WebSocket-Version") != Some("13")
    {
        return None;
    }
    let key = request.get_header("Sec-WebSocket-Key")?;
    STANDARD
        .decode(key)
        .ok()
        .filter(|decoded| decoded.len() == 16)
        .map(|_| key)
}

fn websocket_accept_key(key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    STANDARD.encode(hasher.finalize())
}

pub(crate) fn ticket_from_subprotocol(request: &HttpRequest) -> Option<String> {
    request
        .headers
        .iter()
        .filter(|header| header.matches("Sec-WebSocket-Protocol"))
        .flat_map(|header| header.value.split(','))
        .map(str::trim)
        .find_map(|value| value.strip_prefix(WS_TICKET_SUBPROTOCOL_PREFIX))
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

/// Require battlezone v1 + a ticket subprotocol; reply may select only one token.
fn negotiate_subprotocols(request: &HttpRequest) -> Option<&'static str> {
    let mut has_v1 = false;
    let mut has_ticket = false;
    for header in request
        .headers
        .iter()
        .filter(|h| h.matches("Sec-WebSocket-Protocol"))
    {
        for part in header.value.split(',') {
            let p = part.trim();
            if p.eq_ignore_ascii_case(BATTLEZONE_SUBPROTOCOL_V1) {
                has_v1 = true;
            }
            if let Some(rest) = p.strip_prefix(WS_TICKET_SUBPROTOCOL_PREFIX) {
                if !rest.is_empty() {
                    has_ticket = true;
                }
            }
        }
    }
    if has_v1 && has_ticket {
        // RFC 6455: server selects a single protocol. Ticket is only for auth
        // (read from the request); do not echo it or handshake validation fails.
        Some(BATTLEZONE_SUBPROTOCOL_V1)
    } else {
        None
    }
}

pub(crate) fn websocket_handshake(request: &HttpRequest) -> Option<HttpReply> {
    let key = websocket_key(request)?;
    let chosen = negotiate_subprotocols(request)?;
    Some(HttpReply {
        status: 101,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: vec![
            HttpHeader::new("Upgrade", "websocket"),
            HttpHeader::new("Connection", "Upgrade"),
            HttpHeader::new("Sec-WebSocket-Accept", &websocket_accept_key(key)),
            HttpHeader::new("Sec-WebSocket-Protocol", &chosen),
        ],
    })
}

pub(crate) fn authenticated_user(request: &HttpRequest) -> Option<AccountNumber> {
    RTransact::call().getUser(request.clone())
}

pub(crate) fn send_frame(socket: i32, frame: &ServerFrame) {
    let payload = encode_server_frame(frame).expect("server frame must serialize");
    XHttp::call().send(socket, payload.into_bytes(), WEBSOCKET_TEXT);
}

pub(crate) fn send_protocol_error(socket: i32, err: ProtocolError) {
    send_frame(
        socket,
        &ServerFrame::Error {
            code: err.code().into(),
            reason: err.reason(),
        },
    );
}

pub(crate) fn fanout_frames(frames: Vec<(i32, ServerFrame)>) {
    for (socket, frame) in frames {
        send_frame(socket, &frame);
    }
}

pub(crate) fn assert_x_http_sender() {
    assert_eq!(
        psibase::get_sender(),
        account!("x-http"),
        "x-bzone must be called by x-http",
    );
}
