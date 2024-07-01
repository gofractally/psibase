//! This defines macros for the [fracpack crate](https://docs.rs/fracpack) and
//! [psibase crate](https://docs.rs/psibase). See the documentation for those crates.

use fracpack_macro::fracpack_macro_impl;
use graphql_macro::{queries_macro_impl, table_query_macro_impl, table_query_subindex_macro_impl};
use number_macro::{account_macro_impl, method_macro_impl};
use proc_macro::TokenStream;
use proc_macro_error::proc_macro_error;
use reflect_macro::{reflect_attr_macro, reflect_derive_macro};
use schema_macro::schema_derive_macro;
use service_macro::service_macro_impl;
use test_case_macro::test_case_macro_impl;
use to_key_macro::to_key_macro_impl;

mod fracpack_macro;
mod graphql_macro;
mod number_macro;
mod reflect_macro;
mod schema_macro;
mod service_macro;
mod test_case_macro;
mod to_key_macro;

// TODO: remove
#[proc_macro_derive(Fracpack, attributes(fracpack))]
pub fn derive_fracpack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input, true, true)
}

#[proc_macro_derive(Pack, attributes(fracpack))]
pub fn derive_pack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input, true, false)
}

#[proc_macro_derive(Unpack, attributes(fracpack))]
pub fn derive_unpack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input, false, true)
}

#[proc_macro_derive(ToKey, attributes(to_key))]
pub fn derive_to_key(input: TokenStream) -> TokenStream {
    to_key_macro_impl(input)
}

#[proc_macro_error]
#[proc_macro_derive(Reflect, attributes(reflect, fracpack))]
pub fn derive_reflect(input: TokenStream) -> TokenStream {
    reflect_derive_macro(input)
}

#[proc_macro_error]
#[proc_macro_attribute]
pub fn reflect(attr: TokenStream, item: TokenStream) -> TokenStream {
    reflect_attr_macro(attr, item)
}

#[proc_macro_derive(ToSchema, attributes(schema, fracpack))]
pub fn to_schema(input: TokenStream) -> TokenStream {
    schema_derive_macro(input)
}

/// Define a [psibase](https://psibase.io) service interface.
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
/// # Recursion Safety
///
/// The [`recursive` option](#options), which defaults to false,
/// controls whether the service can be reentered while it's
/// currently executing. This prevents a series of exploits
/// based on this pattern:
///
/// - Service `A` calls Service `B`
/// - Service `B` calls back into Service `A`
///
/// Service `A` may opt into allowing recursion by setting the
/// `recursive` option to true. This requires very careful
/// design to prevent exploits. The following is a non-exhaustive
/// list of potential attacks:
///
/// - `A` writes to a table, calls `B`, then writes to another
///   table. Since it was in the middle of writing, `A`'s overall
///   state is inconsistent. `B` calls a method on `A` which
///   malfunctions because of the inconsistency between the
///   two tables.
/// - `A` reads some rows from a table then calls `B`. `B` calls an
///   action in `A` which modifies the table. When `B` returns,
///   `A` relies on the previously-read, but now out of date,
///   data.
/// - `A` calls `B` while iterating through a table index. `B` calls
///   an action in `A` which modifies the table. When `B` returns,
///   the iteration is now in an inconsistent state.
///
/// Rust's borrow checker doesn't prevent these attacks since
/// nothing is mutably borrowed long term. Tables wrap psibase's
/// [kv native functions](https://docs.rs/psibase/latest/psibase/native_raw/index.html),
/// which treat the underlying KV store as if it were in an
/// `UnsafeCell`. The Rust table wrappers can't protect against
/// this since it's possible, and normal under recursion, to create
/// multiple wrappers covering the same data range.
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
///     // Call another service.
///     //
///     // `call_*` methods return an object which has methods (one per action) which
///     // call another service and return the result from the call. These methods are
///     // only usable by services.
///     pub fn call() -> Actions<psibase::ServiceCaller>;
///     pub fn call_to(service: psibase::AccountNumber)
///     -> Actions<psibase::ServiceCaller>;
///     pub fn call_from(sender: psibase::AccountNumber)
///     -> Actions<psibase::ServiceCaller>;
///     pub fn call_from_to(
///         sender: psibase::AccountNumber,
///         service: psibase::AccountNumber)
///     -> Actions<psibase::ServiceCaller>;
///
///     // push transactions to psibase::Chain.
///     //
///     // `push_*` methods return an object which has methods (one per action) which
///     // push transactions to a test chain and return a psibase::ChainResult or
///     // psibase::ChainEmptyResult. This final object can verify success or failure
///     // and can retrieve the return value, if any.
///     pub fn push(
///         chain: &psibase::Chain,
///     ) -> Actions<psibase::ChainPusher>;
///     pub fn push_to(
///         chain: &psibase::Chain,
///         service: psibase::AccountNumber,
///     ) -> Actions<psibase::ChainPusher>;
///     pub fn push_from(
///         chain: &psibase::Chain,
///         sender: psibase::AccountNumber,
///     ) -> Actions<psibase::ChainPusher>;
///     pub fn push_from_to(
///         chain: &psibase::Chain,
///         sender: psibase::AccountNumber,
///         service: psibase::AccountNumber,
///     ) -> Actions<psibase::ChainPusher>;
///
///     // Pack actions into psibase::Action.
///     //
///     // `pack_*` functions return an object which has methods (one per action)
///     // which pack the action's arguments using fracpack and return a psibase::Action.
///     // The `pack_*` series of functions is mainly useful to applications which
///     // push transactions to blockchains.
///     pub fn pack() -> Actions<psibase::ActionPacker>;
///     pub fn pack_to(
///         service: psibase::AccountNumber,
///     ) -> Actions<psibase::ActionPacker>;
///     pub fn pack_from(
///         sender: psibase::AccountNumber,
///     ) -> Actions<psibase::ActionPacker>;
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
///     recursive = false,          // Allow service to be recursively entered?
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
///
/// If the `CARGO_PSIBASE_TEST` environment variable is set, then the macro
/// forces `dispatch` to false. `cargo psibase test` sets `CARGO_PSIBASE_TEST`
/// to prevent tests from having service entry points.
#[proc_macro_error]
#[proc_macro_attribute]
pub fn service(attr: TokenStream, item: TokenStream) -> TokenStream {
    service_macro_impl(attr, item)
}

