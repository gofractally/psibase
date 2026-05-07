pub mod protocol;
pub mod state;

mod call_signaling;

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
            unimplemented!()
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

#[psibase::service(name = "x-pslack", tables = "state::tables")]
#[allow(non_snake_case)]
mod service {
    use crate::protocol::{
        encode_server_frame, merged_v2_ice_servers_frame, parse_client_frame,
        validate_client_frame, ClientFrame, ContactPresence, Conversation, ConversationKind,
        PresenceStatus, ProtocolError, PSLACK_SUBPROTOCOL_V1, PSLACK_SUBPROTOCOL_V2, ServerFrame,
    };
    use crate::r_transact::Wrapper as RTransact;
    use crate::state::tables::SocketSessionRow;
    use crate::state::{
        conversations_for_user, dm_members, ensure_sender_is_member, group_members, members_of,
        mark_targeted_message_delivered, next_server_msg_id, open_conversation,
        sessions_for_user, socket_session, targeted_message_was_delivered, upsert_socket_session,
        StateError, CONVERSATION_KIND_DM, CONVERSATION_KIND_GROUP,
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    #[cfg(not(test))]
    use psibase::services::x_admin::Wrapper as XAdminWrapper;
    use psibase::services::x_http::Wrapper as XHttp;
    use psibase::{
        account, check, get_sender, services::transact::Wrapper as Transact, AccountNumber,
        ExactAccountNumber, HttpHeader, HttpReply, HttpRequest, MethodNumber,
    };
    use sha1::{Digest, Sha1};

    const PSLACK_AUTH_SUBPROTOCOL_PREFIX: &str = "psibase.bearer.";
    const WEBSOCKET_TEXT: u32 = 1;

    fn plain_reply(status: u16, message: &str) -> HttpReply {
        HttpReply {
            status,
            contentType: "text/plain".into(),
            body: message.as_bytes().to_vec().into(),
            headers: Vec::new(),
        }
    }

    fn rtransact_login(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<psibase::AccountNumber>,
    ) -> Option<HttpReply> {
        RTransact::call_from(account!("http-server")).serveSys(request, socket, user)
    }

    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum RouteTarget {
        Login,
        WebSocket,
        NotFound,
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
            .find_map(|value| value.strip_prefix(PSLACK_AUTH_SUBPROTOCOL_PREFIX))
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

    fn negotiate_pslack_subprotocol(request: &HttpRequest) -> Option<&'static str> {
        let mut tokens: Vec<&str> = Vec::new();
        for header in request.headers.iter().filter(|h| h.matches("Sec-WebSocket-Protocol")) {
            for part in header.value.split(',') {
                tokens.push(part.trim());
            }
        }

        for t in tokens.iter().copied() {
            if t.eq_ignore_ascii_case(PSLACK_SUBPROTOCOL_V2) {
                return Some(PSLACK_SUBPROTOCOL_V2);
            }
        }
        for t in tokens.iter().copied() {
            if t.eq_ignore_ascii_case(PSLACK_SUBPROTOCOL_V1) {
                return Some(PSLACK_SUBPROTOCOL_V1);
            }
        }
        None
    }

    pub(super) fn websocket_handshake(request: &HttpRequest) -> Option<(HttpReply, u8)> {
        let key = websocket_key(request)?;
        let chosen = negotiate_pslack_subprotocol(request)?;
        let protocol_major = if chosen == PSLACK_SUBPROTOCOL_V2 { 2u8 } else { 1u8 };

        Some((
            HttpReply {
                status: 101,
                contentType: String::new(),
                body: Vec::new().into(),
                headers: vec![
                    HttpHeader::new("Upgrade", "websocket"),
                    HttpHeader::new("Connection", "Upgrade"),
                    HttpHeader::new("Sec-WebSocket-Accept", &accept_key(key)),
                    HttpHeader::new("Sec-WebSocket-Protocol", chosen),
                ],
            },
            protocol_major,
        ))
    }

    pub(super) fn websocket_route(
        request: &HttpRequest,
        socket: Option<i32>,
        user: Option<psibase::AccountNumber>,
    ) -> Result<(i32, psibase::AccountNumber, HttpReply, u8), HttpReply> {
        let Some(socket) = socket else {
            return Err(plain_reply(503, "x-pslack requires a websocket socket"));
        };

        let Some(user) = user else {
            return Err(plain_reply(401, "x-pslack websocket requires authentication"));
        };

        let Some((reply, protocol_major)) = websocket_handshake(request) else {
            return Err(plain_reply(
                426,
                "x-pslack /ws requires websocket subprotocol psibase.pslack.v1 or psibase.pslack.v2",
            ));
        };

        Ok((socket, user, reply, protocol_major))
    }

    fn send_frame(socket: i32, frame: &ServerFrame) {
        let payload = encode_server_frame(frame).expect("server frame must serialize");
        XHttp::call().send(socket, payload.into_bytes(), WEBSOCKET_TEXT);
    }

    fn send_welcome(socket: i32, user: psibase::AccountNumber, server_time: i64) {
        send_frame(
            socket,
            &ServerFrame::Welcome {
                user: user.into(),
                server_time,
            },
        );
    }

    fn maybe_send_v2_ice_servers(socket: i32, protocol_major: u8) {
        if protocol_major != 2 {
            return;
        }
        #[cfg(test)]
        let frame = merged_v2_ice_servers_frame("[]");
        #[cfg(not(test))]
        let frame = {
            let turn_json = XAdminWrapper::call_from(account!("x-pslack")).pslackTurnIceServersJson();
            merged_v2_ice_servers_frame(&turn_json)
        };
        send_frame(socket, &frame);
    }

    fn send_call_not_implemented(socket: i32, frame: ClientFrame) {
        let (call_id, conversation_id) = frame.call_error_context();
        send_frame(
            socket,
            &ServerFrame::CallError {
                code: "not-implemented".into(),
                reason: "call signaling is not implemented in this milestone".into(),
                call_id,
                conversation_id,
            },
        );
    }

    fn send_protocol_error(socket: i32, err: ProtocolError, conversation_id: Option<String>) {
        send_frame(
            socket,
            &ServerFrame::Error {
                code: err.code().into(),
                reason: err.reason(),
                conversation_id,
                client_msg_id: None,
                to: None,
            },
        );
    }

    fn send_state_error(socket: i32, err: StateError, conversation_id: Option<String>) {
        let reason = match &err {
            StateError::InvalidMemberSet(s)
            | StateError::UnknownConversation(s)
            | StateError::NotMember(s) => s.clone(),
        };
        send_frame(
            socket,
            &ServerFrame::Error {
                code: err.wire_code().into(),
                reason,
                conversation_id,
                client_msg_id: None,
                to: None,
            },
        );
    }

    fn conversation_kind(kind: u8) -> ConversationKind {
        match kind {
            CONVERSATION_KIND_DM => ConversationKind::Dm,
            CONVERSATION_KIND_GROUP => ConversationKind::Group,
            _ => ConversationKind::Group,
        }
    }

    fn conversation_frame(
        conversation_id: String,
        kind: u8,
        members: Vec<AccountNumber>,
    ) -> ServerFrame {
        ServerFrame::Conversation {
            conversation_id,
            kind: conversation_kind(kind),
            members: members.into_iter().map(ExactAccountNumber::from).collect(),
        }
    }

    fn sync_frame(user: AccountNumber) -> ServerFrame {
        let conversations: Vec<_> = conversations_for_user(user)
            .into_iter()
            .map(|conversation| Conversation {
                conversation_id: conversation.conversation_id.clone(),
                kind: conversation_kind(conversation.kind),
                members: members_of(&conversation.conversation_id)
                    .into_iter()
                    .map(ExactAccountNumber::from)
                    .collect(),
            })
            .collect();

        let contacts = conversations
            .iter()
            .flat_map(|conversation| conversation.members.iter().copied())
            .filter(|account| account.value != user.value)
            .map(|account| account.value)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .map(|account_value| {
                let account = AccountNumber::from(account_value);
                ContactPresence {
                    account: account.into(),
                    presence: if sessions_for_user(account).is_empty() {
                        PresenceStatus::Offline
                    } else {
                        PresenceStatus::Online
                    },
                }
            })
            .collect();

        ServerFrame::Sync {
            contacts,
            conversations,
        }
    }

    fn snapshot_member_sockets(members: &[AccountNumber]) -> Vec<i32> {
        members
            .iter()
            .flat_map(|member| sessions_for_user(*member))
            .collect()
    }

    fn fanout_presence(user: AccountNumber, status: PresenceStatus) {
        let frame = crate::state::tx_presence_frame(user, status);
        let sockets = crate::state::tx_presence_subscriber_sockets(user);
        for s in sockets {
            send_frame(s, &frame);
        }
    }

    fn handle_socket_cleanup(socket: i32) {
        let now = Transact::call().currentBlock().time.microseconds;
        for (s, frame) in crate::call_signaling::tear_down_call_for_dead_socket(socket, now) {
            send_frame(s, &frame);
        }

        let removed = crate::state::tx_remove_socket_session(socket);
        let Some(removed) = removed else {
            return;
        };
        let status = if removed.was_final_socket() {
            PresenceStatus::Offline
        } else {
            PresenceStatus::Online
        };
        fanout_presence(removed.user, status);
    }

    fn subjective_socket_session(socket: i32) -> Option<SocketSessionRow> {
        ::psibase::subjective_tx! {
            let row = socket_session(socket);
            row
        }
    }

    fn subjective_upsert_session(
        socket: i32,
        user: AccountNumber,
        now: i64,
        protocol_major: u8,
    ) -> bool {
        ::psibase::subjective_tx! {
            upsert_socket_session(socket, user, now, protocol_major)
        }
    }

    fn subjective_sync_frame(user: AccountNumber) -> ServerFrame {
        ::psibase::subjective_tx! {
            let frame = sync_frame(user);
            frame
        }
    }

    fn subjective_open_conversation_frame(
        members: Vec<AccountNumber>,
        now: i64,
    ) -> Result<ServerFrame, StateError> {
        ::psibase::subjective_tx! {
            let out: Result<ServerFrame, StateError> =
                match open_conversation(members.clone(), now) {
                    Ok(conversation) => {
                        let members = members_of(&conversation.conversation_id);
                        Ok(conversation_frame(
                            conversation.conversation_id,
                            conversation.kind,
                            members,
                        ))
                    }
                    Err(err) => Err(err),
                };
            out
        }
    }

    fn subjective_prepare_say(
        conversation_id: String,
        sender: AccountNumber,
        body: String,
        client_msg_id: String,
        client_time: Option<i64>,
        to: Option<AccountNumber>,
        now: i64,
    ) -> Result<(Vec<i32>, ServerFrame), StateError> {
        ::psibase::subjective_tx! {
            let out: Result<(Vec<i32>, ServerFrame), StateError> =
                match ensure_sender_is_member(&conversation_id, sender) {
                    Err(err) => Err(err),
                    Ok(()) => {
                        let recipient_sockets: Result<Vec<i32>, StateError> = if let Some(target) = to {
                            if !crate::state::is_conversation_member(&conversation_id, target) {
                                Err(StateError::NotMember(format!(
                                    "target account is not a member of conversation {conversation_id}"
                                )))
                            } else {
                                let mut sockets = Vec::new();
                                if targeted_message_was_delivered(&conversation_id, &client_msg_id, target) {
                                    sockets.extend(sessions_for_user(sender));
                                } else {
                                    let target_sockets = sessions_for_user(target);
                                    if !target_sockets.is_empty() {
                                        mark_targeted_message_delivered(&conversation_id, &client_msg_id, target);
                                        sockets.extend(sessions_for_user(sender));
                                        sockets.extend(target_sockets);
                                    }
                                }
                                Ok(sockets)
                            }
                        } else {
                            let members = members_of(&conversation_id);
                            Ok(snapshot_member_sockets(&members))
                        };
                        let recipient_sockets = recipient_sockets?;
                        let server_msg_id = next_server_msg_id();
                        Ok((
                            recipient_sockets,
                            ServerFrame::Message {
                                conversation_id: conversation_id.clone(),
                                from: sender.into(),
                                body: body.clone(),
                                server_msg_id,
                                server_time: now,
                                client_msg_id: Some(client_msg_id.clone()),
                                client_time,
                                to: to.map(ExactAccountNumber::from),
                            },
                        ))
                    }
                };
            out
        }
    }

    fn subjective_prepare_ack(
        conversation_id: String,
        sender: AccountNumber,
        server_msg_id: u64,
    ) -> Result<(Vec<i32>, ServerFrame), StateError> {
        ::psibase::subjective_tx! {
            let out: Result<(Vec<i32>, ServerFrame), StateError> =
                match ensure_sender_is_member(&conversation_id, sender) {
                    Err(err) => Err(err),
                    Ok(()) => {
                        let members = members_of(&conversation_id);
                        let recipient_sockets = snapshot_member_sockets(&members);
                        Ok((
                            recipient_sockets,
                            ServerFrame::Delivered {
                                conversation_id: conversation_id.clone(),
                                server_msg_id,
                                to: sender.into(),
                            },
                        ))
                    }
                };
            out
        }
    }

    fn handle_open_conversation(
        socket: i32,
        sender: AccountNumber,
        members: Vec<AccountNumber>,
        now: i64,
    ) {
        match subjective_open_conversation_frame(members.clone(), now) {
            Ok(frame) => {
                send_frame(socket, &frame);
                let is_group = matches!(
                    &frame,
                    ServerFrame::Conversation {
                        kind: ConversationKind::Group,
                        ..
                    }
                );
                let presence = crate::state::tx_presence_frame_after_open(sender);
                let other_members: Vec<AccountNumber> =
                    members.into_iter().filter(|m| *m != sender).collect();
                let target_sockets =
                    crate::state::tx_snapshot_sockets_for_accounts(other_members);
                for s in target_sockets {
                    if is_group {
                        send_frame(s, &frame);
                    }
                    send_frame(s, &presence);
                }
            }
            Err(err) => send_state_error(socket, err, None),
        }
    }

    fn handle_say(
        socket: i32,
        sender: AccountNumber,
        conversation_id: String,
        body: String,
        client_msg_id: String,
        client_time: Option<i64>,
        to: Option<AccountNumber>,
        now: i64,
    ) {
        let conv_for_err = conversation_id.clone();
        match subjective_prepare_say(conversation_id, sender, body, client_msg_id, client_time, to, now) {
            Err(err) => send_state_error(socket, err, Some(conv_for_err)),
            Ok((recipient_sockets, frame)) => {
                for recipient_socket in recipient_sockets {
                    send_frame(recipient_socket, &frame);
                }
            }
        }
    }

    fn handle_ack(
        socket: i32,
        sender: AccountNumber,
        conversation_id: String,
        server_msg_id: u64,
    ) {
        let conv_for_err = conversation_id.clone();
        match subjective_prepare_ack(conversation_id, sender, server_msg_id) {
            Err(err) => send_state_error(socket, err, Some(conv_for_err)),
            Ok((recipient_sockets, frame)) => {
                for recipient_socket in recipient_sockets {
                    send_frame(recipient_socket, &frame);
                }
            }
        }
    }

    /// HTTP/websocket entrypoint for the local chat signaling service.
    ///
    /// Pattern notes for reviewers: XPeers contains the richer local websocket
    /// lifecycle; WSEcho is the smallest accept/recv/close callback example.
    /// The Rust package/service Cargo split mirrors existing service packages
    /// such as FractalGen and FractalTester.
    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-pslack serveSys must be called by x-http",
        );

