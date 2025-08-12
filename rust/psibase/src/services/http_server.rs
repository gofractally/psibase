// TODO: tables

use crate as psibase;
use crate::{account, AccountNumber};

pub const COMMON_API_SERVICE: AccountNumber = account!("common-api");
pub const HOMEPAGE_SERVICE: AccountNumber = account!("homepage");

#[crate::service(name = "http-server", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Action, HttpReply};

    #[action]
    fn sendProds(action: Action) {
        unimplemented!()
    }

    /// Indicates that the query is not expected to produce an immediate response
    /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
    #[action]
    fn deferReply(socket: i32) {
        unimplemented!()
    }

    /// Indicates that a reply will be produced by the current transaction/query/callback
    /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
    #[action]
    fn claimReply(socket: i32) {
        unimplemented!()
    }

    /// Sends a reply
    #[action]
    fn sendReply(socket: i32, response: HttpReply) {
        unimplemented!()
    }

    #[action]
    fn registerServer(server: AccountNumber) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
