#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
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
}
