#[psibase::service(name = "basicwquery")]
#[allow(non_snake_case)]
mod service {
    use psibase::{
        // FOR DEMO vvv Used by event definition
        anyhow,
        // FOR DEMO ^^^
        serve_content,
        serve_simple_ui,
        HttpReply,
        HttpRequest,
        Table,
        WebContentRow,
    };

    #[table(record = "WebContentRow", index = 0)]
    struct WebContentTable;

    #[action]
    // got an error because serde dep wasn't present?
    fn add(a: i32, b: i32) -> i32 {
        // Wrapper::call() uses and therefore covers the testing of service::Actions
        assert_eq!(mincallrecvr::Wrapper::call().add2(3, 5), 8);

        // event emission must be called from within service; so this is call we can do here
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
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }
}
