use crate::bindings::host::types::types as HostTypes;
use crate::errors::ErrorType::*;

pub trait TryFromPemStr: Sized {
    fn try_from_pem_str(p: &HostTypes::Pem) -> Result<Self, HostTypes::Error>;
}

impl TryFromPemStr for pem::Pem {
    fn try_from_pem_str(key_string: &HostTypes::Pem) -> Result<Self, HostTypes::Error> {
        Ok(pem::parse(key_string.trim()).map_err(|e| CryptoError(e.to_string()))?)
    }
}
