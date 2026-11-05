//! Chain tests (run with cargo-psibase's tester: `cargo psibase test`).
use crate::Wrapper as Mcp;
use psibase::services::accounts::Wrapper as Accounts;
use psibase::services::auth_dyn::Wrapper as AuthDyn;
use psibase::services::transact::ServiceMethod;
use psibase::*;

fn sm(s: &str, m: &str) -> Option<ServiceMethod> {
    Some(ServiceMethod::new(AccountNumber::from_exact(s).unwrap(), MethodNumber::from(m)))
}

#[psibase::test_case(packages("Mcp"))]
fn allowlist_policy(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let (alice, agent, parent) = (account!("alice"), account!("agent"), account!("parent"));
    for a in [alice, agent, parent] {
        chain.new_account(a)?;
    }
    Mcp::push_from(&chain, alice).set_agent(agent, parent).get()?;
    assert!(Mcp::push(&chain).has_policy(alice).get()?);

    let p = Mcp::push(&chain).get_policy(alice, sm("tokens", "credit")).get()?;
    assert_eq!(p.authorizers[0].account, parent);

    // Only the parent can grant
    Mcp::push_from(&chain, agent)
        .grant(alice, account!("tokens"), method!("credit"))
        .match_error("only the parent")?;
    Mcp::push_from(&chain, parent)
        .grant(alice, account!("tokens"), method!("credit"))
        .get()?;
    let p = Mcp::push(&chain).get_policy(alice, sm("tokens", "credit")).get()?;
    assert_eq!(p.authorizers[0].account, agent);

    // Banned methods are impossible and cannot be granted
    Mcp::push_from(&chain, parent)
        .grant(alice, account!("setcode"), method!("setCode"))
        .match_error("cannot be granted")?;
    let p = Mcp::push(&chain).get_policy(alice, sm("setcode", "setCode")).get()?;
    assert!(p.authorizers.is_empty() || p.threshold > p.authorizers.len() as u8);
    Ok(())
}

#[psibase::test_case(packages("Mcp", "AuthDyn"))]
fn bootstrap_creates_managed(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let (managed, agent, parent) = (
        account!("managed1"),
        account!("agentxyz"),
        account!("parentxy"),
    );
    for a in [agent, parent] {
        chain.new_account(a)?;
    }
    Mcp::push_from(&chain, parent)
        .bootstrap(managed, agent)
        .get()?;
    assert!(Accounts::push(&chain).exists(managed).get()?);
    assert_eq!(
        Accounts::push(&chain).getAuthOf(managed).get()?,
        AuthDyn::SERVICE
    );
    assert!(Mcp::push(&chain).has_policy(managed).get()?);
    let p = Mcp::push(&chain)
        .get_policy(managed, sm("profiles", "setProfile"))
        .get()?;
    assert_eq!(p.authorizers[0].account, parent);
    Ok(())
}
