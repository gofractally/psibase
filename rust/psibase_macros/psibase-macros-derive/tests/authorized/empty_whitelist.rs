use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

impl PluginAuthorized {
    #[authorized(Medium, whitelist = [])]
    fn empty_whitelist() -> Result<(), String> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::empty_whitelist().is_ok());
}
