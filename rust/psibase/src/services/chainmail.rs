#[crate::service(name = "chainmail", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, AccountNumber, TimePointSec};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        unimplemented!()
    }

    #[action]
    fn archive(msg_id: u64) {}

    #[action]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
        datetime: i64,
    ) {
        unimplemented!()
    }

    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: i64) {
        unimplemented!()
    }

    #[event(history)]
    pub fn sent(
        sender: AccountNumber,
        receiver: AccountNumber,
        subject: String,
        body: String,
        datetime: TimePointSec,
    ) {
    }
    #[event(history)]
    pub fn archive(msg_id: String) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
