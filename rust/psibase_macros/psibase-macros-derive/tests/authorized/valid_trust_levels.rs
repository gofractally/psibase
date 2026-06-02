use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::PluginAuthorized;

impl PluginAuthorized {
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
    assert!(PluginAuthorized::trust_none().is_ok());
    assert!(PluginAuthorized::trust_low().is_ok());
    assert!(PluginAuthorized::trust_medium().is_ok());
    assert!(PluginAuthorized::trust_high().is_ok());
    assert!(PluginAuthorized::trust_max().is_ok());
}
