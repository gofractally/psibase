pub mod cleanup;
pub mod ice_config;
pub mod protocol;
pub mod state;
pub mod trace;

pub mod presence;
pub mod signaling;

#[cfg(not(test))]
mod r_transact {
    #[psibase::service(name = "r-transact", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    mod service {
        use psibase::{AccountNumber, HttpReply, HttpRequest};

        #[action]
        fn getUser(request: HttpRequest) -> Option<AccountNumber> {
            unimplemented!()
        }

        #[action]
        fn serveSys(
            request: HttpRequest,
            socket: Option<i32>,
            user: Option<AccountNumber>,
        ) -> Option<HttpReply> {
            unimplemented!()
        }
    }
}

#[cfg(test)]
mod r_transact {
    use psibase::{AccountNumber, HttpReply, HttpRequest};

    pub struct Wrapper;

    impl Wrapper {
        pub fn call() -> Self {
            Self
        }

        pub fn call_from(_sender: AccountNumber) -> Self {
            Self
        }

        #[allow(non_snake_case)]
        pub fn getUser(&self, _request: HttpRequest) -> Option<AccountNumber> {
            None
        }

        #[allow(non_snake_case)]
        pub fn serveSys(
            &self,
            _request: HttpRequest,
            _socket: Option<i32>,
            _user: Option<AccountNumber>,
        ) -> Option<HttpReply> {
            unimplemented!()
        }
    }
}

#[psibase::service(name = "x-webrtcsig", tables = "state::tables")]
#[allow(non_snake_case)]
mod service {
    use crate::ice_config::merged_ice_servers;
    use crate::protocol::{
        decode_server_frame_json, encode_server_frame, parse_client_frame, validate_client_frame,
        ClientFrame, ProtocolError, ServerFrame, WEBSOCKET_TEXT, REALTIME_SUBPROTOCOL_V1,
    };
    use crate::signaling::dispatch_signaling_client_frame;
    use crate::r_transact::Wrapper as RTransact;
    use crate::state::subjective::{
        connect_presence_fanout_tx, disconnect_presence_fanout_tx,
        enqueue_pending_outbound_frames_tx, remove_socket_session_tx, socket_session_tx,
        store_client_ready_tx, sweep_stale_sessions_tx, take_pending_outbound_payloads_tx,
        tear_down_signaling_for_dead_socket_tx, upsert_session_tx,
    };
    use crate::trace::xrtcsig_trace;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    #[cfg(not(test))]
    use psibase::services::x_admin::Wrapper as XAdminWrapper;
    use psibase::services::x_http::Wrapper as XHttp;
    use psibase::{
        account, check, get_sender, services::transact::Wrapper as Transact, AccountNumber,
        HttpHeader, HttpReply, HttpRequest, MethodNumber,
    };
    use sha1::{Digest, Sha1};

    const BEARER_SUBPROTOCOL_PREFIX: &str = "psibase.bearer.";

