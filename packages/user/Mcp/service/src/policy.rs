//! Pure allowlist logic for the X-MCP owner auth service. No chain access, so it is
//! unit-testable natively (`cargo test -p mcp --lib policy`).

use psibase::{AccountNumber, MethodNumber};

/// Service/method pairs the agent can never be granted, and that the manager
/// treats as impossible on the staged path (auth/key changes, code changes,
/// nested StagedTx use, and mcp's own admin actions).
pub fn banned_pairs() -> Vec<(AccountNumber, MethodNumber)> {
    let p = |s: &str, m: &str| (AccountNumber::from_exact(s).unwrap(), MethodNumber::from(m));
    vec![
        p("accounts", "setAuthServ"),
        p("auth-sig", "setKey"),
        p("setcode", "setCode"),
        p("setcode", "setCodeStaged"),
        p("staged-tx", "propose"),
        p("staged-tx", "accept"),
        p("auth-dyn", "set_mgmt"),
        p("mcp", "set_agent"),
        p("mcp", "set_enforcer"),
        p("mcp", "set_limits"),
        p("mcp", "enforce"),
        p("mcp", "bootstrap"),
        p("mcp", "grant"),
        p("mcp", "grant_missing"),
        p("mcp", "revoke"),
    ]
}

pub fn is_banned(service: AccountNumber, method: MethodNumber) -> bool {
    banned_pairs()
        .iter()
        .any(|(s, m)| *s == service && *m == method)
}

/// Who must authorize a given (service, method) for an owner account.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Decision {
    /// Allowlisted: agent plus optional enforcer, or the owner alone.
    Agent,
    /// Not allowlisted: the owner (human) must accept with their key.
    Owner,
    /// Never allowed through this manager.
    Impossible,
}

pub fn decide(
    method: Option<(AccountNumber, MethodNumber)>,
    is_allowed: impl Fn(AccountNumber, MethodNumber) -> bool,
) -> Decision {
    match method {
        // Nested authorizer checks carry no method: be conservative.
        None => Decision::Owner,
        Some((s, m)) if is_banned(s, m) => Decision::Impossible,
        Some((s, m)) if is_allowed(s, m) => Decision::Agent,
        Some(_) => Decision::Owner,
    }
}

/// The distinct (service, method) pairs in `actions` that are not yet on the
/// allowlist and are grantable (not banned). Order of first appearance.
pub fn missing_pairs(
    actions: &[(AccountNumber, MethodNumber)],
    is_allowed: impl Fn(AccountNumber, MethodNumber) -> bool,
) -> Vec<(AccountNumber, MethodNumber)> {
    let mut out: Vec<(AccountNumber, MethodNumber)> = Vec::new();
    for &(s, m) in actions {
        if !is_banned(s, m) && !is_allowed(s, m) && !out.contains(&(s, m)) {
            out.push((s, m));
        }
    }
    out
}

/// True when every action is allowlisted, i.e. the agent's proposal executes
/// without the owner.
pub fn covered(
    actions: &[(AccountNumber, MethodNumber)],
    is_allowed: impl Fn(AccountNumber, MethodNumber) -> bool,
) -> bool {
    actions
        .iter()
        .all(|&(s, m)| decide(Some((s, m)), &is_allowed) == Decision::Agent)
}

/// Accounts that can authorize on the staged path for `decision`.
pub fn authorizers(
    owner: AccountNumber,
    agent: Option<AccountNumber>,
    enforcer: Option<AccountNumber>,
    decision: Decision,
) -> Vec<AccountNumber> {
    match (decision, agent) {
        (Decision::Agent, Some(agent)) => {
            let mut out = vec![agent, owner];
            if let Some(enforcer) = enforcer {
                out.push(enforcer);
            }
            out
        }
        (Decision::Impossible, _) => vec![],
        _ => vec![owner],
    }
}

/// `isAuthSys`: allowlisted methods require the agent and the configured
/// enforcer, if any. The owner alone suffices except for banned methods.
pub fn is_approved(
    owner: AccountNumber,
    agent: Option<AccountNumber>,
    enforcer: Option<AccountNumber>,
    decision: Decision,
    accepters: &[AccountNumber],
) -> bool {
    if decision == Decision::Impossible {
        return false;
    }
    if accepters.contains(&owner) {
        return true;
    }
    decision == Decision::Agent
        && agent.is_some_and(|a| accepters.contains(&a))
        && enforcer.is_none_or(|e| accepters.contains(&e))
}

