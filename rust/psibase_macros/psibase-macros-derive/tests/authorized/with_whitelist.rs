use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

impl PluginAuthorized {
    #[authorized(Medium, whitelist = ["homepage"])]
    fn single_whitelist() -> Result<(), String> {
        Ok(())
    }

    #[authorized(High, whitelist = ["homepage", "virtual-server", "invite"])]
    fn multi_whitelist() -> Result<(), String> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::single_whitelist().is_ok());
    assert!(PluginAuthorized::multi_whitelist().is_ok());
}
