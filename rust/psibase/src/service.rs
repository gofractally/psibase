use crate::fracpack::{Pack, UnpackOwned};
use crate::services::transact::ServiceMethod;
use crate::{get_result_bytes, native_raw, AccountNumber, Action, MethodNumber};
use serde::de::DeserializeOwned;
use serde::Serialize;

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

#[doc(hidden)]
#[cfg(target_family = "wasm")]
pub fn service_start() {
    std::panic::set_hook(Box::new(|info| {
        crate::abort_message(info.payload_as_str().unwrap_or(""))
    }))
}

pub trait ProcessActionStruct {
    type Output;

    fn process<
        Return: Serialize + DeserializeOwned,
        ArgStruct: Pack + Serialize + DeserializeOwned,
    >(
        self,
    ) -> Self::Output;
}

pub trait WithActionStruct {
    fn with_action_struct<P: ProcessActionStruct>(action: &str, process: P) -> Option<P::Output>;
}

pub trait Caller: Clone {
    type ReturnsNothing;
    type ReturnType<T: UnpackOwned>;

    fn call_returns_nothing<Args: Pack>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnsNothing;

    fn call<Ret: UnpackOwned, Args: Pack>(
        &self,
        method: MethodNumber,
        args: Args,
    ) -> Self::ReturnType<Ret>;
}

#[derive(Clone, Default)]
pub struct JustSchema;

impl Caller for JustSchema {
    type ReturnsNothing = ();
    type ReturnType<T: UnpackOwned> = ();

    fn call_returns_nothing<Args: Pack>(&self, _method: MethodNumber, _args: Args) {}
    fn call<Ret: UnpackOwned, Args: Pack>(&self, _method: MethodNumber, _args: Args) {}
}

#[derive(Clone, Default)]
pub struct ServiceCaller {
    pub sender: AccountNumber,
    pub service: AccountNumber,
    pub flags: u64,
}

impl Caller for ServiceCaller {
    type ReturnsNothing = ();
    type ReturnType<T: UnpackOwned> = T;

    fn call_returns_nothing<Args: Pack>(&self, method: MethodNumber, args: Args) {
        let act = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        }
        .packed();
        unsafe { native_raw::call(act.as_ptr(), act.len() as u32, self.flags) };
    }

    fn call<Ret: UnpackOwned, Args: Pack>(&self, method: MethodNumber, args: Args) -> Ret {
        let act = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        }
        .packed();
        let ret = get_result_bytes(unsafe {
            native_raw::call(act.as_ptr(), act.len() as u32, self.flags)
        });
        Ret::unpacked(&ret).unwrap()
    }
}

#[derive(Clone, Default)]
pub struct ActionPacker {
    pub sender: AccountNumber,
    pub service: AccountNumber,
}

impl Caller for ActionPacker {
    type ReturnsNothing = Action;
    type ReturnType<T: UnpackOwned> = Action;

    fn call_returns_nothing<Args: Pack>(&self, method: MethodNumber, args: Args) -> Action {
        Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        }
    }

    fn call<Ret: UnpackOwned, Args: Pack>(&self, method: MethodNumber, args: Args) -> Action {
        Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        }
    }
}

pub trait ServiceWrapper {
    const SERVICE: AccountNumber;
    type Actions<T: Caller>;
    fn with_caller<T: Caller>(caller: T) -> Self::Actions<T>;

    /// Call another service.
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service and return the result from the call.
    /// This method is only usable by services.
    ///
    /// This method defaults `sender` to [`psibase::get_sender`] and `service` to `Self::SERVICE`.
    fn call() -> Self::Actions<ServiceCaller> {
        Self::call_from_to(get_service(), Self::SERVICE)
    }

    /// Call another service.
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service and return the result from the call.
    /// This method is only usable by services.
    ///
    /// This method defaults `sender` to [`psibase::get_sender`].
    fn call_to(service: AccountNumber) -> Self::Actions<ServiceCaller> {
        Self::call_from_to(get_service(), service)
    }

    /// Call another service.
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service and return the result from the call.
    /// This method is only usable by services.
    ///
    /// This method defaults `service` to `Self::SERVICE`.
    fn call_from(sender: AccountNumber) -> Self::Actions<ServiceCaller> {
        Self::call_from_to(sender, Self::SERVICE)
    }

    /// Call another service.
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service and return the result from the call.
    /// This method is only usable by services.
    fn call_from_to(sender: AccountNumber, service: AccountNumber) -> Self::Actions<ServiceCaller> {
        Self::with_caller(ServiceCaller {
            sender,
            service,
            flags: 0,
        })
    }

