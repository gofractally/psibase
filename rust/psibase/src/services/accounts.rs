#![allow(non_snake_case)]

use crate::AccountNumber;

use serde::{Deserialize, Serialize};
use serde_aux::field_attributes::deserialize_number_from_string;

pub const MIN_ALLOWED_ACCOUNT_LENGTH: u8 = 8;
// TODO: tables
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct Account {
    pub accountNum: AccountNumber,
    pub authService: AccountNumber,
    pub authSequence: u64,
}

/// What `newAccount` does when the account exists. In every format it is
/// its number, as the C++ `enum class NewAccountMode : std::uint8_t` is.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
)]
#[psio(transparent)]
pub struct NewAccountMode(u8);

impl NewAccountMode {
    pub const KEEP_EXISTING: NewAccountMode = NewAccountMode(0);
    pub const MATCH_EXISTING: NewAccountMode = NewAccountMode(1);
    pub const REQUIRE_NEW: NewAccountMode = NewAccountMode(2);
}

#[crate::service(name = "accounts", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::*;
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn preapproveAcc(name: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn newAccount(name: AccountNumber, authService: AccountNumber, mode: NewAccountMode) -> bool {
        unimplemented!()
    }

    #[action]
    fn setAuthServ(authService: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn exists(name: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn getAccount(name: AccountNumber) -> Option<crate::services::accounts::Account> {
        unimplemented!()
    }

    #[action]
    fn getAuthOf(account: AccountNumber) -> AccountNumber {
        unimplemented!()
    }

    #[action]
    fn incAuthSeq(name: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn freeze(accounts: Vec<AccountNumber>, memo: Option<String>) {
        unimplemented!()
    }

    #[action]
    fn unfreeze(accounts: Vec<AccountNumber>, memo: Option<String>) {
        unimplemented!()
    }

    #[event(history)]
    fn froze(account: AccountNumber, memo: Option<String>) {}

    #[event(history)]
    fn unfroze(account: AccountNumber, memo: Option<String>) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
