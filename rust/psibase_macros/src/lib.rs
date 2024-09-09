// pub use macro_derive::service_macro;
// pub use macro_derive::service_macro;

use macro_core::service_macro::service_macro_impl;
use syn::parse_macro_input;

#[test]
fn test1() {
    use quote::quote;

    let before = quote! {
        mod service {
            #[action]
            fn action1() {
                println!("only line");
            }
        }
    };
    let after = service_macro_impl(quote!(), before);
    //     // assert_tokens_eq(&expected, &after);
}
