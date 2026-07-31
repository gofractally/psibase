use super::*;

#[test]
fn validate_purpose_accepts_chat_data_and_av_call() {
    assert!(validate_purpose(PURPOSE_CHAT_DATA).is_ok());
    assert!(validate_purpose(PURPOSE_AV_CALL).is_ok());
    assert!(validate_purpose("other").is_err());
}

#[test]
fn pair_session_id_for_is_lex_ordered() {
    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let id = pair_session_id_for(bob, alice);
    assert_eq!(id, "wrtc:pair:alice:bob");
    assert_eq!(pair_session_id_for(alice, bob), id);
}

#[test]
fn parse_pair_session_id_round_trip() {
    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let id = pair_session_id_for(alice, bob);
    let parsed = parse_pair_session_id(&id).unwrap();
    assert_eq!(parsed, vec![alice, bob]);
}

#[test]
fn authorize_pair_session_join_allows_e2e_group_pair_names() {
    let alice = "e2ealicegc".parse().unwrap();
    let carol = "e2ecarolgc".parse().unwrap();
    let id = "wrtc:pair:e2ealicegc:e2ecarolgc";
    let parsed = parse_pair_session_id(id).unwrap();
    assert_eq!(parsed, vec![alice, carol]);

    let alice_auth = authorize_session_join(id, alice, 0);
    assert!(alice_auth.authorized, "alice auth: {:?}", alice_auth);
    assert_eq!(alice_auth.purpose, PURPOSE_CHAT_DATA);

    let carol_auth = authorize_session_join(id, carol, 0);
    assert!(carol_auth.authorized);
}

#[test]
fn authorize_pair_session_join_allows_participants_only() {
    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    let id = pair_session_id_for(alice, bob);

    let alice_auth = authorize_session_join(&id, alice, 0);
    assert!(alice_auth.authorized);
    assert_eq!(alice_auth.purpose, PURPOSE_CHAT_DATA);
    assert_eq!(alice_auth.participants, vec![alice, bob]);
    assert_eq!(alice_auth.status, SESSION_STATUS_ACTIVE);

    let bob_auth = authorize_session_join(&id, bob, 0);
    assert!(bob_auth.authorized);

    let carol_auth = authorize_session_join(&id, carol, 0);
    assert!(!carol_auth.authorized);
}

#[test]
fn is_session_participant_recognizes_pair_ids() {
    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    let id = pair_session_id_for(alice, bob);

    assert!(is_session_participant(&id, alice));
    assert!(is_session_participant(&id, bob));
    assert!(!is_session_participant(&id, carol));
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
