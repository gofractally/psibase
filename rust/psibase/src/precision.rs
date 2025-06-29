use std::str::FromStr;

use fracpack::{Pack, ToSchema, Unpack};

use crate::{serialize_as_str, ConversionError};

#[derive(PartialEq, Debug, Copy, Clone, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Precision {
    pub value: u8,
}

impl TryFrom<u8> for Precision {
    type Error = ConversionError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if value <= 8 {
            Ok(Self { value })
        } else {
            Err(ConversionError::PrecisionOverflow)
        }
    }
}

impl FromStr for Precision {
    type Err = ConversionError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self {
            value: s
                .parse::<u8>()
                .map_err(|_| ConversionError::InvalidNumber)?,
        })
    }
}

impl std::fmt::Display for Precision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.value)
    }
}

serialize_as_str!(Precision, "precision");
