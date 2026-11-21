//! Pure transaction-context policy, also compiled directly for host regressions.
pub const MAX_PRE_PUBLISH_HOOKS: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionPin {
    pub bound: bool,
    pub user: Option<String>,
}

impl ConnectionPin {
    pub fn at_start(user: Option<String>) -> Self {
        Self {
            bound: user.is_some(),
            user,
        }
    }

    /// An initially logged-out context may log in before its first action.
    /// The first action fixes even a None connection (e.g. account creation
    /// using explicit sender/extra claims); later login/logout cannot mix it.
    pub fn bind_or_check(&mut self, current: Option<String>) -> Result<(), &'static str> {
        if !self.bound {
            self.bound = true;
            self.user = current;
            return Ok(());
        }
        self.validate(current.as_deref())
    }

    pub fn validate(&self, current: Option<&str>) -> Result<(), &'static str> {
        if self.bound && self.user.as_deref() == current {
            Ok(())
        } else {
            Err("connected account changed during transaction; review and submit again")
        }
    }
}

pub fn register_hook(
    hooks: &mut Vec<String>,
    service: &str,
    closed: bool,
) -> Result<(), &'static str> {
    if closed {
        return Err("transaction publication has already started");
    }
    if service.is_empty() {
        return Err("publication hook requires an authenticated service");
    }
    if hooks.iter().any(|s| s == service) {
        return Ok(());
    }
    if hooks.len() >= MAX_PRE_PUBLISH_HOOKS {
        return Err("too many pre-publication hooks (maximum 16)");
    }
    hooks.push(service.into());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn user(name: &str) -> Option<String> {
        Some(name.into())
    }
    #[test]
    fn selected_user_is_pinned_at_start_through_signing_and_publication() {
        let mut pin = ConnectionPin::at_start(user("alice"));
        assert!(pin.bind_or_check(user("alice")).is_ok());
        assert!(pin.bind_or_check(user("bob")).is_err());
        assert!(pin.validate(Some("bob")).is_err());
        assert!(pin.validate(None).is_err());
        assert_eq!(pin.user.as_deref(), Some("alice"));
        assert!(pin.validate(Some("alice")).is_ok());
    }
    #[test]
    fn initially_logged_out_can_connect_before_first_action_only() {
        let mut pin = ConnectionPin::at_start(None);
        assert!(pin.bind_or_check(user("alice")).is_ok());
        assert!(pin.bind_or_check(user("bob")).is_err());
        assert!(pin.bind_or_check(None).is_err());
    }
    #[test]
    fn explicit_sender_creation_can_keep_a_none_connection() {
        let mut pin = ConnectionPin::at_start(None);
        assert!(pin.bind_or_check(None).is_ok());
        assert!(pin.validate(None).is_ok());
        assert!(pin.bind_or_check(user("alice")).is_err());
        assert!(pin.validate(Some("alice")).is_err());
    }
    #[test]
    fn default_sender_uses_pin_despite_transient_cross_tab_change() {
        let mut pin = ConnectionPin::at_start(user("alice"));
        assert!(pin.bind_or_check(user("alice")).is_ok());
        // A temporary cross-tab Bob selection cannot change the captured default
        // sender even if Alice is selected again by the final validation.
        let captured_sender = pin.user.clone();
        assert!(pin.validate(Some("bob")).is_err());
        assert!(pin.validate(Some("alice")).is_ok());
        assert_eq!(captured_sender, user("alice"));
    }
    #[test]
    fn optional_hooks_deduplicate_and_enforce_bound() {
        let mut hooks = Vec::new();
        for i in 0..MAX_PRE_PUBLISH_HOOKS {
            register_hook(&mut hooks, &format!("app{i}"), false).unwrap();
        }
        assert_eq!(hooks.len(), 16);
        assert!(register_hook(&mut hooks, "app0", false).is_ok());
        assert!(register_hook(&mut hooks, "overflow", false).is_err());
        assert_eq!(hooks.len(), 16);
        assert!(register_hook(&mut hooks, "", false).is_err());
        assert!(register_hook(&mut hooks, "app0", true).is_err());
    }
    #[test]
    fn fresh_context_has_no_account_or_optional_hook_dependency() {
        let pin = ConnectionPin::at_start(None);
        assert!(!pin.bound);
        let hooks: Vec<String> = Vec::new();
        assert!(hooks.is_empty());
    }
}
