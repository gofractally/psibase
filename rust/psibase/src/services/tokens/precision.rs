use std::str::FromStr;

use fracpack::{Pack, ToSchema, Unpack};

use crate::{serialize_as_str, services::tokens::TokensError};

#[derive(PartialEq, Debug, Copy, Clone, Pack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Precision(u8);

impl Precision {
    pub fn new(value: u8) -> Result<Self, TokensError> {
        if value <= 8 {
            Ok(Self(value))
        } else {
            Err(TokensError::PrecisionOverflow)
        }
    }
}

impl std::fmt::Display for Precision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl TryFrom<u8> for Precision {
    type Error = TokensError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl FromStr for Precision {
    type Err = TokensError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s.parse::<u8>().map_err(|_| TokensError::InvalidNumber)?)
    }
}

impl<'a> Unpack<'a> for Precision {
    const FIXED_SIZE: u32 = 1;

    const VARIABLE_SIZE: bool = false;

    fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
        u8::unpack(src, pos)?
            .try_into()
            .map_err(|_| fracpack::Error::BadScalar)
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
        Self::unpack(src, pos)?;
        Ok(())
    }
}

serialize_as_str!(Precision, "precision");
