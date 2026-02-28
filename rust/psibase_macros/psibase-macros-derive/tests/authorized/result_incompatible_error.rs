use psibase_macros_derive::authorized;

#[path = "types_mock_incompatible_error.rs"]
mod psibase_plugin;

struct MyPlugin;

impl psibase_plugin::trust::TrustConfig for MyPlugin {
    fn assert_authorized(
        _level: psibase_plugin::trust::TrustLevel,
        _fn_name: &str,
    ) -> Result<(), i32> {
        Ok(())
    }
    fn assert_authorized_with_whitelist(
        _level: psibase_plugin::trust::TrustLevel,
        _fn_name: &str,
        _whitelist: &[&str],
    ) -> Result<(), i32> {
        Ok(())
    }
}

impl MyPlugin {
    #[authorized(Medium)]
    fn returns_string_error() -> Result<(), String> {
        Ok(())
    }
}

fn main() {
    let _ = MyPlugin::returns_string_error();
}
