#[crate::service(name = "email", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, AccountNumber, Hex};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn send(recipient: AccountNumber, subject: String, body: String) {
        unimplemented!()
    }
}
