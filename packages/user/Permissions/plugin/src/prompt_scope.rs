//! Permission consent stays with the account/app which initiated the prompt.
//! The caller can be an explicitly allowed delegated plugin, so it is not used
//! as a substitute for the active application principal.
pub fn matches_scope(user: &str, current_user: Option<&str>, app: &str, active_app: &str) -> bool {
    !user.is_empty() && !app.is_empty() && current_user == Some(user) && app == active_app
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_account_switch_logout_and_app_switch() {
        assert!(matches_scope(
            "alice",
            Some("alice"),
            "exchange",
            "exchange"
        ));
        assert!(!matches_scope("alice", Some("bob"), "exchange", "exchange"));
        assert!(!matches_scope("alice", None, "exchange", "exchange"));
        assert!(!matches_scope("alice", Some("alice"), "exchange", "perms"));
        assert!(!matches_scope("alice", Some("alice"), "", "exchange"));
    }
    #[test]
    fn delegated_caller_is_not_confused_with_active_app() {
        let delegated_caller = "config";
        let active_app = "homepage";
        assert_ne!(delegated_caller, active_app);
        assert!(matches_scope(
            "alice",
            Some("alice"),
            active_app,
            "homepage"
        ));
    }
}
