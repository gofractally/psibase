pub mod trust {
    #[allow(dead_code)]
    pub enum TrustLevel {
        None,
        Low,
        Medium,
        High,
        Max,
    }

    pub fn unauthorized_error(fn_name: &str) -> String {
        format!("Unauthorized call to: {fn_name}")
    }

    pub trait TrustConfig {
        fn authorized(level: TrustLevel, fn_name: &str) -> Result<bool, String>;
        fn authorized_with_whitelist(
            level: TrustLevel,
            fn_name: &str,
            whitelist: &[&str],
        ) -> Result<bool, String>;
    }
}

pub struct PluginAuthorized;

impl trust::TrustConfig for PluginAuthorized {
    fn authorized(_level: trust::TrustLevel, _fn_name: &str) -> Result<bool, String> {
        Ok(true)
    }
    fn authorized_with_whitelist(
        _level: trust::TrustLevel,
        _fn_name: &str,
        _whitelist: &[&str],
    ) -> Result<bool, String> {
        Ok(true)
    }
}

pub struct PluginNotAuthorized;

impl trust::TrustConfig for PluginNotAuthorized {
    fn authorized(_level: trust::TrustLevel, _fn_name: &str) -> Result<bool, String> {
        Ok(false)
    }
    fn authorized_with_whitelist(
        _level: trust::TrustLevel,
        _fn_name: &str,
        _whitelist: &[&str],
    ) -> Result<bool, String> {
        Ok(false)
    }
}

pub struct PluginInvalid;

impl trust::TrustConfig for PluginInvalid {
    fn authorized(_level: trust::TrustLevel, _fn_name: &str) -> Result<bool, String> {
        Err("invalid (e.g. no logged in user, caller not allowed, etc.)".into())
    }
    fn authorized_with_whitelist(
        _level: trust::TrustLevel,
        _fn_name: &str,
        _whitelist: &[&str],
    ) -> Result<bool, String> {
        Err("invalid (e.g. no logged in user, caller not allowed, etc.)".into())
    }
}
