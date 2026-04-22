use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::transact::plugin::types::{Action, Claim};
use psibase::fracpack::{Pack, Unpack};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::thread_local;

pub struct ActionAuthPlugins;
impl ActionAuthPlugins {
    const KEY: &'static str = "action_auth_plugin";

    pub fn set(auth_plugin: String) {
        Keyvalue::set(Self::KEY, &auth_plugin.packed());
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

thread_local! {
    static TX_ACTIONS: RefCell<Vec<Action>> = const { RefCell::new(Vec::new()) };
    static LATCH: RefCell<Option<ProposeLatch>> = const { RefCell::new(None) };
}

pub struct ProposeLatch {
    /// Account that subsequent actions added under this latch will use as their sender.
    /// The actual sender for any particular action is stored in the action.
    pub subsequent_action_sender: String,
    pub actions: Vec<Action>,
}

pub struct TxActions;

impl TxActions {
    pub fn reset() {
        TX_ACTIONS.with(|t| t.borrow_mut().clear());
    }

    pub fn add(action: Action) {
        TX_ACTIONS.with(|t| t.borrow_mut().push(action));
    }

    pub fn is_empty() -> bool {
        TX_ACTIONS.with(|t| t.borrow().is_empty())
    }

    pub fn take() -> Vec<Action> {
        TX_ACTIONS.with(|t| std::mem::take(&mut *t.borrow_mut()))
    }
}

impl ProposeLatch {
    pub fn open(action_sender: String) {
        LATCH.with(|l| {
            let mut l = l.borrow_mut();
            assert!(
                l.is_none(),
                "ProposeLatch::open called while a latch is open"
            );
            *l = Some(ProposeLatch {
                subsequent_action_sender: action_sender,
                actions: Vec::new(),
            });
        });
    }

    pub fn take() -> Option<ProposeLatch> {
        LATCH.with(|l| l.borrow_mut().take())
    }

    pub fn add(action: Action) -> bool {
        LATCH.with(|l| match l.borrow_mut().as_mut() {
            Some(latch) => {
                latch.actions.push(action);
                true
            }
            None => false,
        })
    }

    pub fn subsequent_action_sender() -> Option<String> {
        LATCH.with(|l| {
            l.borrow()
                .as_ref()
                .map(|latch| latch.subsequent_action_sender.clone())
        })
    }

    pub fn is_active() -> bool {
        LATCH.with(|l| l.borrow().is_some())
    }

    pub fn clear() {
        LATCH.with(|l| *l.borrow_mut() = None);
    }
}

#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub claimant: String,
    pub claims: Vec<Claim>,
}

pub struct ActionClaims;
impl ActionClaims {
    const KEY_CLAIMS: &'static str = "claims";

    pub fn get_all() -> Vec<Claims> {
        Keyvalue::get(Self::KEY_CLAIMS)
            .map(|a| serde_json::from_slice(&a).expect("Failed to unpack claims"))
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

        Keyvalue::set(
            Self::KEY_CLAIMS,
            &serde_json::to_vec(&all_claims).expect("Failed to pack claims"),
        );
    }

    pub fn clear() {
        Keyvalue::delete(Self::KEY_CLAIMS);
    }
}

pub struct ActionSenderHook;
impl ActionSenderHook {
    const KEY: &'static str = "action_sender";

    pub fn set(sender: String) {
        Keyvalue::set(Self::KEY, &sender.packed());
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
