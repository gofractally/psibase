use crate::fracpack::{Packable, PackableOwned};
use crate::{get_result_bytes, native_raw, reflect, AccountNumber, Action, MethodNumber, Reflect};

#[cfg(target_family = "wasm")]
static mut SERVICE: AccountNumber = AccountNumber::new(0);

#[cfg(target_family = "wasm")]
static mut SENDER: AccountNumber = AccountNumber::new(0);

/// Get currently-executing service
///
/// If the currently-executing WASM is a service, then this
/// returns the service's account. If the currently-executing
/// code is not WASM, or is not a service, then this returns 0.
#[cfg(target_family = "wasm")]
pub fn get_service() -> AccountNumber {
    unsafe { SERVICE }
}

/// Get currently-executing service
///
/// If the currently-executing WASM is a service, then this
/// returns the service's account. If the currently-executing
/// code is not WASM, or is not a service, then this returns 0.
#[cfg(not(target_family = "wasm"))]
pub fn get_service() -> AccountNumber {
    AccountNumber::new(0)
}

/// Get sender of currently-executing action
///
/// If the currently-executing WASM is a service, then this
/// returns the current action's sender. If the
/// currently-executing code is not WASM, or is not a service,
/// then this returns 0.
#[cfg(target_family = "wasm")]
pub fn get_sender() -> AccountNumber {
    unsafe { SENDER }
}

/// Get sender of currently-executing action
///
/// If the currently-executing WASM is a service, then this
/// returns the current action's sender. If the
/// currently-executing code is not WASM, or is not a service,
/// then this returns 0.
#[cfg(not(target_family = "wasm"))]
pub fn get_sender() -> AccountNumber {
    AccountNumber::new(0)
}

// The service's `start` entry point sets this. Nothing else
// should call it.
#[doc(hidden)]
#[cfg(target_family = "wasm")]
pub unsafe fn set_service(_acc: AccountNumber) {
    SERVICE = _acc;
}

// The service's `called` entry point sets this. Nothing else
// should call it. The entry point must restore the previous
// version when it returns.
#[doc(hidden)]
#[cfg(target_family = "wasm")]
pub unsafe fn set_sender(_acc: AccountNumber) {
    SENDER = _acc;
}

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
pub struct JustSchema;

impl Caller for JustSchema {
    type ReturnsNothing = ();
    type ReturnType<T: PackableOwned> = ();

    fn call_returns_nothing<Args: PackableOwned>(&self, _method: MethodNumber, _args: Args) {}
    fn call<Ret: PackableOwned, Args: PackableOwned>(&self, _method: MethodNumber, _args: Args) {}
}

impl reflect::Reflect for JustSchema {
    type StaticType = Self;
    fn reflect<V: reflect::Visitor>(_visitor: V) -> V::Return {
        unimplemented!()
    }
}

#[derive(Clone, Default, Reflect)]
#[reflect(psibase_mod = "crate")]
pub struct ServiceCaller {
    pub sender: AccountNumber,
    pub service: AccountNumber,
}

impl Caller for ServiceCaller {
    type ReturnsNothing = ();
    type ReturnType<T: PackableOwned> = T;

    fn call_returns_nothing<Args: PackableOwned>(&self, method: MethodNumber, args: Args) {
        let act = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed(),
        }
        .packed();
        unsafe { native_raw::call(act.as_ptr(), act.len() as u32) };
    }

    fn call<Ret: PackableOwned, Args: PackableOwned>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Ret {
        let act = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed(),
        }
        .packed();
        let ret = get_result_bytes(unsafe { native_raw::call(act.as_ptr(), act.len() as u32) });
        Ret::unpacked(&ret).unwrap()
    }
}

#[derive(Clone, Default, Reflect)]
#[reflect(psibase_mod = "crate")]
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