        match route_target(&request) {
            RouteTarget::Login => {
                let user = RTransact::call().getUser(request.clone());
                return rtransact_login(request, socket, user);
            }
            RouteTarget::NotFound => {
                return Some(plain_reply(404, "x-pslack endpoints are /login and /ws"));
            }
            RouteTarget::WebSocket => {}
        }

        let user = authenticated_user(&request);
        let (socket, user, reply, protocol_major) =
            match websocket_route(&request, socket, user) {
                Ok(accepted) => accepted,
                Err(reply) => return Some(reply),
            };

        XHttp::call().accept(socket, reply);
        XHttp::call().setCallback(socket, MethodNumber::from("recv"), MethodNumber::from("close"));
        let now = Transact::call().currentBlock().time.microseconds;
        subjective_upsert_session(socket, user, now, protocol_major);
        send_welcome(socket, user, now);
        maybe_send_v2_ice_servers(socket, protocol_major);
        fanout_presence(user, PresenceStatus::Online);
        None
    }

    /// Websocket receive callback stub.
    #[action]
    fn recv(socket: i32, data: Vec<u8>, flags: u32) {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-pslack recv must be called by x-http",
        );

        if flags != WEBSOCKET_TEXT {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame("x-pslack only accepts websocket text frames".into()),
                None,
            );
            return;
        }

        let session = subjective_socket_session(socket);
        let Some(session) = session else {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame("socket is not an active x-pslack session".into()),
                None,
            );
            return;
        };
        let current_user: ExactAccountNumber = session.user.into();

        let frame = match parse_client_frame(&data) {
            Ok(frame) => frame,
            Err(err) => {
                send_protocol_error(socket, err, None);
                return;
            }
        };

        if let Err(err) = validate_client_frame(&frame, current_user) {
            send_protocol_error(socket, err, None);
            return;
        }

        let now = Transact::call().currentBlock().time.microseconds;
        for (s, frame_out) in crate::call_signaling::sweep_stale_ringing_calls(now) {
            send_frame(s, &frame_out);
        }

        match frame {
            ClientFrame::Sync { .. } => {
                let sync_payload = subjective_sync_frame(session.user);
                send_frame(socket, &sync_payload);
            }
            ClientFrame::OpenDm { member } => {
                match dm_members(session.user, AccountNumber::from(member.value)) {
                    Ok(members) => handle_open_conversation(socket, session.user, members, now),
                    Err(err) => send_state_error(socket, err, None),
                }
            }
            ClientFrame::OpenGroup { members } => {
                let members = members
                    .into_iter()
                    .map(|member| AccountNumber::from(member.value));
                match group_members(session.user, members) {
                    Ok(members) => handle_open_conversation(socket, session.user, members, now),
                    Err(err) => send_state_error(socket, err, None),
                }
            }
            ClientFrame::Say {
                conversation_id,
                body,
                client_msg_id,
                client_time,
                to,
            } => handle_say(
                socket,
                session.user,
                conversation_id,
                body,
                client_msg_id,
                client_time,
                to.map(|account| AccountNumber::from(account.value)),
                now,
            ),
            ClientFrame::Ack {
                conversation_id,
                server_msg_id,
            } => handle_ack(socket, session.user, conversation_id, server_msg_id),
            ClientFrame::Ping => send_frame(socket, &ServerFrame::Pong),
            ClientFrame::Signal { .. } => unreachable!("signal is rejected by validation"),
            ClientFrame::CallInvite { .. }
            | ClientFrame::CallAccept { .. }
            | ClientFrame::CallDecline { .. }
            | ClientFrame::CallHangup { .. }
            | ClientFrame::CallOffer { .. }
            | ClientFrame::CallAnswer { .. }
            | ClientFrame::CallCandidate { .. }
            | ClientFrame::CallMediaState { .. } => {
                if session.protocol_major != 2 {
                    send_call_not_implemented(socket, frame);
                } else {
                    for (s, frame_out) in crate::call_signaling::dispatch_call_client_frame(
                        socket,
                        session.user,
                        now,
                        frame,
                    ) {
                        send_frame(s, &frame_out);
                    }
                }
            }
        }
    }

    #[action]
    fn close(socket: i32) {
        check(
            get_sender() == psibase::account!("x-http"),
            "x-pslack close must be called by x-http",
        );
        handle_socket_cleanup(socket);
    }

    /// Outbound websocket error callback: best-effort subjective cleanup matching [`close`].
    #[action]
    fn errSys(socket: i32, reply: Option<HttpReply>) {
        let _ = reply;
        check(
            get_sender() == psibase::account!("x-http"),
            "x-pslack errSys must be called by x-http",
        );
        handle_socket_cleanup(socket);
    }
}

