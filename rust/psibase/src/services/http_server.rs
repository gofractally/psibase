// TODO: tables

use crate as psibase;
use crate::{account, AccountNumber};

pub const COMMON_API_SERVICE: AccountNumber = account!("common-api");
pub const HOMEPAGE_SERVICE: AccountNumber = account!("homepage");

#[crate::service(name = "http-server", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn registerServer(server: AccountNumber) {
        unimplemented!()
    }
}
