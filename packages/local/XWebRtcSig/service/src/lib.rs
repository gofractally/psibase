mod r_transact;

mod http;
pub mod protocol;
pub mod signaling;
pub mod state;

pub mod cleanup;
pub mod ice_config;
pub mod presence;

#[psibase::service(name = "x-wrtcsig", tables = "state::tables")]
#[allow(non_snake_case)]
mod service {
    use crate::http::{
        authenticated_user, deliver_frames, enqueue_peer_frames,
        flush_outbound, cleanup_socket, plain_reply, route_target,
        rtransact_login, send_frame, send_protocol_error, enqueue_sweep_frames, send_welcome,
        turn_ice_servers_json, websocket_route, RouteTarget,
    };
    use crate::protocol::{
        parse_client_frame, validate_client_frame, ClientFrame, ProtocolError, ServerFrame,
        WEBSOCKET_TEXT,
    };
    use crate::signaling::dispatch_client_frame;
    use crate::state::subjective::{
        connect_presence_fanout_tx, get_socket_tx, apply_client_ready_tx, upsert_socket_tx,
    };
    use psibase::services::x_http::Wrapper as XHttp;
    use psibase::{
        get_sender, services::transact::Wrapper as Transact, HttpReply, HttpRequest, MethodNumber,
        ServiceWrapper,
    };

    /// HTTP/websocket entrypoint for the realtime signaling service.
    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            psibase::account!("x-http"),
            "x-wrtcsig serveSys must be called by x-http",
        );

        match route_target(&request) {
            RouteTarget::Login => {
                let user = authenticated_user(&request);
                return rtransact_login(request, socket, user);
            }
            RouteTarget::NotFound => {
                return Some(plain_reply(404, "x-wrtcsig endpoints are /login and /ws"));
            }
            RouteTarget::WebSocket => {}
        }

        let user = authenticated_user(&request);
        let (socket, user, reply) = match websocket_route(&request, socket, user) {
            Ok(accepted) => accepted,
            Err(reply) => return Some(reply),
        };

        // Welcome ICE is STUN-only for now (`[]` → default STUN via merged_ice_servers).
        let turn_json = turn_ice_servers_json();

        XHttp::call().accept(socket, reply);
        XHttp::call().setCallback(
            socket,
            MethodNumber::from("recv"),
            MethodNumber::from("close"),
        );
        let now = Transact::call().currentBlock().time.microseconds;
        upsert_socket_tx(socket, user, now);
        send_welcome(socket, user, now, &turn_json);
        let fanout = connect_presence_fanout_tx(user);
        send_frame(socket, &fanout.snapshot);
        enqueue_peer_frames(now, fanout.peer_deltas);
        // Sweep after responding to the new connection so a dead peer socket
        // cannot abort before welcome / presence delivery.
        enqueue_sweep_frames(now);
        flush_outbound(socket);
        None
    }

    #[action]
    fn recv(socket: i32, data: Vec<u8>, flags: u32) {
        assert_eq!(
            get_sender(),
            psibase::account!("x-http"),
            "x-wrtcsig recv must be called by x-http",
        );

        if flags != WEBSOCKET_TEXT {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame("x-wrtcsig only accepts websocket text frames".into()),
            );
            return;
        }

        let session = get_socket_tx(socket);
        let Some(session) = session else {
            send_protocol_error(
                socket,
                ProtocolError::InvalidFrame("socket is not an active x-wrtcsig session".into()),
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

        match frame {
            ClientFrame::ClientReady {
                client_instance_id,
                active,
                visible,
                supports,
            } => {
                if !apply_client_ready_tx(
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
                            "socket is not an active x-wrtcsig session".into(),
                        ),
                    );
                } else {
                    enqueue_sweep_frames(now);
                    flush_outbound(socket);
                }
            }
            ClientFrame::Ping => {
                send_frame(socket, &ServerFrame::Pong);
                enqueue_sweep_frames(now);
                flush_outbound(socket);
            }
            session_frame => {
                let dispatch = dispatch_client_frame(socket, user, now, session_frame);
                deliver_frames(socket, dispatch.frames, now);
                // Run stale-session sweep after the requesting socket has been
                // answered — same ordering contract as cleanup_socket.
                enqueue_sweep_frames(now);
                flush_outbound(socket);
            }
        }
    }

    #[action]
    fn close(socket: i32) {
        assert_eq!(
            get_sender(),
            psibase::account!("x-http"),
            "x-wrtcsig close must be called by x-http",
        );
        cleanup_socket(socket);
    }

    #[action]
    fn errSys(socket: i32, reply: Option<HttpReply>) {
        let _ = reply;
        assert_eq!(
            get_sender(),
            psibase::account!("x-http"),
            "x-wrtcsig errSys must be called by x-http",
        );
        cleanup_socket(socket);
    }
}
