use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

#[derive(Debug)]
struct CustomError(String);

impl From<String> for CustomError {
    fn from(s: String) -> Self {
        CustomError(s)
    }
}

impl PluginAuthorized {
    #[authorized(Medium)]
    fn returns_custom_error() -> Result<(), CustomError> {
        Ok(())
    }
}

fn main() {
    assert!(PluginAuthorized::returns_custom_error().is_ok());
}
