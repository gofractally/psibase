#[crate::service(name = "events+1", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, HttpRequest};

    #[action]
    fn sqlQuery(query: String, params: Vec<String>) -> String {
        unimplemented!()
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
