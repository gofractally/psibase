#[crate::service(name = "events+1", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, HttpRequest};

    #[action]
    /// The result is the JSON text of the rows, as bytes (C++
    /// `std::vector<char>`).
    fn sqlQuery(query: String, params: Vec<psio::pssz::RawString>) -> Vec<u8> {
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
