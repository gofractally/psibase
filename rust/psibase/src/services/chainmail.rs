#[crate::service(name = "chainmail", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, AccountNumber};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        unimplemented!()
    }
}
