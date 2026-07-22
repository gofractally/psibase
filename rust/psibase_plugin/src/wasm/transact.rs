use crate::wasm::bindings::transact;
use psibase::fracpack::Pack;
use psibase::fracpack::UnpackOwned;
use psibase::{Caller, MethodNumber, ServiceWrapper};

#[derive(Clone)]
pub struct AddToTxCaller;

impl Caller for AddToTxCaller {
    type ReturnsNothing = ();
    type ReturnType<T: UnpackOwned> = ();

    fn call_returns_nothing<Args: Pack>(&self, method: MethodNumber, args: Args) {
        self.call::<(), _>(method, args);
    }

    fn call<Ret: UnpackOwned, Args: Pack>(&self, method: MethodNumber, args: Args) {
        transact::plugin::intf::add_action_to_transaction(&method.to_string(), &args.packed())
            .unwrap_or_else(|e| panic!("add_action_to_transaction failed: {e}"));
    }
}

/// A trait that allows a plugin to add actions to the current transaction.
pub trait Transact: ServiceWrapper {
    fn add_to_tx() -> Self::Actions<AddToTxCaller> {
        Self::with_caller(AddToTxCaller)
    }
}

impl<T: ServiceWrapper> Transact for T {}
