mod http;
mod protocol;
mod state;

use http::{
    assert_x_http_sender, fanout_frames, plain_reply, send_frame, send_protocol_error,
    websocket_handshake,
};
use protocol::{parse_client_frame, ClientFrame, PresenceStatus, ServerFrame, WEBSOCKET_TEXT};
use psibase::services::transact::Wrapper as Transact;
use psibase::services::x_http::Wrapper as XHttp;
use psibase::services::x_ws_auth::{self, Wrapper as XWsAuth};
use psibase::{AccountNumber, HttpReply, HttpRequest, MethodNumber, ServiceWrapper};
use state::{
    all_sockets_except_tx, cleanup_tx, clear_lobby_tx, clear_match_if_host_tx, connect_tx,
    get_socket_tx, input_route_tx, is_host_socket_tx, lobby_frame_tx, peer_sockets_for_presence_tx,
    presence_delta, set_ready_tx, set_unready_tx, BATTLEZONE_APP,
};

#[psibase::service(name = "x-bzone", tables = "state::tables")]
#[allow(non_snake_case)]
mod service {
    use super::*;

    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        assert_x_http_sender();

        let path = request.path();
        match path.as_ref() {
            "/ws" => handle_ws(&request, socket),
            _ => Some(plain_reply(404, "x-bzone endpoint is /ws")),
        }
    }

    #[action]
    fn recv(socket: i32, data: Vec<u8>, flags: u32) {
        assert_x_http_sender();
        if flags != WEBSOCKET_TEXT {
            send_protocol_error(
                socket,
                protocol::ProtocolError::InvalidFrame(
                    "x-bzone only accepts websocket text frames".into(),
                ),
            );
            return;
        }

        let Some(session) = get_socket_tx(socket) else {
            send_protocol_error(
                socket,
                protocol::ProtocolError::InvalidFrame(
                    "socket is not an active x-bzone session".into(),
                ),
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

        dispatch_frame(socket, session.user, frame);
    }

    #[action]
    fn close(socket: i32) {
        assert_x_http_sender();
        cleanup_socket(socket);
    }

    #[action]
    fn errSys(socket: i32, reply: Option<HttpReply>) {
        let _ = reply;
        assert_x_http_sender();
        cleanup_socket(socket);
    }
}

fn handle_ws(request: &HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
    let Some(socket) = socket else {
        return Some(plain_reply(503, "x-bzone requires a websocket socket"));
    };
    let Some(ticket) = x_ws_auth::get_ticket(request) else {
        return Some(plain_reply(
            401,
            "x-bzone /ws requires subprotocols psibase.battlezone.v1 and psibase.ws-ticket.*",
        ));
    };
    let Some(reply) = websocket_handshake(request) else {
        return Some(plain_reply(426, "x-bzone /ws requires websocket upgrade"));
    };

    let now = Transact::call().currentBlock().time.microseconds;
    let user = match XWsAuth::call().consume(ticket) {
        Some(info) if info.app == BATTLEZONE_APP => info.user,
        _ => return Some(plain_reply(401, "invalid or expired ws ticket")),
    };

    XHttp::call().accept(socket, reply);
    XHttp::call().setCallback(
        socket,
        MethodNumber::from("recv"),
        MethodNumber::from("close"),
    );

    let (snapshot, peer_deltas) = connect_tx(socket, user, now);

    send_frame(
        socket,
        &ServerFrame::Welcome {
            user: user.into(),
            server_time: now,
        },
    );
    send_frame(socket, &snapshot);
    fanout_frames(peer_deltas);

    if let Some(lobby) = lobby_frame_tx() {
        send_frame(socket, &lobby);
    }

    // Hard refresh always lands on the title screen — never auto-rejoin a match.
    None
}

fn dispatch_frame(socket: i32, user: AccountNumber, frame: ClientFrame) {
    match frame {
        ClientFrame::Hello => {}
        ClientFrame::Ready { enemy_count, slots } => {
            let (lobby_or_err, started) = set_ready_tx(user, socket, enemy_count, &slots);
            if matches!(&lobby_or_err, ServerFrame::Error { .. }) {
                send_frame(socket, &lobby_or_err);
            } else {
                let targets = all_sockets_except_tx(-1);
                fanout_frames(
                    targets
                        .into_iter()
                        .map(|s| (s, lobby_or_err.clone()))
                        .collect(),
                );
            }
            if let Some((started, match_targets)) = started {
                fanout_frames(
                    match_targets
                        .into_iter()
                        .map(|s| (s, started.clone()))
                        .collect(),
                );
            }
        }
        ClientFrame::Unready => {
            if let Some(lobby) = set_unready_tx(user) {
                let targets = all_sockets_except_tx(-1);
                fanout_frames(targets.into_iter().map(|s| (s, lobby.clone())).collect());
            }
        }
        ClientFrame::LeaveMatch => {
            clear_match_if_host_tx(user);
            clear_lobby_tx();
            let targets = all_sockets_except_tx(-1);
            fanout_frames(
                targets
                    .into_iter()
                    .map(|s| (s, ServerFrame::MatchEnded))
                    .collect(),
            );
        }
        ClientFrame::Input {
            tank_id,
            turn,
            throttle,
            fire,
        } => {
            let (ok, host_socket) = input_route_tx(user, &tank_id);
            if !ok {
                send_protocol_error(
                    socket,
                    protocol::ProtocolError::InvalidFrame("tank not assigned to you".into()),
                );
                return;
            }
            if let Some(host_socket) = host_socket {
                send_frame(
                    host_socket,
                    &ServerFrame::Input {
                        from: user.into(),
                        tank_id,
                        turn,
                        throttle,
                        fire,
                    },
                );
            }
        }
        ClientFrame::StateSnapshot { state } => {
            if !is_host_socket_tx(user, socket) {
                send_protocol_error(
                    socket,
                    protocol::ProtocolError::InvalidFrame(
                        "only match host may send snapshots".into(),
                    ),
                );
                return;
            }
            let targets = all_sockets_except_tx(socket);
            let frame = ServerFrame::StateSnapshot { state };
            fanout_frames(targets.into_iter().map(|s| (s, frame.clone())).collect());
        }
    }
}

fn cleanup_socket(socket: i32) {
    let (removed, match_ended, lobby_update) = cleanup_tx(socket);

    let Some(removed) = removed else {
        return;
    };

    if removed.was_final {
        let delta = presence_delta(removed.user, PresenceStatus::Offline);
        let mut peers = peer_sockets_for_presence_tx(removed.user);
        if peers.is_empty() {
            peers = all_sockets_except_tx(socket);
        }
        fanout_frames(peers.into_iter().map(|s| (s, delta.clone())).collect());
    }

    if let Some(lobby) = lobby_update {
        let targets = all_sockets_except_tx(socket);
        fanout_frames(targets.into_iter().map(|s| (s, lobby.clone())).collect());
    }

    if match_ended {
        clear_lobby_tx();
        let targets = all_sockets_except_tx(socket);
        fanout_frames(
            targets
                .into_iter()
                .map(|s| (s, ServerFrame::MatchEnded))
                .collect(),
        );
    }
}
