mod authorize;
mod create;
mod events;
mod lookup;
mod pair;
mod purpose;
mod types;

#[cfg(test)]
mod tests;

pub use authorize::{authorize_session_join, is_session_participant};
pub use create::create_session;
pub use events::{
    append_session_event, apply_webrtc_session_event, close_session, commit_webrtc_session_event,
};
pub use lookup::{
    active_session_for_space, allocate_session_id, allocate_unique_session_id,
    participants_of_session, session_is_expired, session_row, session_to_view, sessions_for_space,
};
pub use pair::{
    allocate_pair_session_id, canonical_pair_accounts, is_pair_session_id, parse_pair_session_id,
};
pub use purpose::{
    is_valid_purpose, participants_for_session, validate_purpose, validate_session_participants,
};
pub use types::{
    Session, SessionError, SessionJoinAuth, WebRtcSessionEvent, DEFAULT_SESSION_TTL_US,
    PAIR_SESSION_PREFIX, PURPOSE_AV_CALL, PURPOSE_CHAT_DATA, SESSION_EVENT_PARTICIPANT_JOINED,
    SESSION_EVENT_PARTICIPANT_LEFT, SESSION_EVENT_SESSION_ENDED, SESSION_EVENT_SESSION_FAILED,
    SESSION_STATUS_ACTIVE, SESSION_STATUS_ENDED, SESSION_STATUS_FAILED,
};
