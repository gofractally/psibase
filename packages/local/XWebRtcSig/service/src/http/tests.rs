use super::{
    websocket_accept_key, bearer_subprotocol_token, header_contains, route_target, websocket_handshake,
    websocket_route, RouteTarget,
};
use crate::protocol::{
    encode_server_frame, parse_client_frame, validate_client_frame, ClientFrame, ProtocolError,
    ServerFrame, REALTIME_SUBPROTOCOL_V1,
};
use psibase::MethodNumber;
use psibase::{AccountNumber, HttpHeader, HttpRequest};

#[test]
fn required_entrypoint_names_are_valid() {
    for (name, normalized) in [
        ("serveSys", "servesys"),
        ("recv", "recv"),
        ("close", "close"),
        ("errSys", "errsys"),
    ] {
        assert_eq!(MethodNumber::from(name).to_string(), normalized);
    }
}

#[test]
fn derives_rfc6455_websocket_accept_key() {
    assert_eq!(
        websocket_accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
}

#[test]
fn routes_ws_and_unknown_targets() {
    assert_eq!(
        route_target(&http_request("GET", "/ws", vec![])),
        RouteTarget::WebSocket
    );
    assert_eq!(
        route_target(&http_request("GET", "/elsewhere", vec![])),
        RouteTarget::NotFound
    );
}

#[test]
fn websocket_handshake_requires_realtime_subprotocol() {
    let request = websocket_request(vec![]);
    let reply = websocket_handshake(&request).expect("valid realtime websocket handshake");
    assert_eq!(reply.status, 101);
    assert_eq!(
        reply_header(&reply, "Sec-WebSocket-Protocol"),
        Some(REALTIME_SUBPROTOCOL_V1)
    );

    let wrong = http_request(
        "GET",
        "/ws",
        websocket_headers(vec![("Sec-WebSocket-Protocol", "chat")]),
    );
    assert!(websocket_handshake(&wrong).is_none());
}

#[test]
fn websocket_route_returns_focused_http_errors() {
    let request = websocket_request(vec![]);
    let user: AccountNumber = "alice".parse().unwrap();

    assert_eq!(
        match websocket_route(&request, None, Some(user)) {
            Err(reply) => reply.status,
            Ok(_) => panic!("missing socket should not accept"),
        },
        503
    );
    assert_eq!(
        match websocket_route(&request, Some(7), None) {
            Err(reply) => reply.status,
            Ok(_) => panic!("unauthenticated user should not accept"),
        },
        401
    );

    let bad = websocket_request(vec![("Sec-WebSocket-Protocol", "chat")]);
    assert_eq!(
        match websocket_route(&bad, Some(7), Some(user)) {
            Err(reply) => reply.status,
            Ok(_) => panic!("bad handshake should not accept"),
        },
        426
    );

    let (socket, accepted_user, reply) =
        websocket_route(&request, Some(7), Some(user)).expect("valid handshake");
    assert_eq!(socket, 7);
    assert_eq!(accepted_user, user);
    assert_eq!(reply.status, 101);
}

#[test]
fn extracts_bearer_token_from_websocket_subprotocols() {
    let request = http_request(
        "GET",
        "/ws",
        vec![HttpHeader::new(
            "Sec-WebSocket-Protocol",
            "psibase.realtime.v1, psibase.bearer.header.payload.signature",
        )],
    );
    assert_eq!(
        bearer_subprotocol_token(&request),
        Some("header.payload.signature")
    );
}

#[test]
fn header_contains_matches_case_insensitive_comma_separated_tokens() {
    let request = http_request(
        "GET",
        "/ws",
        vec![
            HttpHeader::new("Connection", "keep-alive, Upgrade"),
            HttpHeader::new("Sec-WebSocket-Protocol", REALTIME_SUBPROTOCOL_V1),
        ],
    );
    assert!(header_contains(&request, "connection", "upgrade"));
}

#[test]
fn parses_client_ready_frame() {
    let frame = parse_client_frame(
        br#"{"t":"clientReady","clientInstanceId":"id-1","active":true,"visible":true,"supports":{"audio":true,"video":true,"data":false}}"#,
    )
    .unwrap();
    assert!(validate_client_frame(&frame).is_ok());
    assert!(matches!(frame, ClientFrame::ClientReady { .. }));
}

#[test]
fn serializes_welcome_with_ice_servers() {
    let frame = ServerFrame::Welcome {
        user: "alice".parse().unwrap(),
        server_time: 1,
        ice_servers: crate::ice_config::default_stun_ice_server_configs(),
        active_sessions: None,
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""t":"welcome""#));
    assert!(json.contains(r#""iceServers""#));
}

#[test]
fn rejects_unknown_frame_types() {
    assert!(matches!(
        parse_client_frame(br#"{"t":"sync"}"#),
        Err(ProtocolError::UnknownFrameType(_))
    ));
}

fn http_request(method: &str, target: &str, headers: Vec<HttpHeader>) -> HttpRequest {
    HttpRequest {
        host: "x-wrtcsig.test".into(),
        method: method.into(),
        target: target.into(),
        contentType: String::new(),
        headers,
        body: Vec::new().into(),
    }
}

fn websocket_request(overrides: Vec<(&str, &str)>) -> HttpRequest {
    http_request("GET", "/ws", websocket_headers(overrides))
}

fn websocket_headers(overrides: Vec<(&str, &str)>) -> Vec<HttpHeader> {
    let mut headers = vec![
        ("Upgrade", "websocket"),
        ("Connection", "keep-alive, Upgrade"),
        ("Sec-WebSocket-Version", "13"),
        ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
        ("Sec-WebSocket-Protocol", REALTIME_SUBPROTOCOL_V1),
    ];
    for (name, value) in overrides {
        if let Some((_, existing)) = headers
            .iter_mut()
            .find(|(existing_name, _)| existing_name.eq_ignore_ascii_case(name))
        {
            *existing = value;
        } else {
            headers.push((name, value));
        }
    }
    headers
        .into_iter()
        .map(|(name, value)| HttpHeader::new(name, value))
        .collect()
}

fn reply_header<'a>(reply: &'a psibase::HttpReply, name: &str) -> Option<&'a str> {
    reply
        .headers
        .iter()
        .find(|header| header.matches(name))
        .map(|header| header.value.as_str())
}