#[cfg(test)]
mod tests {
    use super::protocol::{
        canonical_group_members, encode_server_frame, parse_client_frame, validate_client_frame,
        CallTimelineEventKind, ClientFrame, IceServerUrls, IceServerConfig, PresenceStatus,
        ProtocolError, ServerFrame,
    };
    use super::service::{
        accept_key, bearer_subprotocol_token, header_contains, route_target, websocket_handshake,
        websocket_key, websocket_route, RouteTarget,
    };
    use super::state::{
        canonical_conversation_members, canonical_conversation_members_with_sender,
        conversation_id_for_members, dm_members, group_members, remove_socket_from_index,
        sender_is_member, RemovedSocket, StateError,
    };
    use psibase::MethodNumber;
    use psibase::{AccountNumber, ExactAccountNumber, HttpHeader, HttpRequest};
    use std::collections::BTreeMap;

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
    fn serializes_presence_frame_with_socket_count() {
        let frame = ServerFrame::Presence {
            account: account("alice"),
            status: PresenceStatus::Online,
            socket_count: Some(2),
        };
        assert_eq!(
            encode_server_frame(&frame).unwrap(),
            r#"{"t":"presence","account":"alice","status":"online","socketCount":2}"#
        );
    }

    #[test]
    fn removed_socket_final_flag_matches_remaining_sessions() {
        let alice = state_account("alice");
        assert!(
            RemovedSocket {
                socket: 1,
                user: alice,
                remaining_sockets: vec![],
            }
            .was_final_socket()
        );
        assert!(
            !RemovedSocket {
                socket: 1,
                user: alice,
                remaining_sockets: vec![2],
            }
            .was_final_socket()
        );
    }

