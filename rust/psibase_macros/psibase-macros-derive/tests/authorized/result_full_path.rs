use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

impl PluginAuthorized {
    #[authorized(Low)]
    fn returns_std_result() -> std::result::Result<(), String> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::returns_std_result().is_ok());
}
