#![allow(non_snake_case)]

use crate::tables::WebRtcSessionEvent;
use crate::Wrapper;
use psibase::*;
use serde_json::{json, Value};

use super::helpers::setup_chat_http;

#[psibase::test_case(packages("Chat"))]
fn test_create_chat_data_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id.clone(), "chat-data".into())
        .get()?;

    assert!(session.session_id.starts_with("wrtc:"));
    assert_eq!(session.space_id, space.space_id);
    assert_eq!(session.purpose, "chat-data");
    assert_eq!(session.participants.len(), 2);
    assert_eq!(session.status, 1);

    let auth = Wrapper::push_from(&chain, alice)
        .authorizeSessionJoin(session.session_id.clone(), alice)
        .get()?;
    assert!(auth.authorized);
    assert!(!auth.expired);

    let bob_auth = Wrapper::push_from(&chain, bob)
        .authorizeSessionJoin(session.session_id.clone(), bob)
        .get()?;
    assert!(bob_auth.authorized);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_session_rejects_non_space_participant(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let err = Wrapper::push_from(&chain, carol)
        .createSession(space.space_id, "chat-data".into())
        .get()
        .expect_err("carol is not a space member");
    assert!(
        err.to_string().contains("not a member of space"),
        "unexpected error: {err}"
    );

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_session_rejects_unknown_space(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let err = Wrapper::push_from(&chain, alice)
        .createSession("space:missing".into(), "chat-data".into())
        .get()
        .expect_err("unknown space");
    assert!(err.to_string().contains("unknown space"));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_webrtc_session_event_from_sig_service(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let sig = "x-wrtcsig".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(sig).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
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

    let reloaded = Wrapper::push_from(&chain, alice)
        .getSession(session_id.clone())
        .get()?
        .expect("session exists");
    assert_eq!(reloaded.status, 1);

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 4,
            account: alice,
            reason: "ended".into(),
        })
        .get()?;

    let ended = Wrapper::push_from(&chain, alice)
        .getSession(session_id.clone())
        .get()?
        .expect("session still stored");
    assert_eq!(ended.status, 2);

    let auth = Wrapper::push_from(&chain, bob)
        .authorizeSessionJoin(session_id, bob)
        .get()?;
    assert!(!auth.authorized);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_webrtc_session_event_rejects_non_sig_sender(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;

    let err = Wrapper::push_from(&chain, alice)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session.session_id,
            kind: 1,
            account: bob,
            reason: "joined".into(),
        })
        .get()
        .expect_err("only x-wrtcsig may call webrtcSessionEvent");
    assert!(err.to_string().contains("x-wrtcsig"));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_session_returns_existing_active_session(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let first = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id.clone(), "chat-data".into())
        .get()?;
    let second = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;

    assert_eq!(first.session_id, second.session_id);
    assert_eq!(first.status, 1);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_close_session_by_participant(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;
    let session_id = session.session_id.clone();

    Wrapper::push_from(&chain, alice)
        .closeSession(session_id.clone(), "done".into())
        .get()?;

    let closed = Wrapper::push_from(&chain, alice)
        .getSession(session_id.clone())
        .get()?
        .expect("session still stored");
    assert_eq!(closed.status, 2);

    let auth = Wrapper::push_from(&chain, bob)
        .authorizeSessionJoin(session_id, bob)
        .get()?;
    assert!(!auth.authorized);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_close_session_rejects_non_participant(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;

    let err = Wrapper::push_from(&chain, carol)
        .closeSession(session.session_id, "nope".into())
        .get()
        .expect_err("carol is not a session participant");
    assert!(
        err.to_string().contains("not a participant"),
        "unexpected error: {err}"
    );

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_authorize_session_join_rejects_non_participant(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;

    let auth = Wrapper::push_from(&chain, carol)
        .authorizeSessionJoin(session.session_id, carol)
        .get()?;
    assert!(!auth.authorized);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_session_graphql_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();
    setup_chat_http(&chain)?;

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id.clone(), "chat-data".into())
        .get()?;

    let token = chain.login(alice, Wrapper::SERVICE)?;

    let reply: Value = chain.graphql_auth(
        Wrapper::SERVICE,
        &format!(
            r#"query {{
                activeSession(spaceId: "{}", purpose: "chat-data") {{
                    sessionId
                    purpose
                    status
                }}
                session(sessionId: "{}") {{
                    sessionId
                    spaceId
                    participants
                }}
                sessionJoinAuth(sessionId: "{}") {{
                    authorized
                    expired
                    purpose
                }}
            }}"#,
            space.space_id, session.session_id, session.session_id
        ),
        &token,
    )?;

    let active = reply.pointer("/data/activeSession").expect("activeSession");
    assert_eq!(active.get("sessionId"), Some(&json!(session.session_id)));
    assert_eq!(active.get("purpose"), Some(&json!("chat-data")));
    assert_eq!(active.get("status"), Some(&json!(1)));

    let loaded = reply.pointer("/data/session").expect("session");
    assert_eq!(loaded.get("sessionId"), Some(&json!(session.session_id)));
    assert_eq!(loaded.get("spaceId"), Some(&json!(space.space_id)));
    let participants = loaded
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("participants");
    assert_eq!(participants.len(), 2);

    let join_auth = reply
        .pointer("/data/sessionJoinAuth")
        .expect("sessionJoinAuth");
    assert_eq!(join_auth.get("authorized"), Some(&json!(true)));
    assert_eq!(join_auth.get("expired"), Some(&json!(false)));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_webrtc_session_event_participant_joined(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let sig = "x-wrtcsig".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(sig).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session.session_id.clone(),
            kind: 1,
            account: bob,
            reason: "joined".into(),
        })
        .get()?;

    let reloaded = Wrapper::push_from(&chain, alice)
        .getSession(session.session_id)
        .get()?
        .expect("session exists");
    assert_eq!(reloaded.status, 1);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_webrtc_session_event_session_failed(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let sig = "x-wrtcsig".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(sig).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_id, "chat-data".into())
        .get()?;
    let session_id = session.session_id.clone();

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 3,
            account: alice,
            reason: "failed".into(),
        })
        .get()?;

    let failed = Wrapper::push_from(&chain, alice)
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
