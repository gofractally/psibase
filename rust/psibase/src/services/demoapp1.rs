#[crate::service(name = "demoapp1", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, Hex};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn multiply(a: u32, b: u32) {
        unimplemented!()
    }
}
