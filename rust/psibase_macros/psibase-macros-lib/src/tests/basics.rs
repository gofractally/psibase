#[cfg(test)]
mod tests {
    use crate::service_macro::service_macro_impl;

    #[test]
    #[should_panic]
    // Events can only have one of 2 values: history or merkle
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

        let _after = service_macro_impl(attr, before);
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
                #[event(history, merkle)]
                fn something() {

                }
            }
        };

        let _after = service_macro_impl(attr, before);
    }

    #[test]
    // `service` macro should expand and compile without requiring a `use` to provide the anyhow dep
    fn test_macro_hygiene() {
        use quote::quote;

        let attr = quote! {};
        let before = quote! {
            mod service {

                #[action]
                fn add(a: i32, b: i32) -> i32 {
                    a + b
                }
                #[event(history)]
                fn something() {}
            }
        };

        service_macro_impl(attr, before);
    }

    #[test]
    fn schema_tables_follow_table_index() {
        use crate::service_tables_macro::service_tables_macro_impl;
        use quote::quote;

        let attr = quote! {};
        let before = quote! {
            mod tables {
                #[table(name = "SecondTable", index = 1)]
                struct SecondRow {
                    id: u32,
                }
                impl SecondRow {
                    #[primary_key]
                    fn pk(&self) {}
                }

                #[table(name = "FirstTable", index = 0)]
                struct FirstRow {
                    id: u32,
                }
                impl FirstRow {
                    #[primary_key]
                    fn pk(&self) {}
                }
            }
        };

        let expanded = service_tables_macro_impl(attr, before).to_string();
        let first = expanded
            .find("\"FirstTable\"")
            .expect("schema names FirstTable");
        let second = expanded
            .find("\"SecondTable\"")
            .expect("schema names SecondTable");
        assert!(first < second, "schema emission should follow table index");
    }
}
