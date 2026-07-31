use base64::{engine::general_purpose::STANDARD, Engine as _};
use psibase::{AccountNumber, HttpHeader, HttpReply, HttpRequest};
use sha1::{Digest, Sha1};

use super::route::{header_contains, negotiate_realtime_subprotocol, plain_reply};

pub(crate) fn websocket_key(request: &HttpRequest) -> Option<&str> {
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

pub(crate) fn websocket_accept_key(key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    STANDARD.encode(hasher.finalize())
}

pub(crate) fn websocket_handshake(request: &HttpRequest) -> Option<HttpReply> {
    let key = websocket_key(request)?;
    let chosen = negotiate_realtime_subprotocol(request)?;

    Some(HttpReply {
        status: 101,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: vec![
            HttpHeader::new("Upgrade", "websocket"),
            HttpHeader::new("Connection", "Upgrade"),
            HttpHeader::new("Sec-WebSocket-Accept", &websocket_accept_key(key)),
            HttpHeader::new("Sec-WebSocket-Protocol", chosen),
        ],
    })
}

pub(crate) fn websocket_route(
    request: &HttpRequest,
    socket: Option<i32>,
    user: Option<AccountNumber>,
) -> Result<(i32, AccountNumber, HttpReply), HttpReply> {
    let Some(socket) = socket else {
        return Err(plain_reply(503, "x-wrtcsig requires a websocket socket"));
    };

    let Some(user) = user else {
        return Err(plain_reply(
            401,
            "x-wrtcsig websocket requires authentication",
        ));
    };

    let Some(reply) = websocket_handshake(request) else {
        return Err(plain_reply(
            426,
            "x-wrtcsig /ws requires websocket subprotocol psibase.realtime.v1",
        ));
    };

    Ok((socket, user, reply))
}
