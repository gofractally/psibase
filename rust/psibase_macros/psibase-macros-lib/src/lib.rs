pub mod service_macro;

mod tests;

use proc_macro2::TokenStream;

pub fn identity_macro_impl(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
