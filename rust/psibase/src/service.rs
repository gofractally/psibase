use crate::fracpack::PackableOwned;
use crate::MethodNumber;

// TODO: Bump the minimum required to 1.65 after it's stable and drop 1.64 support
pub trait Caller {
    type ReturnsNothing;

    fn call_returns_nothing<Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnsNothing;

    #[rustversion::since(1.65)]
    type ReturnType<T: PackableOwned>;

    #[rustversion::since(1.65)]
    fn call<Ret: PackableOwned, Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnType<Ret>;

    #[rustversion::before(1.65)]
    type ReturnType;

    #[rustversion::before(1.65)]
    fn call<Ret: PackableOwned, Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnType;
}
