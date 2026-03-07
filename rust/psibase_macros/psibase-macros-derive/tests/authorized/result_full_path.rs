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

impl MyPlugin {
    #[authorized(Low)]
    fn returns_std_result() -> std::result::Result<(), String> {
        Ok(())
    }
}

fn main() {
    let _ = MyPlugin::returns_std_result();
}
