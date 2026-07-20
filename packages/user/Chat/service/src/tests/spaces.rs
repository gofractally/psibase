#![allow(non_snake_case)]

use crate::Wrapper;
use psibase::*;
use serde_json::{json, Value};

use super::helpers::setup_chat_http;

#[psibase::test_case(packages("Chat"))]
fn test_ensure_dm_and_group(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let dm = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    assert_eq!(dm.members.len(), 2);
    assert!(dm.members.contains(&alice));
    assert!(dm.members.contains(&bob));

    let dm_again = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    assert_eq!(dm.space_id, dm_again.space_id);

    let group = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    assert_eq!(group.members.len(), 3);

    let dave = "dave".parse().unwrap();
    chain.new_account(dave).unwrap();

    let dm_dave = Wrapper::push_from(&chain, alice).ensureDm(dave).get()?;
    assert_eq!(dm_dave.members.len(), 2);
    assert!(dm_dave.members.contains(&dave));

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_ensure_space_dm_and_group(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();
    chain.new_account(carol).unwrap();

    let dm = Wrapper::push_from(&chain, alice)
        .ensureSpace(vec![alice, bob])
        .get()?;
    assert_eq!(dm.members.len(), 2);

    let dm_via_action = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    assert_eq!(dm.space_id, dm_via_action.space_id);

    let group = Wrapper::push_from(&chain, alice)
        .ensureSpace(vec![carol, alice, bob])
        .get()?;
    assert_eq!(group.members.len(), 3);

    let group_via_action = Wrapper::push_from(&chain, alice)
        .ensureGroup(vec![bob, carol])
        .get()?;
    assert_eq!(group.space_id, group_via_action.space_id);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_ensure_space_rejects_non_member_sender(
    chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
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

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
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
    let ids: Vec<_> = listed.iter().map(|s| s.space_id.clone()).collect();
    assert!(ids.contains(&dm.space_id));
    assert!(ids.contains(&group.space_id));

    let reloaded_dm = Wrapper::push_from(&chain, alice)
        .getSpace(dm.space_id.clone())
        .get()?
        .expect("dm space should still exist");
    assert_eq!(reloaded_dm.members, dm.members);

    let dm_again = Wrapper::push_from(&chain, alice).ensureDm(bob).get()?;
    assert_eq!(dm_again.space_id, dm.space_id);

    Ok(())
}

#[psibase::test_case(packages("Chat"))]
fn test_my_spaces_graphql_authed(chain: psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init();
    setup_chat_http(&chain)?;

    let alice = "alice".parse().unwrap();
    let bob = "bob".parse().unwrap();
    let carol = "carol".parse().unwrap();
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
                spaceId
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
        .find(|entry| entry.get("spaceId") == Some(&json!(dm.space_id)))
        .expect("dm space in mySpaces");
    assert_eq!(dm_entry.get("kind"), Some(&json!("DM")));
    assert_eq!(
        dm_entry
            .pointer("/members")
            .and_then(|m| m.as_array())
            .map(|m| m.len()),
        Some(2)
    );

    let unauth: Value =
        chain.graphql(Wrapper::SERVICE, r#"query { mySpaces { spaceId } }"#)?;
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
