use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;

struct MyPlugin;

impl psibase_plugin::trust::TrustConfig for MyPlugin {
    fn assert_authorized(
        _level: psibase_plugin::trust::TrustLevel,
        _fn_name: &str,
    ) -> Result<(), String> {
        Ok(())
    }
    fn assert_authorized_with_whitelist(
        _level: psibase_plugin::trust::TrustLevel,
        _fn_name: &str,
        _whitelist: &[&str],
    ) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Debug)]
struct CustomError(String);

impl From<String> for CustomError {
    fn from(s: String) -> Self {
        CustomError(s)
    }
}

impl MyPlugin {
    #[authorized(Medium)]
    fn returns_custom_error() -> Result<(), CustomError> {
        Ok(())
    }
}

fn main() {
    let _ = MyPlugin::returns_custom_error();
}
