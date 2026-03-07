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
    let _ = MyPlugin::single_whitelist();
    let _ = MyPlugin::multi_whitelist();
}
