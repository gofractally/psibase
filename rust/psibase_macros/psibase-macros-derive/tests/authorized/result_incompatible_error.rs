use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

impl PluginAuthorized {
    #[authorized(Medium)]
    fn returns_i32_error() -> Result<(), i32> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::returns_i32_error().is_ok());
}
