use psibase::AccountNumber;

use crate::protocol::{ClientFrame, ServerFrame};

use super::join::handle_join_session;
use super::leave::{handle_leave_session, handle_participant_state};
use super::signal::handle_signal;

pub struct SignalingDispatch {
    pub frames: Vec<(i32, ServerFrame)>,
}

pub fn dispatch_client_frame(
    socket: i32,
    user: AccountNumber,
    now: i64,
    frame: ClientFrame,
) -> SignalingDispatch {
    match frame {
        ClientFrame::JoinSession {
            session_id,
            client_instance_id,
        } => SignalingDispatch {
            frames: handle_join_session(socket, user, session_id, client_instance_id, now),
        },
        ClientFrame::Signal {
            session_id,
            to,
            kind,
            sdp,
            candidate,
            sdp_mid,
            sdp_mline_index,
        } => SignalingDispatch {
            frames: handle_signal(
                socket,
                user,
                session_id,
                to.into(),
                kind,
                sdp,
                candidate,
                sdp_mid,
                sdp_mline_index,
                now,
            ),
        },
        ClientFrame::LeaveSession { session_id, reason } => SignalingDispatch {
            frames: handle_leave_session(socket, user, session_id, reason, now),
        },
        ClientFrame::ParticipantState { session_id, state } => SignalingDispatch {
            frames: handle_participant_state(socket, user, session_id, state),
        },
        _ => SignalingDispatch { frames: vec![] },
    }
}
