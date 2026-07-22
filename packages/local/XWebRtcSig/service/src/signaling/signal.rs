use psibase::AccountNumber;

use crate::protocol::{encode_server_frame, ServerFrame, SignalKind};
use crate::state::{enqueue_pending_signal, get_session_join, touch_session_liveness};
#[cfg(feature = "rt-trace")]
use crate::state::{user_live_sockets, session_joins};
#[cfg(feature = "rt-trace")]
use crate::trace::xrtcsig_trace;

use super::constants::{is_supported_purpose, query_session_auth, error_for_socket};
use super::fanout::{fanout_signal_to_peer, drain_and_deliver_pending_signals};

fn validate_signal(
    socket: i32,
    user: AccountNumber,
    session_id: &str,
    to: AccountNumber,
) -> Result<(), ServerFrame> {
    let auth = query_session_auth(session_id, user);
    if !auth.authorized || auth.expired || auth.status != 1 {
        return Err(error_for_socket(
            socket,
            "not-participant",
            "not authorized to signal in this session",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if !is_supported_purpose(&auth.purpose) {
        return Err(error_for_socket(
            socket,
            "unsupported-purpose",
            "unsupported session purpose for signaling",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if get_session_join(session_id, user).is_none() {
        return Err(error_for_socket(
            socket,
            "not-joined",
            "join the session before sending signals",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if !auth.participants.iter().any(|p| *p == to) {
        return Err(error_for_socket(
            socket,
            "bad-recipient",
            "signal recipient is not a session participant",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if to == user {
        return Err(error_for_socket(
            socket,
            "bad-recipient",
            "cannot signal yourself",
            Some(session_id.to_owned()),
        )
        .1);
    }
    Ok(())
}

pub fn handle_signal(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    to: AccountNumber,
    kind: SignalKind,
    sdp: Option<String>,
    candidate: Option<String>,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<u32>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        if let Err(frame) = validate_signal(socket, user, &session_id, to) {
            vec![(socket, frame)]
        } else {
            touch_session_liveness(&session_id, now);
            let outbound = ServerFrame::Signal {
                session_id: session_id.clone(),
                from: user.into(),
                to: to.into(),
                kind,
                sdp: sdp.clone(),
                candidate: candidate.clone(),
                sdp_mid: sdp_mid.clone(),
                sdp_mline_index,
            };

            let mut delivers = fanout_signal_to_peer(&session_id, to, &outbound);
            if delivers.is_empty() {
                if let Ok(payload) = encode_server_frame(&outbound) {
                    enqueue_pending_signal(&session_id, to, now, payload);
                }
            }
            delivers.extend(drain_and_deliver_pending_signals(&session_id, to, now));
            #[cfg(feature = "rt-trace")]
            if delivers.is_empty() {
                let join_socks: Vec<i32> = session_joins(&session_id)
                    .into_iter()
                    .filter(|join| join.account == to)
                    .map(|join| join.socket)
                    .collect();
                let live = user_live_sockets(to);
                xrtcsig_trace!(
                    "[xrtcsig-trace] signal-no-delivery session={} to={} join_socks={:?} live_socks={:?}\n",
                    session_id,
                    to,
                    join_socks,
                    live,
                );
            }
            delivers
        }
    }
}
