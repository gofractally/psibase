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
    #[authorized(None)]
    fn trust_none() -> Result<(), String> {
        Ok(())
    }

    #[authorized(Low)]
    fn trust_low() -> Result<(), String> {
        Ok(())
    }

    #[authorized(Medium)]
    fn trust_medium() -> Result<(), String> {
        Ok(())
    }

    #[authorized(High)]
    fn trust_high() -> Result<(), String> {
        Ok(())
    }

    #[authorized(Max)]
    fn trust_max() -> Result<(), String> {
        Ok(())
    }
}

fn main() {
    let _ = MyPlugin::trust_none();
    let _ = MyPlugin::trust_low();
    let _ = MyPlugin::trust_medium();
    let _ = MyPlugin::trust_high();
    let _ = MyPlugin::trust_max();
}
