use super::*;

#[test]
fn validate_purpose_accepts_chat_data_and_av_call() {
    assert!(validate_purpose(PURPOSE_CHAT_DATA).is_ok());
    assert!(validate_purpose(PURPOSE_AV_CALL).is_ok());
    assert!(validate_purpose("other").is_err());
}

#[test]
fn session_id_for_is_stable_prefix() {
    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let id = session_id_for("space:abc", PURPOSE_CHAT_DATA, &[alice, bob], 1, alice);
    assert!(id.starts_with("wrtc:"));
    let id2 = session_id_for("space:abc", PURPOSE_CHAT_DATA, &[alice, bob], 1, alice);
    assert_eq!(id, id2);
}

#[test]
fn session_is_expired_when_now_at_or_past_expires_at() {
    use crate::tables::SessionRow;

    let row = SessionRow {
        session_id: "wrtc:exp".into(),
        space_id: "space:1".into(),
        purpose: PURPOSE_CHAT_DATA.into(),
        status: SESSION_STATUS_ACTIVE,
        created_at: 0,
        expires_at: 1_000,
        created_by: "alice".parse().unwrap(),
    };
    assert!(!session_is_expired(&row, 999));
    assert!(session_is_expired(&row, 1_000));
    assert!(session_is_expired(&row, 1_001));
}

#[test]
fn session_is_not_expired_when_expires_at_zero() {
    use crate::tables::SessionRow;

    let row = SessionRow {
        session_id: "wrtc:no-exp".into(),
        space_id: "space:1".into(),
        purpose: PURPOSE_CHAT_DATA.into(),
        status: SESSION_STATUS_ACTIVE,
        created_at: 0,
        expires_at: 0,
        created_by: "alice".parse().unwrap(),
    };
    assert!(!session_is_expired(&row, i64::MAX / 2));
}
