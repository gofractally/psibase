#![allow(non_snake_case)]

use crate::AccountNumber;
use crate::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

// TODO: tables
#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack", definition_will_not_change)]
pub struct ResourceLimit {
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
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
    fn getAccount(num: AccountNumber) -> Option<super::Account> {
        unimplemented!()
    }

    #[action]
    fn getAuthOf(account: AccountNumber) -> AccountNumber {
        unimplemented!()
    }

    #[action]
    fn billCpu(name: AccountNumber, amount: i64) {
        unimplemented!();
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
