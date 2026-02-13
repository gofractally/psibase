#[crate::service(name = "x-admin", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, HttpReply, HttpRequest, IPAddress};
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    /// Returns true if the account or the remote end of socket is a node admin
    #[action]
    fn isAdmin(
        account: Option<AccountNumber>,
        socket: Option<i32>,
        forwarded: Vec<Option<IPAddress>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn checkAuth(req: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        unimplemented!()
    }

    #[action]
    fn serveSys(req: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        unimplemented!()
    }

    #[action]
    fn startSession() {
        unimplemented!()
    }

    #[action]
    fn options() -> AdminOptionsRow {
        unimplemented!()
    }

    #[derive(Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    #[fracpack(fracpack_mod = "fracpack")]
    struct AdminOptionsRow {
        p2p: bool,
        hosts: Vec<String>,
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
