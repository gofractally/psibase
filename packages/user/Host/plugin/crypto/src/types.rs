use crate::bindings::exports::host::crypto::types::Pem;
use crate::bindings::host::types::types as CommonTypes;
use crate::errors::ErrorType::*;

pub trait TryFromPemStr: Sized {
    fn try_from_pem_str(p: &Pem) -> Result<Self, CommonTypes::Error>;
}

impl TryFromPemStr for pem::Pem {
    fn try_from_pem_str(key_string: &Pem) -> Result<Self, CommonTypes::Error> {
        Ok(pem::parse(key_string.trim()).map_err(|e| CryptoError(e.to_string()))?)
    }
}
