#[psibase::service(name = "basicwquery")]
#[allow(non_snake_case)]
mod service {
    use psibase::{serve_simple_ui, HttpReply, HttpRequest};

    #[action]
    fn add(a: i32, b: i32) -> i32 {
        // Wrapper::call() uses and therefore covers the testing of service::Actions
        assert_eq!(mincallrecvr::Wrapper::call().add2(3, 5), 8);

        // event emission must be called from within service
        Wrapper::emit()
            .history()
            .history_fn1(String::from("Test string"));

        a + b
    }

    #[event(history)]
    pub fn history_fn1(msg: String) {}

    struct Query;

    #[async_graphql::Object]
    impl Query {
        async fn query_fn1(&self) -> String {
            String::from("Return value")
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
    }
}
