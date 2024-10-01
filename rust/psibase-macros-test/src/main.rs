fn main() {
    println!("Hello, world!");
}

#[cfg(test)]
mod tests {
    use psibase::AccountNumber;

    #[psibase::service(name = "testsvc")]
    mod service {
        // FOR DEMO vvv
        use async_graphql::Object;
        use psibase::anyhow;
        // FOR DEMO ^^^

        #[action]
        // got an error because serde dep wasn't present?
        fn add(a: i32, b: i32) -> i32 {
            a + b
        }
        #[event(history)]
        fn history_fn1(msg: String) {}

        struct Query;

        #[Object]
        impl Query {
            async fn query_fn1(&self) -> String {
                String::from("Return value")
            }
        }
    }

    #[test]
    fn test_event_attribute_parsing() {
        use psibase::fracpack::Pack;

        println!("test_event_attribute_parsing().top");

        assert_eq!(service::SERVICE, AccountNumber::from("testsvc"));

        service::action_structs::add { a: 2, b: 5 }.packed();

        // Q: Anything I can do to exercise this?
        // let retval = service::Actions::add(
        //     service::Actions {
        //         caller: psibase::Caller,
        //     },
        //     3,
        //     5,
        // );

        // Q: Uncommenting this line fails (big linking error)
        // let ret = service::Wrapper::call().add(2, 3);

        service::Wrapper::emit().history();
        // Q: uncommenting next line fails? (big linking error)
        // .history_fn1(String::from("important string"));

        // Q: How to call query function?

        println!("test_event_attribute_parsing().bottom");
    }
}
