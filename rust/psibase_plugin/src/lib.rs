#[cfg(target_family = "wasm")]
mod wasm {
    #[allow(warnings)]
    mod bindings {
        wit_bindgen::generate!({
            path: "wit",
            world: "plugin-imports",
            generate_all,
        });
    }

    pub mod host;
    pub use bindings::host::types::types;

    pub mod trust;
    pub use trust::{Capabilities, TrustConfig, TrustLevel};

    pub mod permissions;

    pub mod graphql;
    pub use graphql::scalars::*;

    use bindings::transact;
    use psibase::fracpack::Pack;
    use psibase::fracpack::UnpackOwned;
    use psibase::{Caller, MethodNumber, ServiceWrapper};

    pub unsafe trait PluginError: std::fmt::Display {}

    impl<T: PluginError> From<T> for types::Error {
        fn from(src: T) -> Self {
            let code = unsafe { *(&src as *const T as *const u32) };
            types::Error {
                code,
                producer: types::PluginId {
                    service: host::client::get_receiver(),
                    plugin: "plugin".to_string(),
                },
                message: src.to_string(),
            }
        }
    }

    #[derive(Clone)]
    pub struct AddToTxCaller;

    impl Caller for AddToTxCaller {
        type ReturnsNothing = ();
        type ReturnType<T: UnpackOwned> = ();

        fn call_returns_nothing<Args: Pack>(&self, method: MethodNumber, args: Args) {
            transact::plugin::intf::add_action_to_transaction(&method.to_string(), &args.packed())
                .unwrap_or_else(|e| panic!("add_action_to_transaction failed: {e}"));
        }

        fn call<Ret: UnpackOwned, Args: Pack>(&self, method: MethodNumber, args: Args) {
            transact::plugin::intf::add_action_to_transaction(&method.to_string(), &args.packed())
                .unwrap_or_else(|e| panic!("add_action_to_transaction failed: {e}"));
        }
    }

    pub trait Transact: ServiceWrapper {
        fn add_to_tx() -> Self::Actions<AddToTxCaller> {
            Self::with_caller(AddToTxCaller)
        }
    }

    impl<T: ServiceWrapper> Transact for T {}
}

#[cfg(target_family = "wasm")]
pub use wasm::*;

pub mod graphql_utils;

/* TODO: Add modules for:
 * - host:crypto
 * - host:prompt
*/
