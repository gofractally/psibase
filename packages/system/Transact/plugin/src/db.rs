use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::transact::plugin::types::{Action, Claim};
use psibase::fracpack::{Pack, Unpack};
use std::cell::RefCell;
use std::thread_local;

thread_local! {
    static TX_ACTIONS: RefCell<Vec<Action>> = const { RefCell::new(Vec::new()) };
    static TX_SIGNATURES: RefCell<Vec<Claim>> = const { RefCell::new(Vec::new()) };
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

pub struct TxSignatures;

impl TxSignatures {
    pub fn reset() {
        TX_SIGNATURES.with(|t| t.borrow_mut().clear());
    }

    pub fn add(claim: Claim) {
        TX_SIGNATURES.with(|t| t.borrow_mut().push(claim));
    }

    pub fn is_empty() -> bool {
        TX_SIGNATURES.with(|t| t.borrow().is_empty())
    }

    pub fn with<R>(f: impl FnOnce(&[Claim]) -> R) -> R {
        TX_SIGNATURES.with(|t| f(&t.borrow()))
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
