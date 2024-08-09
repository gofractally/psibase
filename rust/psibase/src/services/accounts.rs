use crate::AccountNumber;
use serde::{Deserialize, Serialize};

// TODO: tables
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimit {
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct Account {
    pub accountNum: AccountNumber,
    pub authService: AccountNumber,

    // If this is absent, it means resource usage is unlimited
    pub resourceBalance: Option<ResourceLimit>,
}

#[crate::service(name = "accounts", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn newAccount(name: AccountNumber, authService: AccountNumber, requireNew: bool) {
        unimplemented!()
    }

    #[action]
    fn setAuthServ(authService: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn exists(num: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn setCreator(creator: AccountNumber) {
        unimplemented!()
    }
}
