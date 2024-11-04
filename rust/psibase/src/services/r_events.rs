#[crate::service(name = "r-events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::HttpRequest;

    #[action]
    fn sqlQuery(query: String) -> String {
        unimplemented!()
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }
}
