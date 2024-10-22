use crate::bindings::accounts::smart_auth::smart_auth::Action as PartialAction;
use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};

pub struct AuthPlugins;
impl AuthPlugins {
    const KEY_AUTH_PLUGINS: &'static str = "auth_plugins";
    pub fn push(auth_plugin: String) {
        let mut auth_plugins = Self::get();
        auth_plugins.push(auth_plugin);

        Keyvalue::set(Self::KEY_AUTH_PLUGINS, &auth_plugins.packed())
            .expect("Failed to set auth plugins");
    }

    pub fn get() -> Vec<String> {
        Keyvalue::get(Self::KEY_AUTH_PLUGINS)
            .map(|a| <Vec<String>>::unpacked(&a).expect("Failed to unpack auth plugins"))
            .unwrap_or(vec![])
    }

    pub fn has_plugins() -> bool {
        Keyvalue::get(Self::KEY_AUTH_PLUGINS).is_some()
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY_AUTH_PLUGINS);
    }
}

pub struct CurrentActions;
impl CurrentActions {
    const KEY_ACTIONS: &'static str = "actions";

    pub fn push(service: String, method_name: String, packed_args: Vec<u8>) {
        let mut actions = Keyvalue::get(Self::KEY_ACTIONS)
            .map(|a| <Vec<PartialAction>>::unpacked(&a).expect("Failed to unpack actions"))
            .unwrap_or(vec![]);

        actions.push(PartialAction {
            service,
            method: method_name,
            raw_data: packed_args,
        });

        Keyvalue::set(Self::KEY_ACTIONS, &actions.packed()).expect("Failed to set actions");
    }

    pub fn get() -> Vec<PartialAction> {
        Keyvalue::get(Self::KEY_ACTIONS)
            .map(|a| <Vec<PartialAction>>::unpacked(&a).expect("Failed to unpack actions"))
            .unwrap_or(vec![])
    }

    pub fn has_actions() -> bool {
        Keyvalue::get(Self::KEY_ACTIONS).is_some()
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY_ACTIONS);
    }
}
