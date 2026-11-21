//! A prompt's packed payload belongs to its authenticating app principal.
pub fn can_read_context(caller: &str, prompt_app: &str) -> bool {
    !caller.is_empty() && caller == prompt_app
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn own_prompt_consumers_remain_authorized() {
        for app in ["tokens", "perms", "host"] {
            assert!(can_read_context(app, app));
        }
    }
    #[test]
    fn other_service_cannot_supply_a_forged_permission_or_token_context() {
        assert!(!can_read_context("perms", "evil"));
        assert!(!can_read_context("tokens", "evil"));
        assert!(!can_read_context("evil", "tokens"));
        assert!(!can_read_context("supervisor", "perms"));
        assert!(!can_read_context("", ""));
    }
}