    fn plain_reply(status: u16, message: &str) -> HttpReply {
        HttpReply {
            status,
            contentType: "text/plain".into(),
            body: message.as_bytes().to_vec().into(),
            headers: Vec::new(),
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum RouteTarget {
        Login,
        WebSocket,
        NotFound,
    }

    fn rtransact_login(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        RTransact::call_from(account!("http-server")).serveSys(request, socket, user)
    }

    pub(super) fn route_target(request: &HttpRequest) -> RouteTarget {
        match request.path().as_ref() {
            "/login" => RouteTarget::Login,
            "/ws" => RouteTarget::WebSocket,
            _ => RouteTarget::NotFound,
        }
    }

    pub(super) fn header_contains(request: &HttpRequest, name: &str, expected: &str) -> bool {
        request
            .headers
            .iter()
            .filter(|header| header.matches(name))
            .flat_map(|header| header.value.split(','))
            .any(|value| value.trim().eq_ignore_ascii_case(expected))
    }

    pub(super) fn bearer_subprotocol_token(request: &HttpRequest) -> Option<&str> {
        request
            .headers
            .iter()
            .filter(|header| header.matches("Sec-WebSocket-Protocol"))
            .flat_map(|header| header.value.split(','))
            .map(str::trim)
            .find_map(|value| value.strip_prefix(BEARER_SUBPROTOCOL_PREFIX))
            .filter(|token| !token.is_empty())
    }

    fn authenticated_user(request: &HttpRequest) -> Option<AccountNumber> {
        if let Some(user) = RTransact::call().getUser(request.clone()) {
            return Some(user);
        }

        let token = bearer_subprotocol_token(request)?;
        let mut request = request.clone();
        request.headers.push(HttpHeader::new(
            "Authorization",
            &format!("Bearer {token}"),
        ));
        RTransact::call().getUser(request)
    }

    pub(super) fn websocket_key(request: &HttpRequest) -> Option<&str> {
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

    pub(super) fn accept_key(key: &str) -> String {
        let mut hasher = Sha1::new();
        hasher.update(key.as_bytes());
        hasher.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        STANDARD.encode(hasher.finalize())
    }

    fn negotiate_realtime_subprotocol(request: &HttpRequest) -> Option<&'static str> {
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

    pub(super) fn websocket_handshake(request: &HttpRequest) -> Option<HttpReply> {
        let key = websocket_key(request)?;
        let chosen = negotiate_realtime_subprotocol(request)?;

        Some(HttpReply {
            status: 101,
            contentType: String::new(),
            body: Vec::new().into(),
            headers: vec![
                HttpHeader::new("Upgrade", "websocket"),
                HttpHeader::new("Connection", "Upgrade"),
                HttpHeader::new("Sec-WebSocket-Accept", &accept_key(key)),
                HttpHeader::new("Sec-WebSocket-Protocol", chosen),
            ],
        })
    }

    pub(super) fn websocket_route(
        request: &HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Result<(i32, AccountNumber, HttpReply), HttpReply> {
        let Some(socket) = socket else {
            return Err(plain_reply(503, "x-webrtcsig requires a websocket socket"));
        };

        let Some(user) = user else {
            return Err(plain_reply(
                401,
                "x-webrtcsig websocket requires authentication",
            ));
        };

        let Some(reply) = websocket_handshake(request) else {
            return Err(plain_reply(
                426,
                "x-webrtcsig /ws requires websocket subprotocol psibase.realtime.v1",
            ));
        };

        Ok((socket, user, reply))
    }

    fn turn_ice_servers_json() -> String {
        #[cfg(test)]
        {
            "[]".into()
        }
        #[cfg(not(test))]
        {
            XAdminWrapper::call_from(account!("x-webrtcsig")).turnIceServersJson()
        }
    }

    #[cfg_attr(not(feature = "rt-trace"), allow(dead_code))]
    fn server_frame_kind(frame: &ServerFrame) -> &'static str {
        match frame {
            ServerFrame::Welcome { .. } => "welcome",
            ServerFrame::Error { .. } => "error",
            ServerFrame::SessionInvite { .. } => "sessionInvite",
            ServerFrame::ParticipantJoined { .. } => "participantJoined",
            ServerFrame::ParticipantState { .. } => "participantState",
            ServerFrame::Signal { .. } => "signal",
            ServerFrame::SessionEnded { .. } => "sessionEnded",
            ServerFrame::Pong => "pong",
            ServerFrame::PresenceSnapshot { .. } => "presenceSnapshot",
            ServerFrame::Presence { .. } => "presence",
            ServerFrame::SessionSnapshot { .. } => "sessionSnapshot",
            ServerFrame::TransportLost { .. } => "transportLost",
        }
    }

    fn send_frame(socket: i32, frame: &ServerFrame) {
        let payload = encode_server_frame(frame).expect("server frame must serialize");
        xrtcsig_trace!(
            "[xrtcsig-trace] send sock={} kind={}\n",
            socket,
            server_frame_kind(frame),
        );
        XHttp::call().send(socket, payload.into_bytes(), WEBSOCKET_TEXT);
    }

    fn send_welcome(socket: i32, user: AccountNumber, server_time: i64) {
        let ice_servers = merged_ice_servers(&turn_ice_servers_json());
        send_frame(
            socket,
            &ServerFrame::Welcome {
                user: user.into(),
                server_time,
                ice_servers,
                // Plan B #6: active_sessions hint is added in B5; cold-start
                // welcome leaves it None.
                active_sessions: None,
            },
        );
    }

    fn send_protocol_error(socket: i32, err: ProtocolError) {
        send_frame(
            socket,
            &ServerFrame::Error {
                code: err.code().into(),
                reason: err.reason(),
                session_id: None,
            },
        );
    }

    fn send_sweep_frames(now: i64) {
        let frames = sweep_stale_sessions_tx(now);
        enqueue_peer_outbound_frames(now, frames);
    }

    /// Deliver any server frames queued for this socket on a prior recv where
    /// inline peer fanout would have aborted the action.
    fn flush_pending_outbound_for_socket(socket: i32) {
        for payload in take_pending_outbound_payloads_tx(socket) {
            let Ok(frame) = decode_server_frame_json(&payload) else {
                continue;
            };
            send_frame(socket, &frame);
        }
    }

    /// Send frames for the requesting socket immediately; queue peer targets so
    /// a dead peer socket cannot abort before the joiner receives its response.
    fn deliver_signaling_frames(requesting_socket: i32, frames: Vec<(i32, ServerFrame)>, now: i64) {
        let mut to_peers = Vec::new();
        for (target_socket, frame) in frames {
            if target_socket == requesting_socket {
                send_frame(requesting_socket, &frame);
            } else {
                to_peers.push((target_socket, frame));
            }
        }
        enqueue_peer_outbound_frames(now, to_peers);
    }

    fn enqueue_peer_outbound_frames(now: i64, frames: Vec<(i32, ServerFrame)>) {
        if frames.is_empty() {
            return;
        }
        enqueue_pending_outbound_frames_tx(frames, now);
    }

    fn handle_socket_cleanup(socket: i32) {
        let now = Transact::call().currentBlock().time.microseconds;
        // Drain ALL subjective state first (each call commits its own
        // subjective_tx). Doing all writes before any sends prevents zombie
        // rows from leaking into UserSessionTable / SocketSessionTable when a
        // later `send_frame` aborts on a peer socket whose tcp already died.
        let tear_down_frames = tear_down_signaling_for_dead_socket_tx(socket, now);
        let removed = remove_socket_session_tx(socket);
        let disconnect_fanout = removed.as_ref().map(|r| {
            disconnect_presence_fanout_tx(r.user, r.was_final_socket())
        });

        #[cfg(feature = "rt-trace")]
        {
            let teardown_targets: Vec<i32> =
                tear_down_frames.iter().map(|(s, _)| *s).collect();
            xrtcsig_trace!(
                "[xrtcsig-trace] cleanup-tear-down sock={} teardown_targets={:?}\n",
                socket,
                teardown_targets,
            );
        }
        for (peer_socket, frame) in tear_down_frames {
            send_frame(peer_socket, &frame);
        }

        let Some(removed) = removed else {
            xrtcsig_trace!("[xrtcsig-trace] cleanup-no-row sock={}\n", socket);
            return;
        };
        #[cfg(not(feature = "rt-trace"))]
        let _ = &removed;
        let Some(fanout) = disconnect_fanout else {
            return;
        };
        #[cfg(feature = "rt-trace")]
        {
            let disconnect_targets: Vec<i32> =
                fanout.peer_deltas.iter().map(|(s, _)| *s).collect();
            xrtcsig_trace!(
                "[xrtcsig-trace] cleanup-disconnect sock={} user={} final={} disconnect_targets={:?}\n",
                socket,
                removed.user,
                removed.was_final_socket(),
                disconnect_targets,
            );
        }
        for (peer_socket, frame) in fanout.peer_deltas {
            send_frame(peer_socket, &frame);
        }
    }

    /// HTTP/websocket entrypoint for the realtime signaling service.
    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-webrtcsig serveSys must be called by x-http",
        );

        match route_target(&request) {
            RouteTarget::Login => {
                let user = authenticated_user(&request);
                return rtransact_login(request, socket, user);
            }
            RouteTarget::NotFound => {
                return Some(plain_reply(
                    404,
                    "x-webrtcsig endpoints are /login and /ws",
                ));
            }
            RouteTarget::WebSocket => {}
        }

        let user = authenticated_user(&request);
        let (socket, user, reply) = match websocket_route(&request, socket, user) {
            Ok(accepted) => accepted,
            Err(reply) => return Some(reply),
        };

        XHttp::call().accept(socket, reply);
        XHttp::call().setCallback(
            socket,
            MethodNumber::from("recv"),
            MethodNumber::from("close"),
        );
        let now = Transact::call().currentBlock().time.microseconds;
        upsert_session_tx(socket, user, now);
        send_welcome(socket, user, now);
        let fanout = connect_presence_fanout_tx(user);
        #[cfg(feature = "rt-trace")]
        {
            let peer_targets: Vec<i32> =
                fanout.peer_deltas.iter().map(|(s, _)| *s).collect();
            xrtcsig_trace!(
                "[xrtcsig-trace] accept sock={} user={} peer_delta_targets={:?}\n",
                socket,
                user,
                peer_targets,
            );
        }
        send_frame(socket, &fanout.snapshot);
        enqueue_peer_outbound_frames(now, fanout.peer_deltas);
        // Sweep after responding to the new connection so a dead peer socket
        // cannot abort before welcome / presence delivery.
        send_sweep_frames(now);
        flush_pending_outbound_for_socket(socket);
        None
    }

    #[action]
    fn recv(socket: i32, data: Vec<u8>, flags: u32) {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-webrtcsig recv must be called by x-http",
        );

        if flags != WEBSOCKET_TEXT {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame(
                    "x-webrtcsig only accepts websocket text frames".into(),
                ),
            );
            return;
        }

