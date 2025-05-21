use proc_macro::TokenStream;
use psibase_macros_lib::service_init_macro::service_init_macro_impl;
use quote::quote;
use syn::{parse_macro_input, ItemFn};

#[proc_macro_attribute]
pub fn service_init(attr: TokenStream, item: TokenStream) -> TokenStream {
    let input2: proc_macro2::TokenStream = item.into();
    let output2 = service_init_macro_impl(input2);
    output2.into()
}
