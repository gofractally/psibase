use super::*;

#[test]
fn parses_client_ready_and_ping() {
    let ready = parse_client_frame(
        br#"{"t":"clientReady","clientInstanceId":"inst-1","active":true,"visible":false,"supports":{"audio":true,"video":false,"data":true}}"#,
    )
    .unwrap();
    assert_eq!(
        ready,
        ClientFrame::ClientReady {
            client_instance_id: "inst-1".into(),
            active: true,
            visible: false,
            supports: ClientSupports {
                audio: true,
                video: false,
                data: true,
            },
        }
    );
    assert_eq!(parse_client_frame(br#"{"t":"ping"}"#).unwrap(), ClientFrame::Ping);
}

#[test]
fn serializes_welcome_with_inline_ice_servers() {
    use crate::ice_config::default_stun_ice_server_configs;

    let frame = ServerFrame::Welcome {
        user: "alice".parse().unwrap(),
        server_time: 42,
        ice_servers: default_stun_ice_server_configs(),
        active_sessions: None,
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""t":"welcome""#));
    assert!(json.contains(r#""iceServers""#));
    assert!(json.contains(r#""serverTime":42"#));
    // active_sessions is None and skipped when serializing.
    assert!(!json.contains(r#""activeSessions""#));
}

#[test]
fn serializes_welcome_with_active_sessions_hint() {
    use crate::ice_config::default_stun_ice_server_configs;

    let frame = ServerFrame::Welcome {
        user: "alice".parse().unwrap(),
        server_time: 42,
        ice_servers: default_stun_ice_server_configs(),
        active_sessions: Some(vec![WelcomeActiveSession {
            session_id: "wrtc:abc".into(),
            purpose: "av-call".into(),
            space_uuid: "space:1".into(),
            participants: vec!["alice".parse().unwrap(), "bob".parse().unwrap()],
            epoch: Some(3),
        }]),
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""activeSessions""#));
    assert!(json.contains(r#""sessionId":"wrtc:abc""#));
    assert!(json.contains(r#""epoch":3"#));
}

#[test]
fn serializes_session_snapshot_frame() {
    let frame = ServerFrame::SessionSnapshot {
        session_id: "wrtc:abc".into(),
        epoch: 1,
        joined_participants: vec!["alice".parse().unwrap()],
        pending_participants: vec!["bob".parse().unwrap()],
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""t":"sessionSnapshot""#));
    assert!(json.contains(r#""epoch":1"#));
    assert!(json.contains(r#""joinedParticipants":["alice"]"#));
    assert!(json.contains(r#""pendingParticipants":["bob"]"#));
}

#[test]
fn serializes_transport_lost_frame() {
    let frame = ServerFrame::TransportLost {
        session_id: "wrtc:abc".into(),
        participant: "bob".parse().unwrap(),
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""t":"transportLost""#));
    assert!(json.contains(r#""participant":"bob""#));
}

#[test]
fn rejects_empty_client_instance_id() {
    let frame = parse_client_frame(
        br#"{"t":"clientReady","clientInstanceId":"  ","active":true,"visible":true,"supports":{"audio":true,"video":true,"data":false}}"#,
    )
    .unwrap();
    assert!(matches!(
        validate_client_frame(&frame),
        Err(ProtocolError::InvalidFrame(_))
    ));
}

#[test]
fn rejects_malformed_json() {
    assert!(matches!(
        parse_client_frame(b"{not json"),
        Err(ProtocolError::MalformedJson(_))
    ));
}

#[test]
fn rejects_missing_frame_discriminator() {
    assert!(matches!(
        parse_client_frame(br#"{"active":true}"#),
        Err(ProtocolError::InvalidFrame(_))
    ));
}

#[test]
fn serializes_presence_snapshot_and_delta() {
    use super::{PeerPresence, PresenceStatus};

    let snapshot = ServerFrame::PresenceSnapshot {
        peers: vec![PeerPresence {
            account: "bob".parse().unwrap(),
            presence: PresenceStatus::Online,
        }],
    };
    let json = encode_server_frame(&snapshot).unwrap();
    assert!(json.contains(r#""t":"presenceSnapshot""#));
    assert!(json.contains(r#""presence":"online""#));

    let delta = ServerFrame::Presence {
        account: "alice".parse().unwrap(),
        status: PresenceStatus::Online,
        socket_count: Some(2),
    };
    let json = encode_server_frame(&delta).unwrap();
    assert_eq!(
        json,
        r#"{"t":"presence","account":"alice","status":"online","socketCount":2}"#
    );
}

#[test]
fn parses_join_session_and_signal_frames() {
    let join = parse_client_frame(
        br#"{"t":"joinSession","sessionId":"wrtc:abc","clientInstanceId":"inst-2"}"#,
    )
    .unwrap();
    assert!(matches!(join, ClientFrame::JoinSession { .. }));

    let signal = parse_client_frame(
        br#"{"t":"signal","sessionId":"wrtc:abc","to":"bob","kind":"offer","sdp":"v=0"}"#,
    )
    .unwrap();
    assert!(validate_client_frame(&signal).is_ok());
}

#[test]
fn serializes_chat_data_session_invite() {
    let frame = ServerFrame::SessionInvite {
        session_id: "wrtc:abc".into(),
        app_service: "chat".into(),
        app_session_id: "space:1".into(),
        purpose: "chat-data".into(),
        from: "alice".parse().unwrap(),
        participants: vec!["alice".parse().unwrap(), "bob".parse().unwrap()],
        transports: vec![],
        data_channels: vec![DataChannelSpec {
            label: "chat".into(),
            ordered: true,
        }],
        expires_at: 42,
        app_metadata: ChatAppMetadata {
            space_uuid: "space:1".into(),
        },
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""t":"sessionInvite""#));
    assert!(json.contains(r#""appService":"chat""#));
    assert!(json.contains(r#""spaceUuid":"space:1""#));
    assert!(json.contains(r#""label":"chat""#));
}

#[test]
fn structured_error_includes_session_id() {
    let frame = ServerFrame::Error {
        code: "not-participant".into(),
        reason: "account is not a participant in this session".into(),
        session_id: Some("wrtc:abc".into()),
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""sessionId":"wrtc:abc""#));
}

#[test]
fn serializes_pair_session_invite_with_e2e_style_accounts() {
    let frame = ServerFrame::SessionInvite {
        session_id: "wrtc:pair:e2ealicegc:e2ecarolgc".into(),
        app_service: "chat".into(),
        app_session_id: String::new(),
        purpose: "chat-data".into(),
        from: "e2ealicegc".parse().unwrap(),
        participants: vec![
            "e2ealicegc".parse().unwrap(),
            "e2ecarolgc".parse().unwrap(),
        ],
        transports: vec![],
        data_channels: vec![DataChannelSpec {
            label: "chat".into(),
            ordered: true,
        }],
        expires_at: 0,
        app_metadata: ChatAppMetadata {
            space_uuid: String::new(),
        },
    };
    let json = encode_server_frame(&frame).unwrap();
    assert!(json.contains(r#""sessionId":"wrtc:pair:e2ealicegc:e2ecarolgc""#));
    assert!(json.contains(r#""e2ealicegc""#));
    assert!(json.contains(r#""e2ecarolgc""#));
}

#[test]
fn rejects_chat_say_frame_as_unknown() {
    assert!(matches!(
        parse_client_frame(br#"{"t":"say","body":"secret"}"#),
        Err(ProtocolError::UnknownFrameType(_))
    ));
}

#[test]
fn parses_leave_session_frame() {
    let frame = parse_client_frame(
        br#"{"t":"leaveSession","sessionId":"wrtc:abc","reason":"user"}"#,
    )
    .unwrap();
    assert!(validate_client_frame(&frame).is_ok());
    assert!(matches!(frame, ClientFrame::LeaveSession { .. }));
}

#[test]
fn serializes_participant_joined_and_signal_frames() {
    let joined = ServerFrame::ParticipantJoined {
        session_id: "wrtc:abc".into(),
        participant: "bob".parse().unwrap(),
    };
    let joined_json = encode_server_frame(&joined).unwrap();
    assert!(joined_json.contains(r#""t":"participantJoined""#));
    assert!(joined_json.contains(r#""participant":"bob""#));

    let signal = ServerFrame::Signal {
        session_id: "wrtc:abc".into(),
        from: "alice".parse().unwrap(),
        to: "bob".parse().unwrap(),
        kind: SignalKind::Offer,
        sdp: Some("v=0".into()),
        candidate: None,
        sdp_mid: None,
        sdp_mline_index: None,
    };
    let signal_json = encode_server_frame(&signal).unwrap();
    assert!(signal_json.contains(r#""t":"signal""#));
    assert!(signal_json.contains(r#""kind":"offer""#));
}

#[test]
fn rejects_chat_message_body_on_websocket() {
    assert!(matches!(
        parse_client_frame(
            br#"{"t":"chatMessage","spaceUuid":"space:1","from":"alice","body":"hi","sendTimestamp":1,"clientMsgId":"m1"}"#
        ),
        Err(ProtocolError::UnknownFrameType(_))
    ));
}

#[test]
fn rejects_legacy_call_media_state_frame() {
    assert!(matches!(
        parse_client_frame(
            br#"{"t":"callMediaState","callId":"wrtc:abc","audioMuted":true,"videoMuted":false}"#
        ),
        Err(ProtocolError::UnknownFrameType(_))
    ));
}

/// Golden fixtures shared with the TypeScript Zod schemas (P2.3): see
/// `packages/shared-ui/domains/webrtc/fixtures/golden/README.md`. Both
/// sides deserialize the *same* JSON so the wire contract can't drift.
mod golden_fixtures {
    use super::*;

    const WELCOME: &str =
        include_str!("../../../../../shared-ui/domains/webrtc/fixtures/golden/welcome.json");
    const PRESENCE_SNAPSHOT: &str = include_str!(
        "../../../../../shared-ui/domains/webrtc/fixtures/golden/presence-snapshot.json"
    );
    const SESSION_SNAPSHOT: &str = include_str!(
        "../../../../../shared-ui/domains/webrtc/fixtures/golden/session-snapshot.json"
    );

    #[test]
    fn deserializes_golden_welcome_frame() {
        let frame = decode_server_frame(WELCOME).unwrap();
        match frame {
            ServerFrame::Welcome {
                user,
                active_sessions,
                ..
            } => {
                assert_eq!(user, "alice".parse().unwrap());
                let sessions = active_sessions.expect("golden welcome has activeSessions");
                assert_eq!(sessions[0].session_id, "wrtc:pair:alice:bob");
                assert_eq!(sessions[0].epoch, Some(3));
            }
            other => panic!("expected Welcome, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_golden_presence_snapshot_frame() {
        let frame = decode_server_frame(PRESENCE_SNAPSHOT).unwrap();
        match frame {
            ServerFrame::PresenceSnapshot { peers } => {
                assert_eq!(peers.len(), 2);
                assert_eq!(peers[0].account, "bob".parse().unwrap());
                assert_eq!(peers[0].presence, PresenceStatus::Online);
            }
            other => panic!("expected PresenceSnapshot, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_golden_session_snapshot_frame() {
        let frame = decode_server_frame(SESSION_SNAPSHOT).unwrap();
        match frame {
            ServerFrame::SessionSnapshot {
                session_id,
                epoch,
                joined_participants,
                pending_participants,
            } => {
                assert_eq!(session_id, "wrtc:pair:alice:bob");
                assert_eq!(epoch, 2);
                assert_eq!(joined_participants, vec!["alice".parse().unwrap()]);
                assert_eq!(pending_participants, vec!["bob".parse().unwrap()]);
            }
            other => panic!("expected SessionSnapshot, got {other:?}"),
        }
    }
}
