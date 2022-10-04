// TODO: tables

#[crate::service(name = "common-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
mod service {
    use crate::http::HttpRequest;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn serveCommon(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Vec<u8>) {
        unimplemented!()
    }
}