/// Define a [psibase](https://psibase.io) test case.
///
/// Psibase tests run in WASM. They create block chains, push transactions,
/// and check the success or failure of those transactions to verify
/// correct service operation.
///
/// # Example
///
/// ```ignore
/// #[psibase::service]
/// mod service {
///     #[action]
///     fn add(a: i32, b: i32) -> i32 {
///         println!("Let's add {} and {}", a, b);
///         println!("Hopefully the result is {}", a + b);
///         a + b
///     }
/// }
///
/// #[psibase::test_case(services("example"))]
/// fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
///     // Verify the action works as expected.
///     assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);
///
///     // Start a new block; this prevents the following transaction
///     // from being rejected as a duplicate.
///     chain.start_block();
///
///     // Print a trace; this allows us to see:
///     // * The service call chain. Something calls our service;
///     //   let's see what it is!
///     // * The service's prints, which are normally invisible
///     //   during testing
///     println!(
///         "\n\nHere is the trace:\n{}",
///         Wrapper::push(&chain).add(3, 4).trace
///     );
///
///     // If we got this far, then the test has passed
///     Ok(())
/// }
/// ```
///
/// You may define unit tests within service sources, or define separate
/// integration tests.
///
/// # Running tests
///
/// ```text
/// cargo psibase test
/// ```
///
/// This builds and runs both unit and integration tests. It also builds
/// any services the tests depend on. These appear in the `test_case`
/// macro's `services` parameter, or as arguments to the `include_service`
/// macro.
///
/// # Loading services
///
/// Services in the `services` parameter or in the `include_service` macro
/// reference packages which define services. They may be any of the
/// following:
///
/// * The name of the current package
/// * The name of any package the current package depends on
/// * The name of any package in the current workspace, if any
///
/// If the test function has an argument, e.g. `my_test(chain: psibase::Chain)`,
/// then the macro initializes a fresh chain, loads it with the requested
/// services, and passes it to the function. If the test function doesn't
/// have an argument, then the test may initialize a chain and load services
/// itself, like the following example.
///
/// ```ignore
/// #[psibase::test_case]
/// fn my_test() -> Result<(), psibase::Error> {
///     // TODO
/// }
/// ```
///
/// The `include_service` macro is only available to functions which have
/// the `psibase::test_case` attribute. It's not defined outside of these
/// functions.
#[proc_macro_error]
#[proc_macro_attribute]
pub fn test_case(attr: TokenStream, item: TokenStream) -> TokenStream {
    test_case_macro_impl(attr, item)
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

#[proc_macro_error]
#[proc_macro_attribute]
pub fn queries(attr: TokenStream, item: TokenStream) -> TokenStream {
    queries_macro_impl(attr, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn table_query(item: TokenStream) -> TokenStream {
    table_query_macro_impl(item)
}

#[proc_macro_error]
#[proc_macro]
pub fn table_query_subindex(item: TokenStream) -> TokenStream {
    table_query_subindex_macro_impl(item)
}
