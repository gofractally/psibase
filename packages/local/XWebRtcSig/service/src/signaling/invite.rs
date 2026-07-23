use psibase::services::chat;
use psibase::{AccountNumber, ExactAccountNumber};

use crate::protocol::{ChatAppMetadata, DataChannelSpec, ServerFrame};

use super::constants::{
    APP_SERVICE_CHAT, PURPOSE_AV_CALL, PURPOSE_CHAT_DATA, TRANSPORT_AUDIO, TRANSPORT_VIDEO,
};

pub const CHAT_DATA_CHANNEL_LABEL: &str = "chat";

pub(super) fn chat_data_channels() -> Vec<DataChannelSpec> {
    vec![DataChannelSpec {
        label: CHAT_DATA_CHANNEL_LABEL.into(),
        ordered: true,
    }]
}

pub(super) fn chat_data_transports() -> Vec<String> {
    Vec::new()
}

pub(super) fn av_call_transports() -> Vec<String> {
    vec![TRANSPORT_AUDIO.into(), TRANSPORT_VIDEO.into()]
}

pub(super) fn av_call_data_channels() -> Vec<DataChannelSpec> {
    Vec::new()
}

fn session_invite_payload(auth: &chat::SessionJoinAuth) -> (Vec<String>, Vec<DataChannelSpec>) {
    match auth.purpose.as_str() {
        PURPOSE_CHAT_DATA => (chat_data_transports(), chat_data_channels()),
        PURPOSE_AV_CALL => (av_call_transports(), av_call_data_channels()),
        _ => (Vec::new(), Vec::new()),
    }
}

pub fn session_invite_frame(auth: &chat::SessionJoinAuth, from: AccountNumber) -> ServerFrame {
    let participants: Vec<ExactAccountNumber> =
        auth.participants.iter().copied().map(Into::into).collect();
    let (transports, data_channels) = session_invite_payload(auth);
    ServerFrame::SessionInvite {
        session_id: auth.session_id.clone(),
        app_service: APP_SERVICE_CHAT.into(),
        app_session_id: auth.space_id.clone(),
        purpose: auth.purpose.clone(),
        from: from.into(),
        participants,
        transports,
        data_channels,
        expires_at: auth.expires_at,
        app_metadata: ChatAppMetadata {
            space_uuid: auth.space_id.clone(),
        },
    }
}
