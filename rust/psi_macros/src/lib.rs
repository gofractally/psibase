use fracpack_macro::fracpack_macro_impl;
use proc_macro::TokenStream;

mod fracpack_macro;

#[proc_macro_derive(Fracpack)]
pub fn derive_fracpack(input: TokenStream) -> TokenStream {
    fracpack_macro_impl(input)
}
