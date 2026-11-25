use crate::wasm::bindings::transact;


use psibase::{Caller, MethodNumber, ServiceWrapper};

#[derive(Clone)]
pub struct AddToTxCaller;

impl Caller for AddToTxCaller {
    type ReturnsNothing = ();
    type ReturnType<T: psio::pssz::PsszPack<psio::Pssz> + psio::pssz::PsszUnpack<psio::Pssz>> = ();

    fn call_returns_nothing<Args: psio::interface::Method>(&self, method: MethodNumber, args: Args) {
        transact::plugin::api::add_action_to_transaction(&method.to_string(), &psio::to_pssz(&args))
            .unwrap_or_else(|e| panic!("add_action_to_transaction failed: {e}"));
    }

    fn call<
        Ret: psio::pssz::PsszPack<psio::Pssz> + psio::pssz::PsszUnpack<psio::Pssz>,
        Args: psio::interface::Method<Result = Ret>,
    >(
        &self,
        method: MethodNumber,
        args: Args,
    ) {
        self.call_returns_nothing(method, args)
    }
}

/// A trait that allows a plugin to add actions to the current transaction.
pub trait Transact: ServiceWrapper {
    fn add_to_tx() -> Self::Actions<AddToTxCaller> {
        Self::with_caller(AddToTxCaller)
    }
}

impl<T: ServiceWrapper> Transact for T {}
