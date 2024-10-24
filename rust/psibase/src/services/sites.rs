// TODO: tables

#[crate::service(name = "sites", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, Hex};

    #[action]
    fn enableSpa(enable: bool) {
        unimplemented!()
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn removeSys(path: String) {
        unimplemented!()
    }
}
