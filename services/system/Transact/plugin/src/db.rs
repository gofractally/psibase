use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::transact::plugin::types::{Action, Claim};
use psibase::fracpack::{Pack, Unpack};
use std::cell::RefCell;
use std::thread_local;

pub struct ActionAuthPlugins;
impl ActionAuthPlugins {
    const KEY: &'static str = "action_auth_plugin";

    pub fn set(auth_plugin: String) {
        Keyvalue::set(Self::KEY, &auth_plugin.packed()).expect("Failed to set auth plugin");
    }

    pub fn get() -> Option<String> {
        Keyvalue::get(Self::KEY)
            .map(|a| <String>::unpacked(&a).expect("Failed to unpack auth plugin"))
    }

    pub fn has() -> bool {
        Keyvalue::get(Self::KEY).is_some()
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY);
    }
}

#[derive(Pack, Unpack, Clone, Debug)]
pub struct ActionMetadata {
    pub action: Action,
    pub label: Option<String>,
}

thread_local! {
    static CURRENT_ACTIONS_MEMORY: RefCell<Vec<ActionMetadata>> = RefCell::new(Vec::new());
}

pub struct CurrentActions;
impl CurrentActions {
    pub fn push(action: Action, label: Option<String>) {
        CURRENT_ACTIONS_MEMORY.with(|mem| mem.borrow_mut().push(ActionMetadata { action, label }));
    }

    pub fn get() -> Vec<ActionMetadata> {
        CURRENT_ACTIONS_MEMORY.with(|mem| mem.borrow().clone())
    }

    pub fn has_actions() -> bool {
        CURRENT_ACTIONS_MEMORY.with(|mem| !mem.borrow().is_empty())
    }

    pub fn clear() {
        CURRENT_ACTIONS_MEMORY.with(|mem| mem.borrow_mut().clear());
    }
}

#[derive(Pack, Unpack)]
pub struct Claims {
    pub claimant: String,
    pub claims: Vec<Claim>,
}

pub struct ActionClaims;
impl ActionClaims {
    const KEY_CLAIMS: &'static str = "claims";

    pub fn get_all() -> Vec<Claims> {
        Keyvalue::get(Self::KEY_CLAIMS)
            .map(|a| <Vec<Claims>>::unpacked(&a).expect("Failed to unpack claims"))
            .unwrap_or_default()
    }

    pub fn get_all_flat() -> Vec<Claim> {
        Self::get_all().into_iter().flat_map(|c| c.claims).collect()
    }

    pub fn push(claimant: String, new_claims: Vec<Claim>) {
        let mut all_claims = Self::get_all();

        if let Some(existing) = all_claims.iter_mut().find(|c| c.claimant == claimant) {
            existing.claims.extend(new_claims);
        } else {
            all_claims.push(Claims {
                claimant,
                claims: new_claims,
            });
        }

        Keyvalue::set(Self::KEY_CLAIMS, &all_claims.packed()).expect("Failed to set claims");
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY_CLAIMS);
    }
}

pub struct ActionSenderHook;
impl ActionSenderHook {
    const KEY: &'static str = "action_sender";

    pub fn set(sender: String) {
        Keyvalue::set(Self::KEY, &sender.packed()).expect("Failed to set action sender");
    }

    pub fn get() -> Option<String> {
        Keyvalue::get(Self::KEY)
            .map(|a| <String>::unpacked(&a).expect("Failed to unpack action sender"))
    }

    pub fn has() -> bool {
        Keyvalue::get(Self::KEY).is_some()
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY);
    }
}

pub struct TxTransformLabel;
impl TxTransformLabel {
    const KEY_LABEL: &'static str = "tx_transform_label";
    const KEY_PLUGIN: &'static str = "tx_transform_app";

    pub fn set(transformer: String, label: Option<String>) {
        Keyvalue::set(Self::KEY_LABEL, &label.packed()).expect("Failed to set tx transform label");
        Keyvalue::set(Self::KEY_PLUGIN, &transformer.packed())
            .expect("Failed to set tx transform app");
    }

    pub fn get_transformer_plugin() -> Option<String> {
        Keyvalue::get(Self::KEY_PLUGIN)
            .map(|a| <String>::unpacked(&a).expect("Failed to unpack tx transform app"))
    }

    pub fn get_current_label() -> Option<String> {
        Keyvalue::get(Self::KEY_LABEL).map_or(None, |a| {
            <Option<String>>::unpacked(&a).expect("Failed to unpack tx transform label")
        })
    }

    pub fn has() -> bool {
        Keyvalue::get(Self::KEY_PLUGIN).is_some()
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY_PLUGIN);
        Keyvalue::delete(Self::KEY_LABEL);
    }
}