        let session = socket_session_tx(socket);
        let Some(session) = session else {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame("socket is not an active x-webrtcsig session".into()),
            );
            return;
        };

        let frame = match parse_client_frame(&data) {
            Ok(frame) => frame,
            Err(err) => {
                send_protocol_error(socket, err);
                return;
            }
        };

        if let Err(err) = validate_client_frame(&frame) {
            send_protocol_error(socket, err);
            return;
        }

        let now = Transact::call().currentBlock().time.microseconds;
        let user = session.user;

        #[cfg(feature = "rt-trace")]
        let frame_kind: &'static str = match &frame {
            ClientFrame::ClientReady { .. } => "clientReady",
            ClientFrame::Ping => "ping",
            ClientFrame::JoinSession { .. } => "joinSession",
            ClientFrame::Signal { .. } => "signal",
            ClientFrame::LeaveSession { .. } => "leaveSession",
            ClientFrame::ParticipantState { .. } => "participantState",
        };
        #[cfg(feature = "rt-trace")]
        xrtcsig_trace!(
            "[xrtcsig-trace] recv sock={} user={} frame={}\n",
            socket,
            user,
            frame_kind,
        );

        match frame {
            ClientFrame::ClientReady {
                client_instance_id,
                active,
                visible,
                supports,
            } => {
                if !store_client_ready_tx(
                    socket,
                    now,
                    client_instance_id,
                    active,
                    visible,
                    supports,
                ) {
                    send_protocol_error(
                        socket,
                        ProtocolError::InvalidFrame(
                            "socket is not an active x-webrtcsig session".into(),
                        ),
                    );
                } else {
                    send_sweep_frames(now);
                    flush_pending_outbound_for_socket(socket);
                }
            }
            ClientFrame::Ping => {
                send_frame(socket, &ServerFrame::Pong);
                send_sweep_frames(now);
                flush_pending_outbound_for_socket(socket);
            }
            session_frame => {
                let dispatch =
                    dispatch_signaling_client_frame(socket, user, now, session_frame);
                #[cfg(feature = "rt-trace")]
                {
                    let dispatch_targets: Vec<i32> =
                        dispatch.frames.iter().map(|(s, _)| *s).collect();
                    xrtcsig_trace!(
                        "[xrtcsig-trace] recv-dispatch sock={} user={} frame={} targets={:?}\n",
                        socket,
                        user,
                        frame_kind,
                        dispatch_targets,
                    );
                }
                deliver_signaling_frames(socket, dispatch.frames, now);
                // Run stale-session sweep after the requesting socket has been
                // answered — same ordering contract as handle_socket_cleanup.
                send_sweep_frames(now);
                flush_pending_outbound_for_socket(socket);
            }
        }
    }

    #[action]
    fn close(socket: i32) {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-webrtcsig close must be called by x-http",
        );
        handle_socket_cleanup(socket);
    }

    #[action]
    fn errSys(socket: i32, reply: Option<HttpReply>) {
        let _ = reply;
        check(
            get_sender() == psibase::account!("x-http"),
            "x-webrtcsig errSys must be called by x-http",
        );
        handle_socket_cleanup(socket);
    }
}

#[cfg(test)]
mod tests {
    use super::protocol::{
        encode_server_frame, parse_client_frame, validate_client_frame, ClientFrame,
        ProtocolError, ServerFrame, REALTIME_SUBPROTOCOL_V1,
    };
    use super::service::{
        accept_key, bearer_subprotocol_token, header_contains, route_target, websocket_handshake,
        websocket_key, websocket_route, RouteTarget,
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
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
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
            ice_servers: super::ice_config::default_stun_ice_server_configs(),
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
            host: "x-webrtcsig.test".into(),
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
}
