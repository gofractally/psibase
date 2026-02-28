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
    #[authorized(High)]
    fn returns_nothing() {
        let _x = 1 + 1;
    }
}

fn main() {
    MyPlugin::returns_nothing();
}
