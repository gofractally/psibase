#![allow(non_snake_case)]

use crate::AccountNumber;


pub const MIN_ALLOWED_ACCOUNT_LENGTH: u8 = 8;
// TODO: tables
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct Account {
    pub accountNum: AccountNumber,
    pub authService: AccountNumber,
    pub authSequence: u64,
}

/// What `newAccount` does when the account exists (C++
/// `enum class NewAccountMode : std::uint8_t`, a reflected enum): its
/// number in PSSZ and in a key, its C++ name in JSON (`"keepExisting"`,
/// `"matchExisting"`, `"requireNew"`; the number is read too). Any other
/// number is refused wherever one is read.
#[repr(u8)]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[serde(rename_all = "camelCase")]
pub enum NewAccountMode {
    /// An existing account will be unchanged.
    KeepExisting,
    /// If the account already exists, it must match the parameters that
    /// are passed to `newAccount`: idempotent account creation.
    MatchExisting,
    /// The account must not already exist.
    RequireNew,
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