    /// Call another service using [runAs](psibase::services::transact::Actions::runAs).
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service via `runAs` and return the result from the call.
    /// The action will run with `sender` set to the provided account and `service` to `Self::SERVICE`.
    ///
    /// This will fail unless certain conditions are met. See [runAs](psibase::services::transact::Actions::runAs)
    /// documentation for more details.
    fn call_as(sender: AccountNumber) -> Self::Actions<RunAsCaller> {
        Self::call_as_extend(sender, Vec::new())
    }

    /// Call another service using [runAs](psibase::services::transact::Actions::runAs).
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service via `runAs` and return the result from the call.
    /// The action will run with `sender` set to the provided account and `service` to `Self::SERVICE`.
    ///
    /// This will fail unless certain conditions are met. See [runAs](psibase::services::transact::Actions::runAs)
    /// documentation for more details.
    ///
    /// This method also accepts `allowedActions` for nested `runAs` calls.
    fn call_as_extend(
        sender: AccountNumber,
        allowed_actions: Vec<ServiceMethod>,
    ) -> Self::Actions<RunAsCaller> {
        Self::with_caller(RunAsCaller {
            sender,
            service: Self::SERVICE,
            allowed_actions,
        })
    }

    /// Call another service in RPC mode.
    ///
    /// This method returns an object which has methods
    /// (one per action) which call another service and return the result from the call.
    /// This method is only usable by services.
    ///
    /// This method defaults `sender` to [`psibase::get_sender`] and `service` to `Self::SERVICE`.
    fn rpc() -> Self::Actions<ServiceCaller> {
        Self::with_caller(ServiceCaller {
            sender: get_service(),
            service: Self::SERVICE,
            flags: 1,
        })
    }

    /// Pack actions into [psibase::Action](psibase::Action).
    ///
    /// This method returns an object which has methods
    /// (one per action) which pack the action's arguments using [fracpack] and
    /// return a [psibase::Action](psibase::Action). The `pack_*` series of
    /// functions is mainly useful to applications which push transactions
    /// to blockchains.
    ///
    /// This method defaults both `sender` and `service` to `Self::SERVICE`.
    fn pack() -> Self::Actions<ActionPacker> {
        Self::pack_from_to(Self::SERVICE, Self::SERVICE)
    }

    /// Pack actions into [psibase::Action](psibase::Action).
    ///
    /// This method returns an object which has methods
    /// (one per action) which pack the action's arguments using [fracpack] and
    /// return a [psibase::Action](psibase::Action). The `pack_*` series of
    /// functions is mainly useful to applications which push transactions
    /// to blockchains.
    ///
    /// This method defaults `sender` to `Self::SERVICE`.
    fn pack_to(service: AccountNumber) -> Self::Actions<ActionPacker> {
        Self::pack_from_to(Self::SERVICE, service)
    }

    /// Pack actions into [psibase::Action](psibase::Action).
    ///
    /// This method returns an object which has methods
    /// (one per action) which pack the action's arguments using [fracpack] and
    /// return a [psibase::Action](psibase::Action). The `pack_*` series of
    /// functions is mainly useful to applications which push transactions
    /// to blockchains.
    ///
    /// This method defaults `service` to `Self::SERVICE`.
    fn pack_from(sender: AccountNumber) -> Self::Actions<ActionPacker> {
        Self::pack_from_to(sender, Self::SERVICE)
    }

    /// Pack actions into [psibase::Action](psibase::Action).
    ///
    /// This method returns an object which has methods
    /// (one per action) which pack the action's arguments using [fracpack] and
    /// return a [psibase::Action](psibase::Action). The `pack_*` series of
    /// functions is mainly useful to applications which push transactions
    /// to blockchains.
    fn pack_from_to(sender: AccountNumber, service: AccountNumber) -> Self::Actions<ActionPacker> {
        Self::with_caller(ActionPacker { sender, service })
    }
}

#[derive(Clone, Default)]
pub struct RunAsCaller {
    pub sender: AccountNumber,
    pub service: AccountNumber,
    pub allowed_actions: Vec<ServiceMethod>,
}

impl Caller for RunAsCaller {
    type ReturnsNothing = ();
    type ReturnType<T: UnpackOwned> = T;

    fn call_returns_nothing<Args: Pack>(&self, method: MethodNumber, args: Args) {
        let action = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        };
        crate::services::transact::Wrapper::call().runAs(action, self.allowed_actions.clone());
    }

    fn call<Ret: UnpackOwned, Args: Pack>(&self, method: MethodNumber, args: Args) -> Ret {
        let action = Action {
            sender: self.sender,
            service: self.service,
            method,
            rawData: args.packed().into(),
        };
        let ret =
            crate::services::transact::Wrapper::call().runAs(action, self.allowed_actions.clone());
        Ret::unpacked(&ret.0).unwrap()
    }
}
