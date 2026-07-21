//! WebRTC session join and SDP/ICE routing against objective Chat metadata (§6.3–6.4).
//! ICE merge/validation for welcome frames lives in [`crate::ice_config`] (§11.4).
//!
//! ## Signal delivery contract
//!
//! SDP/ICE `signal` frames are delivered **only** to websocket sockets whose user
//! has called `joinSession` for that `session_id` (rows in `SigSessionJoinTable`).
//! We do **not** fall back to every live socket for the recipient: a transport that
//! is up but has not joined (or has not installed client handlers yet) would
//! silently drop frames.
//!
//! When no joined socket exists for the recipient, frames are buffered via
//! [`crate::state::enqueue_pending_signal`] and atomically flushed by
//! [`join::handle_join_session`] through [`fanout::flush_pending_signals_to_socket`].
//! Clients must tolerate reordering across reconnects, but once joined they
//! receive buffered signals in enqueue order followed by live traffic.

mod constants;
mod dispatch;
mod fanout;
mod invite;
mod join;
mod leave;
mod signal;
mod teardown;

#[cfg(test)]
mod tests;

pub use constants::{
    APP_SERVICE_CHAT, PURPOSE_AV_CALL, PURPOSE_CHAT_DATA, TRANSPORT_AUDIO, TRANSPORT_VIDEO,
};
pub(crate) use constants::{query_session_auth_for_cleanup, EVENT_SESSION_ENDED, EVENT_SESSION_FAILED};

pub use invite::{session_invite_frame, CHAT_DATA_CHANNEL_LABEL};

pub(crate) use fanout::fanout_session_ended_to_participants;

pub use join::handle_join_session;
pub use signal::handle_signal;
pub use leave::{handle_leave_session, handle_participant_state};

pub(crate) use teardown::tear_down_sessions_for_dead_socket_tx;

pub use dispatch::{dispatch_signaling_client_frame, SignalingDispatch};
