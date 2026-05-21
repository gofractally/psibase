#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::WebRtcSessionEvent;
    use crate::Wrapper;
    use psibase::services::http_server;
    use psibase::*;
    use serde_json::{json, Value};

    fn setup_chat_http(chain: &Chain) -> Result<(), psibase::Error> {
        http_server::Wrapper::push_from(chain, Wrapper::SERVICE)
            .registerServer(account!("r-chat"))
            .get()?;
        chain.finish_block();
        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_ensure_dm_and_group(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let dm = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        assert_eq!(dm.members.len(), 2);
        assert!(dm.members.contains(&alice));
        assert!(dm.members.contains(&bob));

        let dm_again = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        assert_eq!(dm.space_uuid, dm_again.space_uuid);

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        assert_eq!(group.members.len(), 3);

        let dave = AccountNumber::from("dave");
        chain.new_account(dave).unwrap();

        let dm_dave = Wrapper::push_from(&chain, alice).ensureDm(dave).get()?;
        assert_eq!(dm_dave.members.len(), 2);
        assert!(dm_dave.members.contains(&dave));

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_ensure_space_dm_and_group(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let dm = Wrapper::push_from(&chain, alice)
            .ensureSpace(vec![alice, bob])
            .get()?;
        assert_eq!(dm.members.len(), 2);

        let dm_via_action = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        assert_eq!(dm.space_uuid, dm_via_action.space_uuid);

        let group = Wrapper::push_from(&chain, alice)
            .ensureSpace(vec![carol, alice, bob])
            .get()?;
        assert_eq!(group.members.len(), 3);

        let group_via_action = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        assert_eq!(group.space_uuid, group_via_action.space_uuid);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_ensure_space_rejects_non_member_sender(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let err = Wrapper::push_from(&chain, alice)
            .ensureSpace(vec![bob])
            .get()
            .expect_err("caller must be in member list");
        assert!(err.to_string().contains("caller must be included"));

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_spaces_persist_after_blocks(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let dm = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;

        chain.finish_block();

        let listed = Wrapper::push_from(&chain, alice).spacesForSender().get()?;
        assert_eq!(listed.len(), 2);
        let uuids: Vec<_> = listed.iter().map(|s| s.space_uuid.clone()).collect();
        assert!(uuids.contains(&dm.space_uuid));
        assert!(uuids.contains(&group.space_uuid));

        let reloaded_dm = Wrapper::push_from(&chain, alice)
            .getSpace(dm.space_uuid.clone())
            .get()?
            .expect("dm space should still exist");
        assert_eq!(reloaded_dm.members, dm.members);

        let dm_again = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        assert_eq!(dm_again.space_uuid, dm.space_uuid);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_my_spaces_graphql_authed(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();
        setup_chat_http(&chain)?;

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let dm = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;

        let token = chain.login(alice, Wrapper::SERVICE)?;

        let reply: Value = chain.graphql_auth(
            Wrapper::SERVICE,
            r#"query {
                mySpaces {
                    spaceUuid
                    members
                    kind
                }
            }"#,
            &token,
        )?;

        let spaces = reply
            .pointer("/data/mySpaces")
            .and_then(|v| v.as_array())
            .expect("mySpaces array");
        assert_eq!(spaces.len(), 2);

        let dm_entry = spaces
            .iter()
            .find(|entry| entry.get("spaceUuid") == Some(&json!(dm.space_uuid)))
            .expect("dm space in mySpaces");
        assert_eq!(dm_entry.get("kind"), Some(&json!("DM")));
        assert_eq!(dm_entry.pointer("/members").and_then(|m| m.as_array()).map(|m| m.len()), Some(2));

        let unauth: Value = chain.graphql(
            Wrapper::SERVICE,
            r#"query { mySpaces { spaceUuid } }"#,
        )?;
        let errors = unauth
            .pointer("/errors")
            .and_then(|v| v.as_array())
            .expect("unauthenticated mySpaces should error");
        assert!(
            errors[0]
                .pointer("/message")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .contains("permission denied"),
            "unexpected error: {unauth:?}"
        );

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_create_group_chat_data_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
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
                group.space_uuid.clone(),
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;

        assert!(session.session_id.starts_with("wrtc:"));
        assert_eq!(session.space_uuid, group.space_uuid);
        assert_eq!(session.purpose, "chat-data");
        assert_eq!(session.participants.len(), 3);
        assert!(session.participants.contains(&alice));
        assert!(session.participants.contains(&bob));
        assert!(session.participants.contains(&carol));
        assert_eq!(session.lifecycle, 1);
        assert!(session.expires_at > session.created_at);

        for member in [alice, bob, carol] {
            let auth = Wrapper::push_from(&chain, member)
                .authorizeSessionJoin(session.session_id.clone(), member)
                .get()?;
            assert!(auth.authorized, "member {member} should be authorized");
            assert_eq!(auth.participants.len(), 3);
            assert_eq!(auth.space_uuid, group.space_uuid);
            assert_eq!(auth.purpose, "chat-data");
        }

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_create_group_session_rejects_non_space_member(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let dave = AccountNumber::from("dave");
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        let session = Wrapper::push_from(&chain, bob)
            .createSession(
                group.space_uuid.clone(),
                "chat-data".into(),
                vec![bob, alice, carol],
            )
            .get()?;

        let token = chain.login(alice, Wrapper::SERVICE)?;

        let reply: Value = chain.graphql_auth(
            Wrapper::SERVICE,
            &format!(
                r#"query {{
                    activeSession(spaceUuid: "{}", purpose: "chat-data") {{
                        sessionId
                        participants
                    }}
                    session(sessionId: "{}") {{
                        sessionId
                        spaceUuid
                        participants
                        purpose
                        lifecycle
                        expiresAt
                    }}
                    sessionJoinAuth(sessionId: "{}") {{
                        authorized
                        participants
                        spaceUuid
                    }}
                }}"#,
                group.space_uuid, session.session_id, session.session_id
            ),
            &token,
        )?;

        let active = reply
            .pointer("/data/activeSession")
            .expect("activeSession");
        assert_eq!(active.get("sessionId"), Some(&json!(session.session_id)));
        let active_parts = active
            .pointer("/participants")
            .and_then(|v| v.as_array())
            .expect("activeSession participants");
        assert_eq!(active_parts.len(), 3);

        let loaded = reply.pointer("/data/session").expect("session");
        assert_eq!(loaded.get("spaceUuid"), Some(&json!(group.space_uuid)));
        assert_eq!(loaded.get("purpose"), Some(&json!("chat-data")));
        assert_eq!(loaded.get("lifecycle"), Some(&json!(1)));
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
        assert_eq!(
            join_auth.get("spaceUuid"),
            Some(&json!(group.space_uuid))
        );

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_group_webrtc_session_event_joined_and_left(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        chain.new_account(sig).unwrap();

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                group.space_uuid,
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
        assert_eq!(active.lifecycle, 1);
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
        assert_eq!(still_active.lifecycle, 1);

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
        assert_eq!(failed.lifecycle, 3);

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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let dave = AccountNumber::from("dave");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        chain.new_account(dave).unwrap();

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                group.space_uuid,
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

    #[psibase::test_case(packages("Chat"))]
    fn test_create_chat_data_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid.clone(),
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;

        assert!(session.session_id.starts_with("wrtc:"));
        assert_eq!(session.space_uuid, space.space_uuid);
        assert_eq!(session.purpose, "chat-data");
        assert_eq!(session.participants.len(), 2);
        assert_eq!(session.lifecycle, 1);

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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let err = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, carol],
            )
            .get()
            .expect_err("carol is not a space member");
        assert!(
            err.to_string().contains("not a member of the space"),
            "unexpected error: {err}"
        );

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_create_session_rejects_unknown_space(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let err = Wrapper::push_from(&chain, alice)
            .createSession("space:missing".into(), "chat-data".into(), vec![alice, bob])
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(sig).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
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

        let reloaded = Wrapper::push_from(&chain, alice)
            .getSession(session_id.clone())
            .get()?
            .expect("session exists");
        assert_eq!(reloaded.lifecycle, 1);

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
        assert_eq!(ended.lifecycle, 2);

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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;

        let err = Wrapper::push_from(&chain, alice)
            .webrtcSessionEvent(WebRtcSessionEvent {
                session_id: session.session_id,
                kind: 1,
                account: bob,
                reason: "joined".into(),
            })
            .get()
            .expect_err("only x-webrtcsig may call webrtcSessionEvent");
        assert!(err.to_string().contains("x-webrtcsig"));

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_create_session_returns_existing_active_session(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let first = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid.clone(),
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;
        let second = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;

        assert_eq!(first.session_id, second.session_id);
        assert_eq!(first.lifecycle, 1);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_close_session_by_participant(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;
        let session_id = session.session_id.clone();

        Wrapper::push_from(&chain, alice)
            .closeSession(session_id.clone(), "done".into())
            .get()?;

        let closed = Wrapper::push_from(&chain, alice)
            .getSession(session_id.clone())
            .get()?
            .expect("session still stored");
        assert_eq!(closed.lifecycle, 2);

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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid.clone(),
                "chat-data".into(),
                vec![alice, bob],
            )
            .get()?;

        let token = chain.login(alice, Wrapper::SERVICE)?;

        let reply: Value = chain.graphql_auth(
            Wrapper::SERVICE,
            &format!(
                r#"query {{
                    activeSession(spaceUuid: "{}", purpose: "chat-data") {{
                        sessionId
                        purpose
                        lifecycle
                    }}
                    session(sessionId: "{}") {{
                        sessionId
                        spaceUuid
                        participants
                    }}
                    sessionJoinAuth(sessionId: "{}") {{
                        authorized
                        expired
                        purpose
                    }}
                }}"#,
                space.space_uuid, session.session_id, session.session_id
            ),
            &token,
        )?;

        let active = reply
            .pointer("/data/activeSession")
            .expect("activeSession");
        assert_eq!(active.get("sessionId"), Some(&json!(session.session_id)));
        assert_eq!(active.get("purpose"), Some(&json!("chat-data")));
        assert_eq!(active.get("lifecycle"), Some(&json!(1)));

        let loaded = reply.pointer("/data/session").expect("session");
        assert_eq!(loaded.get("sessionId"), Some(&json!(session.session_id)));
        assert_eq!(loaded.get("spaceUuid"), Some(&json!(space.space_uuid)));
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(sig).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
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
        assert_eq!(reloaded.lifecycle, 1);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_webrtc_session_event_session_failed(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(sig).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "chat-data".into(),
                vec![alice, bob],
            )
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
        assert_eq!(failed.lifecycle, 3);

        let auth = Wrapper::push_from(&chain, bob)
            .authorizeSessionJoin(session_id, bob)
            .get()?;
        assert!(!auth.authorized);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_create_av_call_session(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid.clone(),
                "av-call".into(),
                vec![alice, bob],
            )
            .get()?;

        assert!(session.session_id.starts_with("wrtc:"));
        assert_eq!(session.space_uuid, space.space_uuid);
        assert_eq!(session.purpose, "av-call");
        assert_eq!(session.participants.len(), 2);
        assert_eq!(session.lifecycle, 1);

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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;

        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                group.space_uuid.clone(),
                "av-call".into(),
                vec![alice, bob],
            )
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let err = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "av-call".into(),
                vec![alice, carol],
            )
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let dave = AccountNumber::from("dave");
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(sig).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid,
                "av-call".into(),
                vec![alice, bob],
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

        let reloaded = Wrapper::push_from(&chain, alice)
            .getSession(session_id.clone())
            .get()?
            .expect("session exists");
        assert_eq!(reloaded.lifecycle, 1);

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
        assert_eq!(ended.lifecycle, 2);

        Ok(())
    }

    #[psibase::test_case(packages("Chat"))]
    fn test_av_call_timeline_graphql_surfaces_started_and_ended(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();
        setup_chat_http(&chain)?;

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let sig = account!("x-webrtcsig");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(sig).unwrap();

        let space = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
        let session = Wrapper::push_from(&chain, alice)
            .createSession(
                space.space_uuid.clone(),
                "av-call".into(),
                vec![alice, bob],
            )
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let group = Wrapper::push_from(&chain, alice)
            .ensureGroup(vec![bob, carol])
            .get()?;
        let session = Wrapper::push_from(&chain, bob)
            .createSession(
                group.space_uuid.clone(),
                "av-call".into(),
                vec![bob, alice],
            )
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

        let active = reply
            .pointer("/data/activeSession")
            .expect("activeSession");
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

        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
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
            .createSession(
                space.space_uuid.clone(),
                "av-call".into(),
                vec![alice, bob],
            )
            .get()?;

        assert_ne!(chat_data.session_id, av_call.session_id);
        assert_eq!(chat_data.purpose, "chat-data");
        assert_eq!(av_call.purpose, "av-call");

        Ok(())
    }
}
