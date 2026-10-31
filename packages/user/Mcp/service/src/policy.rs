//! Pure allowlist logic for the X-MCP agent manager. No chain access, so it is
//! unit-testable natively (`cargo test -p mcp --lib policy`).

use psibase::{AccountNumber, MethodNumber};

/// Service/method pairs the agent can never be granted, and that the manager
/// answers with `DynamicAuthPolicy::impossible()` (auth changes, code changes,
/// and nested StagedTx use).
pub fn banned_pairs() -> Vec<(AccountNumber, MethodNumber)> {
    let p = |s: &str, m: &str| (AccountNumber::from_exact(s).unwrap(), MethodNumber::from(m));
    vec![
        p("accounts", "setAuthServ"),
        p("setcode", "setCode"),
        p("setcode", "setCodeStaged"),
        p("staged-tx", "propose"),
        p("staged-tx", "accept"),
        p("auth-dyn", "set_mgmt"),
        p("mcp", "set_agent"),
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

/// Who must authorize a given (service, method) for a managed account.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Decision {
    /// Allowlisted: the agent alone authorizes (auto-approve path).
    Agent,
    /// Not allowlisted: the parent (human) must approve.
    Parent,
    /// Never allowed through this manager.
    Impossible,
}

pub fn decide(
    method: Option<(AccountNumber, MethodNumber)>,
    is_allowed: impl Fn(AccountNumber, MethodNumber) -> bool,
) -> Decision {
    match method {
        // Nested authorizer checks carry no method: be conservative.
        None => Decision::Parent,
        Some((s, m)) if is_banned(s, m) => Decision::Impossible,
        Some((s, m)) if is_allowed(s, m) => Decision::Agent,
        Some(_) => Decision::Parent,
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
/// without the parent.
pub fn covered(
    actions: &[(AccountNumber, MethodNumber)],
    is_allowed: impl Fn(AccountNumber, MethodNumber) -> bool,
) -> bool {
    actions
        .iter()
        .all(|&(s, m)| decide(Some((s, m)), &is_allowed) == Decision::Agent)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sm(s: &str, m: &str) -> (AccountNumber, MethodNumber) {
        (AccountNumber::from_exact(s).unwrap(), MethodNumber::from(m))
    }
    fn allow(list: Vec<(AccountNumber, MethodNumber)>) -> impl Fn(AccountNumber, MethodNumber) -> bool {
        move |s, m| list.contains(&(s, m))
    }

    #[test]
    fn decide_paths() {
        let a = allow(vec![sm("tokens", "credit")]);
        assert_eq!(decide(Some(sm("tokens", "credit")), &a), Decision::Agent);
        assert_eq!(decide(Some(sm("nft", "mint")), &a), Decision::Parent);
        assert_eq!(decide(Some(sm("setcode", "setCode")), &a), Decision::Impossible);
        assert_eq!(decide(None, &a), Decision::Parent);
    }

    #[test]
    fn banned_cannot_be_allowlisted() {
        let a = allow(vec![sm("accounts", "setAuthServ")]);
        assert_eq!(decide(Some(sm("accounts", "setAuthServ")), &a), Decision::Impossible);
    }

    #[test]
    fn coverage_and_missing() {
        let a = allow(vec![sm("tokens", "credit")]);
        let tx = vec![sm("tokens", "credit"), sm("nft", "mint"), sm("nft", "mint"), sm("setcode", "setCode")];
        assert!(!covered(&tx, &a));
        assert_eq!(missing_pairs(&tx, &a), vec![sm("nft", "mint")]);
        assert!(covered(&tx[..1], &a));
    }
}
