use crate::fracpack::PackableOwned;
use crate::{AccountNumber, Action, MethodNumber};

pub trait Caller: Clone {
    type ReturnsNothing;
    type ReturnType<T: PackableOwned>;

    fn call_returns_nothing<Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnsNothing;

    fn call<Ret: PackableOwned, Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnType<Ret>;
}

#[derive(Clone, Default)]
pub struct ActionPacker {
    pub sender: AccountNumber,
    pub service: AccountNumber,
}

impl Caller for ActionPacker {
    type ReturnsNothing = Action;
    type ReturnType<T: PackableOwned> = Action;

    fn call_returns_nothing<Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Action {
        Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed(),
        }
    }

    fn call<Ret: PackableOwned, Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Action {
        Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed(),
        }
    }
}
