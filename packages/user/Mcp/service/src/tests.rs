//! Chain tests (run with cargo-psibase's tester: `cargo psibase test`).
use crate::Wrapper as Mcp;
use psibase::services::transact::ServiceMethod;
use psibase::*;

fn sm(s: &str, m: &str) -> Option<ServiceMethod> {
    Some(ServiceMethod::new(
        AccountNumber::from_exact(s).unwrap(),
        MethodNumber::from(m),
    ))
}

#[psibase::test_case(packages("Mcp"))]
fn allowlist_policy(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let (owner, agent) = (account!("owner"), account!("agent"));
    for a in [owner, agent] {
        chain.new_account(a)?;
    }
    Mcp::push_from(&chain, owner)
        .bootstrap(owner, None)
        .match_error("owner and agent must differ")?;
    Mcp::push_from(&chain, owner).bootstrap(agent, None).get()?;

    // Not allowlisted: only the owner.
    let p = Mcp::push(&chain)
        .get_policy(owner, sm("tokens", "credit"))
        .get()?;
    assert_eq!(p, vec![owner]);

    // Only the owner can grant
    Mcp::push_from(&chain, agent)
        .grant(owner, account!("tokens"), method!("credit"))
        .match_error("only the owner")?;
    Mcp::push_from(&chain, owner)
        .grant(owner, account!("tokens"), method!("credit"))
        .get()?;
    let p = Mcp::push(&chain)
        .get_policy(owner, sm("tokens", "credit"))
        .get()?;
    assert_eq!(p, vec![agent, owner]);
    assert!(Mcp::push(&chain)
        .isAuthSys(owner, vec![agent], sm("tokens", "credit"))
        .get()?);
    assert!(!Mcp::push(&chain)
        .isAuthSys(owner, vec![agent], sm("nft", "mint"))
        .get()?);

    // Banned methods are impossible and cannot be granted
    Mcp::push_from(&chain, owner)
        .grant(owner, account!("setcode"), method!("setCode"))
        .match_error("cannot be granted")?;
    let p = Mcp::push(&chain)
        .get_policy(owner, sm("setcode", "setCode"))
        .get()?;
    assert!(p.is_empty());
    Ok(())
}
