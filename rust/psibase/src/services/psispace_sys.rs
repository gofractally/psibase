// TODO: tables

#[crate::service(name = "psispace-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
pub mod service {
    use crate::http::HttpRequest;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpRequest> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn removeSys(path: String) {
        unimplemented!()
    }
}
