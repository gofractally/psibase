use super::constants::session_err;
use super::invite::{
    av_call_data_channels, av_call_transports, chat_data_channels, chat_data_transports,
    session_invite_frame, CHAT_DATA_CHANNEL_LABEL,
};
use super::leave::{leave_lifecycle_event_kind, normalize_leave_reason};
use super::*;
use crate::protocol::ServerFrame;
use psibase::services::chat;
use psibase::*;

#[test]
fn av_call_leave_event_kind_maps_ringing_timeout_to_failed() {
    assert_eq!(
        leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "timeout", 1),
        EVENT_SESSION_FAILED
    );
    assert_eq!(
        leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "declined", 1),
        EVENT_SESSION_ENDED
    );
    assert_eq!(
        leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "ended", 2),
        EVENT_SESSION_ENDED
    );
}

#[test]
fn normalize_leave_reason_maps_invite_timeout() {
    assert_eq!(
        normalize_leave_reason(Some("invite-timeout".into())),
        "timeout"
    );
}

#[test]
fn session_err_frame_includes_code_and_session_id() {
    let (_, frame) = session_err(
        7,
        "not-participant",
        "account is not a participant in this session",
        Some("wrtc:abc".into()),
    );
    match frame {
        ServerFrame::Error {
            code,
            reason,
            session_id,
        } => {
            assert_eq!(code, "not-participant");
            assert!(reason.contains("participant"));
            assert_eq!(session_id.as_deref(), Some("wrtc:abc"));
        }
        _ => panic!("expected error frame"),
    }
}

#[test]
fn chat_data_channel_spec_is_ordered_chat_label() {
    let channels = chat_data_channels();
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].label, CHAT_DATA_CHANNEL_LABEL);
    assert!(channels[0].ordered);
    assert!(chat_data_transports().is_empty());
}

#[test]
fn session_invite_wires_chat_data_metadata() {
    let auth = chat::SessionJoinAuth {
        session_id: "wrtc:abc".into(),
        authorized: true,
        purpose: PURPOSE_CHAT_DATA.into(),
        space_uuid: "space:dm-1".into(),
        participants: vec![account!("alice"), account!("bob")],
        lifecycle: 1,
        expires_at: 99,
        expired: false,
    };
    let frame = session_invite_frame(&auth, account!("alice"));
    match frame {
        ServerFrame::SessionInvite {
            app_service,
            purpose,
            data_channels,
            app_metadata,
            ..
        } => {
            assert_eq!(app_service, APP_SERVICE_CHAT);
            assert_eq!(purpose, PURPOSE_CHAT_DATA);
            assert_eq!(data_channels.len(), 1);
            assert_eq!(data_channels[0].label, CHAT_DATA_CHANNEL_LABEL);
            assert!(data_channels[0].ordered);
            assert_eq!(app_metadata.space_uuid, "space:dm-1");
        }
        _ => panic!("expected sessionInvite"),
    }
}

#[test]
fn av_call_transports_are_audio_and_video_without_data_channels() {
    assert_eq!(
        av_call_transports(),
        vec!["audio".to_owned(), "video".to_owned()]
    );
    assert!(av_call_data_channels().is_empty());
}

#[test]
fn session_invite_wires_av_call_metadata() {
    let auth = chat::SessionJoinAuth {
        session_id: "wrtc:call-1".into(),
        authorized: true,
        purpose: PURPOSE_AV_CALL.into(),
        space_uuid: "space:dm-1".into(),
        participants: vec![account!("alice"), account!("bob")],
        lifecycle: 1,
        expires_at: 99,
        expired: false,
    };
    let frame = session_invite_frame(&auth, account!("alice"));
    match frame {
        ServerFrame::SessionInvite {
            app_service,
            purpose,
            transports,
            data_channels,
            app_metadata,
            ..
        } => {
            assert_eq!(app_service, APP_SERVICE_CHAT);
            assert_eq!(purpose, PURPOSE_AV_CALL);
            assert_eq!(transports, vec!["audio", "video"]);
            assert!(data_channels.is_empty());
            assert_eq!(app_metadata.space_uuid, "space:dm-1");
        }
        _ => panic!("expected sessionInvite"),
    }
}

#[test]
fn session_invite_includes_all_n_party_participants() {
    let auth = chat::SessionJoinAuth {
        session_id: "wrtc:group-1".into(),
        authorized: true,
        purpose: PURPOSE_CHAT_DATA.into(),
        space_uuid: "space:group-1".into(),
        participants: vec![account!("alice"), account!("bob"), account!("carol")],
        lifecycle: 1,
        expires_at: 99,
        expired: false,
    };
    let frame = session_invite_frame(&auth, account!("alice"));
    match frame {
        ServerFrame::SessionInvite {
            participants,
            app_metadata,
            data_channels,
            ..
        } => {
            assert_eq!(participants.len(), 3);
            assert_eq!(app_metadata.space_uuid, "space:group-1");
            assert_eq!(data_channels[0].label, CHAT_DATA_CHANNEL_LABEL);
            assert!(data_channels[0].ordered);
        }
        _ => panic!("expected sessionInvite"),
    }
}

#[test]
fn session_invite_includes_all_n_party_av_call_participants() {
    let auth = chat::SessionJoinAuth {
        session_id: "wrtc:group-call-1".into(),
        authorized: true,
        purpose: PURPOSE_AV_CALL.into(),
        space_uuid: "space:group-1".into(),
        participants: vec![account!("alice"), account!("bob"), account!("carol")],
        lifecycle: 1,
        expires_at: 99,
        expired: false,
    };
    let frame = session_invite_frame(&auth, account!("alice"));
    match frame {
        ServerFrame::SessionInvite {
            participants,
            purpose,
            transports,
            data_channels,
            app_metadata,
            ..
        } => {
            assert_eq!(participants.len(), 3);
            assert_eq!(purpose, PURPOSE_AV_CALL);
            assert_eq!(transports, vec!["audio", "video"]);
            assert!(data_channels.is_empty());
            assert_eq!(app_metadata.space_uuid, "space:group-1");
        }
        _ => panic!("expected sessionInvite"),
    }
}
