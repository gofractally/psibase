use crate::fracpack::PackableOwned;
use crate::MethodNumber;

pub trait Caller {
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