    #[test]
    fn derives_rfc6455_websocket_accept_key() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn header_contains_matches_case_insensitive_comma_separated_tokens() {
        let request = http_request(
            "GET",
            "/ws",
            vec![
                HttpHeader::new("Connection", "keep-alive, Upgrade"),
                HttpHeader::new("Sec-WebSocket-Protocol", "chat, psibase.pslack.v1"),
            ],
        );

        assert!(header_contains(&request, "connection", "upgrade"));
        assert!(header_contains(
            &request,
            "Sec-WebSocket-Protocol",
            "psibase.pslack.v1"
        ));
        assert!(!header_contains(&request, "Connection", "websocket"));
    }

    #[test]
    fn extracts_bearer_token_from_websocket_subprotocols() {
        let request = http_request(
            "GET",
            "/ws",
            vec![HttpHeader::new(
                "Sec-WebSocket-Protocol",
                "psibase.pslack.v1, psibase.bearer.header.payload.signature",
            )],
        );
        assert_eq!(
            bearer_subprotocol_token(&request),
            Some("header.payload.signature")
        );

        let missing = http_request(
            "GET",
            "/ws",
            vec![HttpHeader::new(
                "Sec-WebSocket-Protocol",
                "psibase.pslack.v1, psibase.bearer.",
            )],
        );
        assert_eq!(bearer_subprotocol_token(&missing), None);
    }

