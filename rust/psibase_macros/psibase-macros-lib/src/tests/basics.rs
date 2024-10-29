#[cfg(test)]
mod tests {
    use crate::service_macro::service_macro_impl;

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