/// `isRejectSys`: the owner can always reject; an impossible tx can always be
/// cleared. The agent cannot reject on the owner's behalf.
pub fn is_rejected(owner: AccountNumber, decision: Decision, rejecters: &[AccountNumber]) -> bool {
    decision == Decision::Impossible || rejecters.contains(&owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sm(s: &str, m: &str) -> (AccountNumber, MethodNumber) {
        (AccountNumber::from_exact(s).unwrap(), MethodNumber::from(m))
    }
    fn allow(
        list: Vec<(AccountNumber, MethodNumber)>,
    ) -> impl Fn(AccountNumber, MethodNumber) -> bool {
        move |s, m| list.contains(&(s, m))
    }

    #[test]
    fn decide_paths() {
        let a = allow(vec![sm("tokens", "credit")]);
        assert_eq!(decide(Some(sm("tokens", "credit")), &a), Decision::Agent);
        assert_eq!(decide(Some(sm("nft", "mint")), &a), Decision::Owner);
        assert_eq!(
            decide(Some(sm("setcode", "setCode")), &a),
            Decision::Impossible
        );
        assert_eq!(decide(None, &a), Decision::Owner);
    }

    #[test]
    fn staged_auth() {
        let owner = AccountNumber::from_exact("owner").unwrap();
        let agent = AccountNumber::from_exact("agent").unwrap();
        let other = AccountNumber::from_exact("other").unwrap();
        // Allowlisted: agent's implicit accept alone executes; owner also suffices.
        assert!(is_approved(
            owner,
            Some(agent),
            None,
            Decision::Agent,
            &[agent]
        ));
        assert!(is_approved(
            owner,
            Some(agent),
            None,
            Decision::Agent,
            &[owner]
        ));
        assert!(!is_approved(
            owner,
            Some(agent),
            None,
            Decision::Agent,
            &[other]
        ));
        // Not allowlisted: owner must accept.
        assert!(!is_approved(
            owner,
            Some(agent),
            None,
            Decision::Owner,
            &[agent]
        ));
        assert!(is_approved(
            owner,
            Some(agent),
            None,
            Decision::Owner,
            &[agent, owner]
        ));
        // Banned: nobody.
        assert!(!is_approved(
            owner,
            Some(agent),
            None,
            Decision::Impossible,
            &[agent, owner]
        ));
        // No agent registered: behaves like AuthSig.
        assert!(!is_approved(owner, None, None, Decision::Agent, &[agent]));
        assert!(is_approved(owner, None, None, Decision::Agent, &[owner]));
        // Reject: owner only (or always, for impossible).
        assert!(is_rejected(owner, Decision::Agent, &[owner]));
        assert!(!is_rejected(owner, Decision::Agent, &[agent]));
        assert!(is_rejected(owner, Decision::Impossible, &[]));
        assert_eq!(
            authorizers(owner, Some(agent), None, Decision::Owner),
            vec![owner]
        );
    }

    #[test]
    fn enforcer_threshold() {
        let owner = AccountNumber::from_exact("owner").unwrap();
        let agent = AccountNumber::from_exact("agent").unwrap();
        let enforcer = AccountNumber::from_exact("enforcer").unwrap();
        let approved = |decision, votes: &[AccountNumber]| {
            is_approved(owner, Some(agent), Some(enforcer), decision, votes)
        };
        assert!(!approved(Decision::Agent, &[agent]));
        assert!(!approved(Decision::Agent, &[enforcer]));
        assert!(approved(Decision::Agent, &[agent, enforcer]));
        assert!(approved(Decision::Agent, &[owner]));
        assert!(approved(Decision::Owner, &[owner]));
        assert!(!approved(Decision::Owner, &[agent, enforcer]));
        assert!(!approved(Decision::Impossible, &[owner, agent, enforcer]));
        assert!(!is_rejected(owner, Decision::Agent, &[agent, enforcer]));
        for method in ["set_enforcer", "set_limits", "enforce"] {
            assert!(is_banned(sm("mcp", method).0, sm("mcp", method).1));
        }
    }

    #[test]
    fn key_changes_are_banned() {
        assert!(is_banned(
            sm("auth-sig", "setKey").0,
            sm("auth-sig", "setKey").1
        ));
    }

    #[test]
    fn banned_cannot_be_allowlisted() {
        let a = allow(vec![sm("accounts", "setAuthServ")]);
        assert_eq!(
            decide(Some(sm("accounts", "setAuthServ")), &a),
            Decision::Impossible
        );
    }

    #[test]
    fn coverage_and_missing() {
        let a = allow(vec![sm("tokens", "credit")]);
        let tx = vec![
            sm("tokens", "credit"),
            sm("nft", "mint"),
            sm("nft", "mint"),
            sm("setcode", "setCode"),
        ];
        assert!(!covered(&tx, &a));
        assert_eq!(missing_pairs(&tx, &a), vec![sm("nft", "mint")]);
        assert!(covered(&tx[..1], &a));
    }
}
