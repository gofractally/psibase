#![allow(non_snake_case)]

use crate::tables::WebRtcSessionEvent;
use crate::Wrapper;
use psibase::*;
use serde_json::{json, Value};

use super::helpers::setup_chat_http;

#[psibase::test_case(packages("Chat"))]
fn test_create_av_call_supersedes_existing_active_session(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let space = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    let first = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;
    let second = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid, "av-call".into(), vec![alice, bob])
        .get()?;

    assert_ne!(first.session_id, second.session_id);
    assert_eq!(second.status, 1);

    let first_row = Wrapper::push_from(&chain, alice)
        .getSession(first.session_id)
        .get()?
        .expect("first session stored");
    assert_eq!(first_row.status, 2);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_av_call_after_explicit_close(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let space = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    let first = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;

    Wrapper::push_from(&chain, alice)
        .closeSession(first.session_id.clone(), "done".into())
        .get()?;

    let second = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid, "av-call".into(), vec![alice, bob])
        .get()?;

    assert_ne!(first.session_id, second.session_id);
    assert_eq!(second.status, 1);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_av_call_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;

    assert!(session.session_id.starts_with("wrtc:"));
    assert_eq!(session.space_uuid, space.space_uuid);
    assert_eq!(session.purpose, "av-call");
    assert_eq!(session.participants.len(), 2);
    assert_eq!(session.status, 1);

    let auth = Wrapper::push_from(&chain, alice)
        .authorizeSessionJoin(session.session_id.clone(), alice)
        .get()?;
    assert!(auth.authorized);
    assert_eq!(auth.purpose, "av-call");
    assert_eq!(auth.participants.len(), 2);

    let bob_auth = Wrapper::push_from(&chain, bob)
        .authorizeSessionJoin(session.session_id.clone(), bob)
        .get()?;
    assert!(bob_auth.authorized);

    let events = Wrapper::push_from(&chain, alice)
        .getCallEvents(session.session_id.clone())
        .get()?;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, 1);
    assert_eq!(events[0].account, alice);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_group_av_call_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
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

    let session = Wrapper::push_from(&chain, alice)
        .createSession(group.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;

    assert_eq!(session.purpose, "av-call");
    assert_eq!(session.participants.len(), 3);
    assert!(session.participants.contains(&carol));

    for member in [alice, bob, carol] {
        let auth = Wrapper::push_from(&chain, member)
            .authorizeSessionJoin(session.session_id.clone(), member)
            .get()?;
        assert!(auth.authorized, "member {member} should be authorized");
        assert_eq!(auth.participants.len(), 3);
        assert_eq!(auth.purpose, "av-call");
    }

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_av_call_session_rejects_non_space_participant(
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
    let err = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid, "av-call".into(), vec![alice, carol])
        .get()
        .expect_err("carol is not a space member");
    assert!(
        err.to_string().contains("not a member of the space"),
        "unexpected error: {err}"
    );

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_create_group_av_call_session_rejects_non_space_member(
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
            group.space_uuid,
            "av-call".into(),
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
fn test_av_call_webrtc_session_event_translates_to_call_timeline(
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
        .createSession(space.space_uuid, "av-call".into(), vec![alice, bob])
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

    let events = Wrapper::push_from(&chain, alice)
        .getCallEvents(session_id.clone())
        .get()?;
    assert_eq!(events.len(), 3);
    let kinds: Vec<u8> = events.iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&1));
    assert!(kinds.contains(&2));
    assert!(kinds.contains(&5));
    assert!(events.iter().any(|e| e.kind == 2 && e.account == bob));
    assert!(events.iter().any(|e| e.kind == 5 && e.account == alice));

    let ended = Wrapper::push_from(&chain, alice)
        .getSession(session_id)
        .get()?
        .expect("session still stored");
    assert_eq!(ended.status, 2);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_av_call_timeline_graphql_surfaces_started_and_ended(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();
    setup_chat_http(&chain)?;

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let sig = "x-wrtcsig".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(sig).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let session = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;
    let session_id = session.session_id.clone();

    Wrapper::push_from(&chain, sig)
        .webrtcSessionEvent(WebRtcSessionEvent {
            session_id: session_id.clone(),
            kind: 4,
            account: alice,
            reason: "ended".into(),
        })
        .get()?;

    let token = chain.login(alice, Wrapper::SERVICE)?;
    let reply: Value = chain.graphql_auth(
        Wrapper::SERVICE,
        &format!(
            r#"query {{
                callEvents(spaceUuid: "{}") {{
                    sessionId
                    event
                    account
                    reason
                    at
                }}
            }}"#,
            space.space_uuid
        ),
        &token,
    )?;

    let events = reply
        .pointer("/data/callEvents")
        .and_then(|v| v.as_array())
        .expect("callEvents array");
    assert_eq!(events.len(), 2);
    let kinds: Vec<_> = events
        .iter()
        .filter_map(|row| row.get("event").and_then(|v| v.as_str()))
        .collect();
    assert!(kinds.contains(&"started"));
    assert!(kinds.contains(&"ended"));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_group_av_call_session_graphql_returns_full_participant_set(
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
        .createSession(group.space_uuid.clone(), "av-call".into(), vec![bob, alice])
        .get()?;

    let token = chain.login(alice, Wrapper::SERVICE)?;

    let reply: Value = chain.graphql_auth(
        Wrapper::SERVICE,
        &format!(
            r#"query {{
                activeSession(spaceUuid: "{}", purpose: "av-call") {{
                    sessionId
                    participants
                    purpose
                }}
                sessionJoinAuth(sessionId: "{}") {{
                    authorized
                    participants
                    purpose
                }}
            }}"#,
            group.space_uuid, session.session_id
        ),
        &token,
    )?;

    let active = reply.pointer("/data/activeSession").expect("activeSession");
    assert_eq!(active.get("sessionId"), Some(&json!(session.session_id)));
    assert_eq!(active.get("purpose"), Some(&json!("av-call")));
    let active_parts = active
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("activeSession participants");
    assert_eq!(active_parts.len(), 3);

    let join_auth = reply
        .pointer("/data/sessionJoinAuth")
        .expect("sessionJoinAuth");
    assert_eq!(join_auth.get("authorized"), Some(&json!(true)));
    assert_eq!(join_auth.get("purpose"), Some(&json!("av-call")));
    let auth_parts = join_auth
        .pointer("/participants")
        .and_then(|v| v.as_array())
        .expect("sessionJoinAuth participants");
    assert_eq!(auth_parts.len(), 3);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_chat_data_and_av_call_sessions_coexist_in_space(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    let chat_data = Wrapper::push_from(&chain, alice)
        .createSession(
            space.space_uuid.clone(),
            "chat-data".into(),
            vec![alice, bob],
        )
        .get()?;
    let av_call = Wrapper::push_from(&chain, alice)
        .createSession(space.space_uuid.clone(), "av-call".into(), vec![alice, bob])
        .get()?;

    assert_ne!(chat_data.session_id, av_call.session_id);
    assert_eq!(chat_data.purpose, "chat-data");
    assert_eq!(av_call.purpose, "av-call");

    Ok(())
}
