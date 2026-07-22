use psibase::services::chat::{self, Wrapper as Chat};
use psibase::{AccountNumber, ServiceWrapper};

use crate::protocol::ServerFrame;

pub const APP_SERVICE_CHAT: &str = "chat";
pub const PURPOSE_CHAT_DATA: &str = "chat-data";
pub const PURPOSE_AV_CALL: &str = "av-call";
pub const TRANSPORT_AUDIO: &str = "audio";
pub const TRANSPORT_VIDEO: &str = "video";

pub(super) const EVENT_PARTICIPANT_LEFT: u8 = 2;
pub(crate) const EVENT_SESSION_FAILED: u8 = 3;
pub(crate) const EVENT_SESSION_ENDED: u8 = 4;

pub(crate) fn sig_service() -> AccountNumber {
    psibase::account!("x-wrtcsig")
}

pub(super) fn is_supported_purpose(purpose: &str) -> bool {
    purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL
}

pub(crate) fn query_session_auth(session_id: &str, account: AccountNumber) -> chat::SessionJoinAuth {
    Chat::call_from(sig_service()).authorizeSessionJoin(session_id.into(), account)
}

pub(super) fn error_for_socket(
    socket: i32,
    code: &str,
    reason: &str,
    session_id: Option<String>,
) -> (i32, ServerFrame) {
    (
        socket,
        ServerFrame::Error {
            code: code.into(),
            reason: reason.into(),
            session_id,
        },
    )
}
