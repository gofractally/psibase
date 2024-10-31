use crate::bindings::auth_sig::plugin::types::Pem;
use crate::bindings::host::common::types as CommonTypes;
use crate::errors::ErrorType::*;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AuthRecord {
    pub pubkey: Pem,
}

#[derive(Deserialize, Debug)]
pub struct AccountDetails {
    pub account: AuthRecord,
}

#[derive(Deserialize, Debug)]
pub struct Response {
    pub data: AccountDetails,
}

pub trait TryFromPemStr: Sized {
    fn try_from_pem_str(p: &Pem) -> Result<Self, CommonTypes::Error>;
}

impl TryFromPemStr for pem::Pem {
    fn try_from_pem_str(key_string: &Pem) -> Result<Self, CommonTypes::Error> {
        Ok(pem::parse(key_string.trim()).map_err(|e| CryptoError.err(&e.to_string()))?)
    }
}
