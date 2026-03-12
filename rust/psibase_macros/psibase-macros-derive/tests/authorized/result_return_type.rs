use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::{PluginAuthorized, PluginInvalid, PluginNotAuthorized};

impl PluginAuthorized {
    #[authorized(Medium)]
    fn returns_result() -> Result<(), String> {
        Ok(())
    }
}

impl PluginNotAuthorized {
    #[authorized(Medium)]
    fn returns_result() -> Result<(), String> {
        Ok(())
    }
}

impl PluginInvalid {
    #[authorized(Medium)]
    fn returns_result() -> Result<(), String> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::returns_result().is_ok());
    assert!(PluginNotAuthorized::returns_result().is_err());
    assert!(PluginInvalid::returns_result().is_err());
}