    #[test]
    fn websocket_key_requires_get_upgrade_version_and_valid_nonce() {
        let request = websocket_request(vec![]);
        assert_eq!(websocket_key(&request), Some("dGhlIHNhbXBsZSBub25jZQ=="));

        let post = http_request("POST", "/ws", websocket_headers(vec![]));
        assert_eq!(websocket_key(&post), None);

        let missing_upgrade = http_request(
            "GET",
            "/ws",
            websocket_headers(vec![("Upgrade", "not-websocket")]),
        );
        assert_eq!(websocket_key(&missing_upgrade), None);

        let invalid_version = http_request(
            "GET",
            "/ws",
            websocket_headers(vec![("Sec-WebSocket-Version", "12")]),
        );
        assert_eq!(websocket_key(&invalid_version), None);

        let invalid_nonce = http_request(
            "GET",
            "/ws",
            websocket_headers(vec![("Sec-WebSocket-Key", "c2hvcnQ=")]),
        );
        assert_eq!(websocket_key(&invalid_nonce), None);
    }

    #[test]
    fn websocket_handshake_requires_pslack_subprotocol_and_returns_101() {
        let request = websocket_request(vec![]);
        let (reply, major) = websocket_handshake(&request).expect("valid pslack websocket handshake");

        assert_eq!(reply.status, 101);
        assert_eq!(major, 1);
        assert_eq!(
            reply_header(&reply, "Sec-WebSocket-Accept"),
            Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        );
        assert_eq!(
            reply_header(&reply, "Sec-WebSocket-Protocol"),
            Some("psibase.pslack.v1")
        );

        let wrong_subprotocol = http_request(
            "GET",
            "/ws",
            websocket_headers(vec![("Sec-WebSocket-Protocol", "chat")]),
        );
        assert!(websocket_handshake(&wrong_subprotocol).is_none());
    }

    #[test]
    fn websocket_handshake_prefers_v2_when_offered() {
        let request = websocket_request(vec![(
            "Sec-WebSocket-Protocol",
            "psibase.pslack.v2, psibase.pslack.v1",
        )]);
        let (reply, major) = websocket_handshake(&request).expect("v2 handshake");

        assert_eq!(major, 2);
        assert_eq!(
            reply_header(&reply, "Sec-WebSocket-Protocol"),
            Some("psibase.pslack.v2")
        );
    }

