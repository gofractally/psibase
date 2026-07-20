#![allow(non_snake_case)]

use crate::tables::WebRtcSessionEvent;
use crate::Wrapper;
use psibase::*;
use serde_json::{json, Value};

use super::helpers::setup_chat_http;

#[psibase::test_case(packages("Chat"))]
fn test_create_group_chat_data_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    assert_eq!(group.members.len(), 3);

    // Caller may pass a subset; group chat-data resolves to all Space members (N-party).
    let session = Wrapper::push_from(&chain, alice)
        .createSession(
            group.space_id.clone(),
            "chat-data".into(),
            vec![alice, bob],
        )
        .get()?;

    assert!(session.session_id.starts_with("wrtc:"));
    assert_eq!(session.space_id, group.space_id);
    assert_eq!(session.purpose, "chat-data");
    assert_eq!(session.participants.len(), 3);
    assert!(session.participants.contains(&alice));
    assert!(session.participants.contains(&bob));
    assert!(session.participants.contains(&carol));
    assert_eq!(session.status, 1);
    assert!(session.expires_at > session.created_at);

    for member in [alice, bob, carol] {
        let auth = Wrapper::push_from(&chain, member)
            .authorizeSessionJoin(session.session_id.clone(), member)
            .get()?;
        assert!(auth.authorized, "member {member} should be authorized");
        assert_eq!(auth.participants.len(), 3);
        assert_eq!(auth.space_id, group.space_id);
        assert_eq!(auth.purpose, "chat-data");
    }

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_group_session_rejects_non_space_member(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    let dave = "dave".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();
    chain.new_account(dave).unwrap();

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;

    let err = Wrapper::push_from(&chain, dave)
        .createSession(
            group.space_id,
            "chat-data".into(),
            vec![dave, alice, bob, carol],
        )
        .get()
        .expect_err("dave is not a space member");
    assert!(
        err.to_string().contains("not a member of space"),
        "unexpected error: {err}"
    );

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_group_session_graphql_returns_full_participant_set(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();
    setup_chat_http(&chain)?;

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    let session = Wrapper::push_from(&chain, bob)
        .createSession(
            group.space_id.clone(),
            "chat-data".into(),
            vec![bob, alice, carol],
        )
        .get()?;

    let token = chain.login(alice, Wrapper::SERVICE)?;

    let reply: Value = chain.graphql_auth(
        Wrapper::SERVICE,
        &format!(
            r#"query {{
                activeSession(spaceId: "{}", purpose: "chat-data") {{
                    sessionId
                    participants
                }}
                session(sessionId: "{}") {{
                    sessionId
                    spaceId
                    participants
                    purpose
                    status
                    expiresAt
                }}
                sessionJoinAuth(sessionId: "{}") {{
                    authorized
                    participants
                    spaceId
                }}
            }}"#,
            group.space_id, session.session_id, session.session_id
        ),
        &token,
    )?;

    let active = reply.pointer("/data/activeSession").expect("activeSession");
    assert_eq!(active.get("sessionId"), Some(&json!(session.session_id)));
    let active_parts = active
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("activeSession participants");
    assert_eq!(active_parts.len(), 3);

    let loaded = reply.pointer("/data/session").expect("session");
    assert_eq!(loaded.get("spaceId"), Some(&json!(group.space_id)));
    assert_eq!(loaded.get("purpose"), Some(&json!("chat-data")));
    assert_eq!(loaded.get("status"), Some(&json!(1)));
    let participants = loaded
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("session participants");
    assert_eq!(participants.len(), 3);

    let join_auth = reply
        .pointer("/data/sessionJoinAuth")
        .expect("sessionJoinAuth");
    assert_eq!(join_auth.get("authorized"), Some(&json!(true)));
    let auth_parts = join_auth
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("sessionJoinAuth participants");
    assert_eq!(auth_parts.len(), 3);
    assert_eq!(join_auth.get("spaceId"), Some(&json!(group.space_id)));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_group_webrtc_session_event_joined_and_left(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    let sig = "x-wrtcsig".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();
    chain.new_account(sig).unwrap();

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(
            group.space_id,
            "chat-data".into(),
            vec![alice, bob, carol],
        )
        .get()?;
    let session_id = session.session_id.clone();

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 1,
            account: bob,
            reason: "joined".into(),
        })
        .get()?;

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 1,
            account: carol,
            reason: "joined".into(),
        })
        .get()?;

    let active = Wrapper::push_from(&chain, alice)
        .getSession(session_id.clone())
        .get()?
        .expect("session exists");
    assert_eq!(active.status, 1);
    assert_eq!(active.participants.len(), 3);

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 2,
            account: bob,
            reason: "left".into(),
        })
        .get()?;

    let still_active = Wrapper::push_from(&chain, alice)
        .getSession(session_id.clone())
        .get()?
        .expect("session still active after one participant left");
    assert_eq!(still_active.status, 1);

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 3,
            account: alice,
            reason: "failed".into(),
        })
        .get()?;

    let failed = Wrapper::push_from(&chain, carol)
        .getSession(session_id.clone())
        .get()?
        .expect("session still stored");
    assert_eq!(failed.status, 3);

    let auth = Wrapper::push_from(&chain, bob)
        .authorizeSessionJoin(session_id, bob)
        .get()?;
    assert!(!auth.authorized);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_group_authorize_session_join_rejects_non_member(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    let dave = "dave".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();
    chain.new_account(dave).unwrap();

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(
            group.space_id,
            "chat-data".into(),
            vec![alice, bob, carol],
        )
        .get()?;

    let auth = Wrapper::push_from(&chain, dave)
        .authorizeSessionJoin(session.session_id, dave)
        .get()?;
    assert!(!auth.authorized);

    Ok(())
}
