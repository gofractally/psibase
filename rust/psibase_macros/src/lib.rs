//! This defines macros for the [fracpack crate](https://docs.rs/fracpack) and
//! [psibase crate](https://docs.rs/psibase). See the documentation for those crates.

use fracpack_macro::fracpack_macro_impl;
use number_macro::{account_macro_impl, method_macro_impl};
use proc_macro::TokenStream;
use proc_macro_error::proc_macro_error;
use service_macro::service_macro_impl;

mod fracpack_macro;
mod number_macro;
mod service_macro;

#[proc_macro_derive(Fracpack, attributes(fracpack))]
pub fn derive_fracpack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input)
}

/// Define a [psibase](https://about.psibase.io) service interface.
///
/// This macro defines the interface to a service so that other
/// services, test cases, and apps which push transactions to the
/// blockchain may use it. It also generates the documentation for
/// the interface, using user-provided documentation as the source.
///
/// # Example
///
/// ```ignore
/// /// This service adds and multiplies i32 numbers.
/// ///
/// /// This is where a detailed description would go.
/// #[psibase::service]
/// mod service {
///     /// Add two numbers together.
///     ///
///     /// See also [Self::multiply].
///     #[action]
///     fn add(a: i32, b: i32) -> i32 {
///         a + b
///     }
///
///     /// Multiplies two numbers together.
///     ///
///     /// See also [Self::add].
///     #[action]
///     fn multiply(a: i32, b: i32) -> i32 {
///         a * b
///     }
/// }
/// ```
///
/// The service module and the actions within it may be private;
/// the macro creates public definitions (below).
///
/// The macro copies the action documentation (like above) to the
/// [`Actions<T>` methods](#actions-struct). Use the `[Self::...]`
/// syntax like above within action documentation to refer to
/// other actions.
///
/// # Generated Output
///
/// The macro adds the following definitions to the service module:
///
/// ```ignore
/// pub const  SERVICE: psibase::AccountNumber;
/// pub struct Wrapper;
/// pub struct Actions<T: psibase::Caller>;
/// pub mod    action_structs;
/// mod        service_wasm_interface;
/// ```
///
/// It reexports `SERVICE`, `Wrapper`, `Actions`, and `action_structs` as public in
/// the parent module. These names are [configurable](#options).
///
/// ## SERVICE constant
///
/// The `SERVICE` constant identifies the account the service is normally installed on. The
/// macro generates this from the package name, but this can be overridden using the `name`
/// option.
///
/// ## Wrapper struct
///
/// ```
/// pub struct Wrapper;
/// ```
///
/// The `Wrapper` struct makes it easy for other services, test cases, and Rust applications
/// to call into the service. It has the following implementation:
///
/// ```ignore
/// impl Wrapper {
///     // The account this service normally runs on
///     pub const SERVICE: psibase::AccountNumber;
///
/// # extern "C" {
///     // Pack actions into psibase::Action.
///     //
///     // `pack_*` functions return an object which has methods (one per action)
///     // which pack the action's arguments using fracpack and return a psibase::Action.
///     // The `pack_*` series of functions is mainly useful to applications which
///     // push transactions to blockchains.
///     pub fn pack() -> Actions<psibase::ActionPacker>;
///     pub fn pack_to(service: psibase::AccountNumber) -> Actions<psibase::ActionPacker>;
///     pub fn pack_from(sender: psibase::AccountNumber) -> Actions<psibase::ActionPacker>;
///     pub fn pack_from_to(
///         sender: psibase::AccountNumber,
///         service: psibase::AccountNumber,
///     ) -> Actions<psibase::ActionPacker>;
/// }
/// ```
///
/// ## Actions struct
///
/// ```ignore
/// pub struct Actions<T: psibase::Caller> {
///     pub caller: T,
/// }
/// ```
///
/// This struct's implementation contains a public method for each action. The methods have
/// the same names and arguments as the actions. The methods pass their arguments as a tuple
/// to either `Caller::call` or `Caller::call_returns_nothing`, returning the final result.
///
/// `Actions<T>` is part of the glue which makes `Wrapper` work; `Wrapper` methods return
/// `Actions<T>` instances with the appropriate inner `caller`. `Actions<T>` also documents
/// the actions themselves.
///
/// ## action_structs module
///
/// ```ignore
/// pub mod action_structs {...}
/// ```
///
/// `action_structs` contains a public struct for each action. Each struct has the same
/// name as its action and has the same fields as the action's arguments. The structs
/// implement `fracpack::Packable`.
///
/// ## service_wasm_interface module
///
/// This module defines the `start` and `called` WASM entry points. psinode
/// calls `start` to initialize the WASM whenever it is used within a
/// transaction. psinode calls `called` every time another service calls into
/// this WASM. `called` deserializes action data, calls into the appropriate
/// action function, and serializes the return value.
///
/// # Dead code warnings
///
/// When the [dispatch option](#options) is false, there is usually no code
/// remaining which calls the actions. The service macro adds `#[allow(dead_code)]`
/// to the service module when the dispatch option is false to prevent the
/// compiler from warning about it.
///
/// # Options
///
/// The service attribute has the following options. The defaults are shown:
///
/// ```ignore
/// #[psibase::service(
///     name = see_blow,            // Account service is normally installed on
///     constant = "SERVICE",       // Name of generated constant
///     actions = "Actions",        // Name of generated struct
///     wrapper = "Wrapper",        // Name of generated struct
///     structs = "action_structs", // Name of generated module
///     dispatch = see_below,       // Create service_wasm_interface?
///     pub_constant = true,        // Make constant public and reexport it?
/// )]
/// ```
///
/// `name` defaults to the package name.
///
/// `dispatch` defaults to true if the `CARGO_PRIMARY_PACKAGE` environment
/// variable is set, and false otherwise. Cargo sets this variable automatically.
/// For example, assume you have two services, A and B. B brings in A as a
/// dependency so it can use A's wrappers to call it. When cargo builds A,
/// `dispatch` will default to true in A's service definition. When cargo builds
/// B, `dispatch` will default to true in B's service definition but false
/// in A's. This prevents B from accidentally including A's dispatch.
#[proc_macro_error]
#[proc_macro_attribute]
pub fn service(attr: TokenStream, item: TokenStream) -> TokenStream {
    service_macro_impl(attr, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn account(item: TokenStream) -> TokenStream {
    account_macro_impl(true, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn account_raw(item: TokenStream) -> TokenStream {
    account_macro_impl(false, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn method(item: TokenStream) -> TokenStream {
    method_macro_impl(true, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn method_raw(item: TokenStream) -> TokenStream {
    method_macro_impl(false, item)
}
