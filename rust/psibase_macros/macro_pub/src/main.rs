use macro_core::service_macro_impl;
use quote::quote;

#[test]
fn test1() {
    let before = quote! {
        mod service {
            #[action]
            fn action1() {
                println!("only line");
            }
        }
    };
    let after = service_macro_impl(quote!(), before);
    // assert_tokens_eq(&expected, &after);
}