    #[test]
    fn routes_login_ws_and_unknown_targets() {
        assert_eq!(
            route_target(&http_request("GET", "/login?return_to=/pslack", vec![])),
            RouteTarget::Login
        );
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
    fn websocket_route_returns_focused_http_errors_before_accepting() {
        let request = websocket_request(vec![]);
        let user = state_account("alice");

        let reply = match websocket_route(&request, None, Some(user)) {
            Err(reply) => reply,
            Ok(_) => panic!("missing socket should not accept"),
        };
        assert_eq!(reply.status, 503);

        let reply = match websocket_route(&request, Some(7), None) {
            Err(reply) => reply,
            Ok(_) => panic!("unauthenticated user should not accept"),
        };
        assert_eq!(reply.status, 401);

        let bad_handshake = websocket_request(vec![("Sec-WebSocket-Protocol", "chat")]);
        let reply = match websocket_route(&bad_handshake, Some(7), Some(user)) {
            Err(reply) => reply,
            Ok(_) => panic!("bad handshake should not accept"),
        };
        assert_eq!(reply.status, 426);

        let (socket, accepted_user, reply, protocol_major) =
            match websocket_route(&request, Some(7), Some(user)) {
                Ok(accepted) => accepted,
                Err(reply) => panic!("valid handshake failed with {}", reply.status),
            };
        assert_eq!(socket, 7);
        assert_eq!(accepted_user, user);
        assert_eq!(reply.status, 101);
        assert_eq!(protocol_major, 1);
    }

    #[test]
    fn parses_required_client_frame_variants_by_t_discriminator() {
        for (json, expected) in [
            (
                r#"{"t":"sync","knownConversationIds":["dm:alice:bob"]}"#,
                ClientFrame::Sync {
                    known_conversation_ids: vec!["dm:alice:bob".into()],
                },
            ),
            (
                r#"{"t":"openDm","member":"bob"}"#,
                ClientFrame::OpenDm {
                    member: account("bob"),
                },
            ),
            (
                r#"{"t":"openGroup","members":["bob","carol"]}"#,
                ClientFrame::OpenGroup {
                    members: vec![account("bob"), account("carol")],
                },
            ),
            (
                r#"{"t":"say","conversationId":"c1","body":"hello","clientMsgId":"m1"}"#,
                ClientFrame::Say {
                    conversation_id: "c1".into(),
                    body: "hello".into(),
                    client_msg_id: "m1".into(),
                    client_time: None,
                    to: None,
                },
            ),
            (
                r#"{"t":"ack","conversationId":"c1","serverMsgId":7}"#,
                ClientFrame::Ack {
                    conversation_id: "c1".into(),
                    server_msg_id: 7,
                },
            ),
            (
                r#"{"t":"ping"}"#,
                ClientFrame::Ping,
            ),
            (
                r#"{"t":"callInvite","conversationId":"c1","wantVideo":true,"wantAudio":true,"clientCallId":"cc"}"#,
                ClientFrame::CallInvite {
                    conversation_id: "c1".into(),
                    want_video: true,
                    want_audio: true,
                    client_call_id: "cc".into(),
                },
            ),
            (
                r#"{"t":"callAccept","callId":"x"}"#,
                ClientFrame::CallAccept {
                    call_id: "x".into(),
                },
            ),
            (
                r#"{"t":"callDecline","callId":"x","reason":"busy"}"#,
                ClientFrame::CallDecline {
                    call_id: "x".into(),
                    reason: Some("busy".into()),
                },
            ),
            (
                r#"{"t":"callOffer","callId":"x","sdp":"v=0"}"#,
                ClientFrame::CallOffer {
                    call_id: "x".into(),
                    sdp: "v=0".into(),
                },
            ),
            (
                r#"{"t":"callAnswer","callId":"x","sdp":"v=0"}"#,
                ClientFrame::CallAnswer {
                    call_id: "x".into(),
                    sdp: "v=0".into(),
                },
            ),
            (
                r#"{"t":"callCandidate","callId":"x","candidate":"cand","sdpMid":"0","sdpMLineIndex":0}"#,
                ClientFrame::CallCandidate {
                    call_id: "x".into(),
                    candidate: Some("cand".into()),
                    sdp_mid: Some("0".into()),
                    sdp_mline_index: Some(0),
                },
            ),
            (
                r#"{"t":"callCandidate","callId":"x","candidate":null}"#,
                ClientFrame::CallCandidate {
                    call_id: "x".into(),
                    candidate: None,
                    sdp_mid: None,
                    sdp_mline_index: None,
                },
            ),
            (
                r#"{"t":"callMediaState","callId":"x","audioMuted":true,"videoMuted":false}"#,
                ClientFrame::CallMediaState {
                    call_id: "x".into(),
                    audio_muted: true,
                    video_muted: false,
                },
            ),
            (
                r#"{"t":"callHangup","callId":"x","reason":"user"}"#,
                ClientFrame::CallHangup {
                    call_id: "x".into(),
                    reason: Some("user".into()),
                },
            ),
        ] {
            assert_eq!(parse_client_frame(json.as_bytes()).unwrap(), expected);
        }
    }

    #[test]
    fn serializes_server_frame_variants_by_t_discriminator() {
        let frames = [
            (
                ServerFrame::Welcome {
                    user: account("alice"),
                    server_time: 42,
                },
                r#"{"t":"welcome","user":"alice","serverTime":42}"#,
            ),
            (ServerFrame::Pong, r#"{"t":"pong"}"#),
            (
                ServerFrame::Error {
                    code: "bad-frame".into(),
                    reason: "bad request".into(),
                    conversation_id: Some("c1".into()),
                    client_msg_id: None,
                    to: None,
                },
                r#"{"t":"error","code":"bad-frame","reason":"bad request","conversationId":"c1"}"#,
            ),
            (
                ServerFrame::CallEvent {
                    conversation_id: "c1".into(),
                    call_id: Some("cid".into()),
                    event: CallTimelineEventKind::Started,
                    actor: Some(account("alice")),
                    reason: None,
                    duration_ms: None,
                    server_msg_id: 3,
                    server_time: 99,
                },
                r#"{"t":"callEvent","conversationId":"c1","callId":"cid","event":"started","actor":"alice","serverMsgId":3,"serverTime":99}"#,
            ),
            (
                ServerFrame::CallError {
                    code: "busy".into(),
                    reason: "in call".into(),
                    call_id: Some("x".into()),
                    conversation_id: Some("c1".into()),
                },
                r#"{"t":"callError","code":"busy","reason":"in call","callId":"x","conversationId":"c1"}"#,
            ),
            (
                ServerFrame::IceServers {
                    servers: vec![IceServerConfig {
                        urls: IceServerUrls::One("stun:stun.example:19302".into()),
                        username: None,
                        credential: None,
                    }],
                },
                r#"{"t":"iceServers","servers":[{"urls":"stun:stun.example:19302"}]}"#,
            ),
        ];

        for (frame, expected) in frames {
            assert_eq!(encode_server_frame(&frame).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_malformed_json_missing_fields_and_unknown_frame_types() {
        assert!(matches!(
            parse_client_frame(br#"{"t":"ping""#),
            Err(ProtocolError::MalformedJson(_))
        ));
        assert!(matches!(
            parse_client_frame(br#"{"t":"say","conversationId":"c1","body":"hello"}"#),
            Err(ProtocolError::InvalidFrame(_))
        ));
        assert_eq!(
            parse_client_frame(br#"{"t":"join","room":"general"}"#),
            Err(ProtocolError::UnknownFrameType("join".into()))
        );
    }

    #[test]
    fn validates_member_sets_for_dm_and_group_frames() {
        let alice = account("alice");
        let bob = account("bob");
        let carol = account("carol");

        assert!(validate_client_frame(&ClientFrame::OpenDm { member: bob }, alice).is_ok());
        assert!(matches!(
            validate_client_frame(&ClientFrame::OpenDm { member: alice }, alice),
            Err(ProtocolError::InvalidFrame(_))
        ));
        assert!(matches!(
            validate_client_frame(
                &ClientFrame::OpenGroup { members: vec![bob] },
                alice
            ),
            Err(ProtocolError::InvalidFrame(_))
        ));
        assert!(matches!(
            validate_client_frame(
                &ClientFrame::OpenGroup {
                    members: vec![bob, bob]
                },
                alice
            ),
            Err(ProtocolError::InvalidFrame(_))
        ));
        assert_eq!(
            canonical_group_members(alice, &[carol, bob]).unwrap(),
            vec![alice, bob, carol]
        );
    }

    #[test]
    fn treats_signal_as_reserved_after_schema_parsing() {
        let frame = parse_client_frame(
            br#"{"t":"signal","conversationId":"c1","to":"bob","payload":{"sdp":"later"}}"#,
        )
        .unwrap();

        assert!(matches!(
            validate_client_frame(&frame, account("alice")),
            Err(ProtocolError::ReservedSignal)
        ));
    }

    #[test]
    fn canonicalizes_members_by_sorting_and_deduplicating() {
        let alice = state_account("alice");
        let bob = state_account("bob");
        let carol = state_account("carol");

        assert_eq!(
            canonical_conversation_members([carol, alice, bob, alice, carol]),
            vec![alice, bob, carol]
        );
        assert_eq!(
            canonical_conversation_members_with_sender(alice, [carol, bob, alice]),
            vec![alice, bob, carol]
        );
        assert_eq!(dm_members(alice, bob).unwrap(), vec![alice, bob]);
        assert!(matches!(
            dm_members(alice, alice),
            Err(StateError::InvalidMemberSet(_))
        ));
        assert_eq!(
            group_members(alice, [carol, bob, bob]).unwrap(),
            vec![alice, bob, carol]
        );
    }

    #[test]
    fn derives_stable_conversation_ids_from_canonical_member_sets() {
        let alice = state_account("alice");
        let bob = state_account("bob");
        let carol = state_account("carol");
        let canonical = canonical_conversation_members([alice, bob, carol]);

        assert_eq!(
            conversation_id_for_members(&canonical).unwrap(),
            conversation_id_for_members(&canonical_conversation_members([carol, alice, bob]))
                .unwrap()
        );
        assert_ne!(
            conversation_id_for_members(&canonical).unwrap(),
            conversation_id_for_members(&canonical_conversation_members([alice, bob])).unwrap()
        );
    }

    #[test]
    fn sender_membership_checks_reject_missing_conversation_member() {
        let alice = state_account("alice");
        let bob = state_account("bob");
        let carol = state_account("carol");
        let members = canonical_conversation_members([alice, bob]);

        assert!(sender_is_member(&members, alice));
        assert!(!sender_is_member(&members, carol));
    }

    #[test]
    fn socket_removal_preserves_multi_socket_presence_until_final_socket() {
        let alice = state_account("alice");
        let bob = state_account("bob");
        let mut sessions = BTreeMap::from([(10, alice), (11, alice), (20, bob)]);

        assert_eq!(
            remove_socket_from_index(&mut sessions, 10),
            Some(RemovedSocket {
                socket: 10,
                user: alice,
                remaining_sockets: vec![11],
            })
        );
        assert_eq!(
            remove_socket_from_index(&mut sessions, 11),
            Some(RemovedSocket {
                socket: 11,
                user: alice,
                remaining_sockets: vec![],
            })
        );
        assert!(remove_socket_from_index(&mut sessions, 99).is_none());
    }

    #[test]
    fn fanout_model_collects_sockets_in_member_order() {
        let alice = state_account("alice");
        let bob = state_account("bob");
        let tab: &[(AccountNumber, &[i32])] = &[(alice, &[10, 11]), (bob, &[20])];
        let members = [alice, bob];
        let mut sockets: Vec<i32> = members
            .iter()
            .flat_map(|m| {
                tab.iter()
                    .find(|(a, _)| a == m)
                    .into_iter()
                    .flat_map(|(_, socks)| socks.iter().copied())
            })
            .collect();
        sockets.sort_unstable();
        assert_eq!(sockets, vec![10, 11, 20]);
    }

    #[test]
    fn protocol_errors_use_bad_frame_code_per_section_9() {
        assert_eq!(ProtocolError::MalformedJson("e".into()).code(), "bad-frame");
        assert_eq!(ProtocolError::InvalidFrame("e".into()).code(), "bad-frame");
        assert_eq!(ProtocolError::UnknownFrameType("e".into()).code(), "bad-frame");
        assert_eq!(ProtocolError::ReservedSignal.code(), "bad-frame");
    }

    #[test]
    fn state_errors_use_architecture_section_9_codes() {
        assert_eq!(
            StateError::InvalidMemberSet("m".into()).wire_code(),
            "bad-members"
        );
        assert_eq!(
            StateError::UnknownConversation("m".into()).wire_code(),
            "unknown-conversation"
        );
        assert_eq!(StateError::NotMember("m".into()).wire_code(), "not-member");
    }

    fn account(name: &str) -> ExactAccountNumber {
        name.parse().unwrap()
    }

    fn state_account(name: &str) -> AccountNumber {
        name.parse().unwrap()
    }

    #[test]
    fn collision_tie_breaker_lex_order() {
        use crate::state::cmp_call_invite_tuples;
        let alice = state_account("alice");
        let bob = state_account("bob");
        assert_eq!(
            cmp_call_invite_tuples(alice, bob, 1, bob, alice, 2),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            cmp_call_invite_tuples(bob, alice, 1, alice, bob, 2),
            std::cmp::Ordering::Greater
        );
        assert_eq!(
            cmp_call_invite_tuples(alice, bob, 5, alice, bob, 5),
            std::cmp::Ordering::Equal
        );
    }

    #[test]
    fn single_tab_socket_selection_is_stable() {
        use crate::state::stable_pick_callee_socket;
        assert_eq!(stable_pick_callee_socket(vec![99, 3, 50]), Some(3));
        assert_eq!(stable_pick_callee_socket(vec![]), None);
    }

    #[test]
    fn lazy_call_state_sweep_drops_stale_rows() {
        use crate::state::tables::ActiveCallRow;
        use crate::state::{
            stale_ringing_calls_for_sweep, CALL_PHASE_CONNECTED, CALL_PHASE_RINGING,
            STALE_RINGING_TTL_US,
        };
        let now = 10_000_000_000_i64;
        let rows = vec![
            ActiveCallRow {
                call_id: "old".into(),
                conversation_id: "c1".into(),
                caller: state_account("alice"),
                callee: state_account("bob"),
                caller_socket: 1,
                callee_socket: 2,
                created_at: 0,
                last_activity_at: now - STALE_RINGING_TTL_US - 1,
                phase: CALL_PHASE_RINGING,
                connected_at: 0,
            },
            ActiveCallRow {
                call_id: "fresh".into(),
                conversation_id: "c1".into(),
                caller: state_account("alice"),
                callee: state_account("bob"),
                caller_socket: 3,
                callee_socket: 4,
                created_at: 0,
                last_activity_at: now,
                phase: CALL_PHASE_RINGING,
                connected_at: 0,
            },
            ActiveCallRow {
                call_id: "connected".into(),
                conversation_id: "c1".into(),
                caller: state_account("alice"),
                callee: state_account("bob"),
                caller_socket: 5,
                callee_socket: 6,
                created_at: 0,
                last_activity_at: now - STALE_RINGING_TTL_US - 1,
                phase: CALL_PHASE_CONNECTED,
                connected_at: 1,
            },
        ];
        let out = stale_ringing_calls_for_sweep(now, &rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].call_id, "old");
    }

    #[test]
    fn pslack_validate_call_invite_rejects_empty_required_ids() {
        let alice = account("alice");
        assert!(validate_client_frame(
            &ClientFrame::CallInvite {
                conversation_id: "".into(),
                want_video: true,
                want_audio: true,
                client_call_id: "x".into(),
            },
            alice,
        )
        .is_err());
        assert!(validate_client_frame(
            &ClientFrame::CallInvite {
                conversation_id: "c1".into(),
                want_video: true,
                want_audio: true,
                client_call_id: "".into(),
            },
            alice,
        )
        .is_err());
    }

    #[test]
    fn call_event_schema_is_stable() {
        let frame = ServerFrame::CallEvent {
            conversation_id: "c:dm".into(),
            call_id: Some("call:x".into()),
            event: CallTimelineEventKind::Missed,
            actor: None,
            reason: Some("timeout".into()),
            duration_ms: None,
            server_msg_id: 7,
            server_time: 12345,
        };
        assert_eq!(
            encode_server_frame(&frame).unwrap(),
            r#"{"t":"callEvent","conversationId":"c:dm","callId":"call:x","event":"missed","reason":"timeout","serverMsgId":7,"serverTime":12345}"#
        );
    }

    fn http_request(method: &str, target: &str, headers: Vec<HttpHeader>) -> HttpRequest {
        HttpRequest {
            host: "x-pslack.test".into(),
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
            ("Sec-WebSocket-Protocol", "psibase.pslack.v1"),
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
