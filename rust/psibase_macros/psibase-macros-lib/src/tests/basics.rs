#[cfg(test)]
mod tests {
    // use crate::identity_macro_impl;
    use crate::service_macro::service_macro_impl;

    /*
    #[test]
    fn test_identity_macro_impl() {
        use crate::tests::helpers::assert_tokens_eq;
        use quote::quote;

        let attr = quote! {
            #[allow(non_snake_case)]
        };
        let before = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }

                #[action]
                fn multiply(a: i32, b: i32) -> i32 {
                    a * b
                }
            }
        };
        let expected = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }

                #[action]
                fn multiply(a: i32, b: i32) -> i32 {
                    a * b
                }
            }
        };

        let after = identity_macro_impl(attr, before);
        assert_tokens_eq(&expected, &after);
    }
    */

    /*
    #[test]
    fn test_basic_service_structure() {
        use crate::tests::helpers::assert_tokens_eq;
        use quote::quote;

        let attr = quote! {};
        let before = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }
                #[event(history)]
                fn something() {

                }
            }
        };
        let expected = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }
            }
        };

        service_macro_impl(attr, before);
        // println!("{:#?}", after);
        // assert_tokens_eq(&expected, &after);
    }
    */

    #[test]
    #[should_panic]
    // Events can only have one of 3 values: history, ui, or merkle
    // How to test the error text?
    fn test_event_attribute_parsing_event_type() {
        use quote::quote;

        let attr = quote! {};
        let before = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }
                #[event(historyui)]
                fn something() {

                }
            }
        };

        let after = service_macro_impl(attr, before);
    }

    #[test]
    #[should_panic]
    // Events can only have one event type
    fn test_event_attribute_parsing_single_event_type() {
        use quote::quote;

        let attr = quote! {};
        let before = quote! {
            mod service {
                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }
                #[event(history, ui)]
                fn something() {

                }
            }
        };

        let after = service_macro_impl(attr, before);
    }
}
