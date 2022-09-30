use proc_macro::TokenStream;
use proc_macro_error::emit_error;
use psibase_names::{account_number_from_str, account_number_to_string, method_number_from_str};
use quote::quote;
use syn::{parse_macro_input, LitStr};

pub fn account_macro_impl(as_obj: bool, item: TokenStream) -> TokenStream {
    let item = parse_macro_input!(item as LitStr);
    let n = account_number_from_str(&item.value());
    if account_number_to_string(n) != item.value() {
        emit_error!(item, "{} is not a valid AccountNumber", item.value());
    }
    if as_obj {
        TokenStream::from(quote! {psibase::AccountNumber::new(#n)})
    } else {
        TokenStream::from(quote! {#n})
    }
}

pub fn method_macro_impl(as_obj: bool, item: TokenStream) -> TokenStream {
    let item = parse_macro_input!(item as LitStr);
    let n = method_number_from_str(&item.value());
    if n == 0 && item.value() != "" {
        emit_error!(item, "{} is not a valid MethodNumber", item.value());
    }
    if as_obj {
        TokenStream::from(quote! {psibase::MethodNumber::new(#n)})
    } else {
        TokenStream::from(quote! {#n})
    }
}
