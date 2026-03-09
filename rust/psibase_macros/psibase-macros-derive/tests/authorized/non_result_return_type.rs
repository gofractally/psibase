use psibase_macros_derive::authorized;

#[path = "types_mock.rs"]
mod psibase_plugin;
use psibase_plugin::{PluginAuthorized, PluginInvalid, PluginNotAuthorized};

impl PluginAuthorized {
    #[authorized(High)]
    fn returns_nothing() {
        let _x = 1 + 1;
    }
}

impl PluginNotAuthorized {
    #[authorized(High)]
    fn returns_nothing() {
        let _x = 1 + 1;
    }
}

impl PluginInvalid {
    #[authorized(High)]
    fn returns_nothing() {
        let _x = 1 + 1;
    }
}

fn main() {
    PluginAuthorized::returns_nothing();

    let _ = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    assert!(std::panic::catch_unwind(|| PluginNotAuthorized::returns_nothing()).is_err());
    assert!(std::panic::catch_unwind(|| PluginInvalid::returns_nothing()).is_err());
}
