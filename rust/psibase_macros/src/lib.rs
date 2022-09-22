use contract_macro::contract_macro_impl;
use fracpack_macro::fracpack_macro_impl;
use number_macro::{account_macro_impl, method_macro_impl};
use proc_macro::TokenStream;
use proc_macro_error::proc_macro_error;

mod contract_macro;
mod fracpack_macro;
mod number_macro;

#[proc_macro_derive(Fracpack, attributes(fracpack))]
pub fn derive_fracpack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input)
}

#[proc_macro_error]
#[proc_macro_attribute]
pub fn contract(attr: TokenStream, item: TokenStream) -> TokenStream {
    contract_macro_impl(attr, item)
}

#[proc_macro_error]
#[proc_macro]
pub fn account(item: TokenStream) -> TokenStream {
    account_macro_impl(item)
}

#[proc_macro_error]
#[proc_macro]
pub fn method(item: TokenStream) -> TokenStream {
    method_macro_impl(item)
}
