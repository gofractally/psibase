use std::str::FromStr;

use fracpack::{Pack, ToSchema, Unpack};

use crate::{serialize_as_str, services::tokens::ConversionError};

#[derive(PartialEq, Debug, Copy, Clone, Pack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Precision(pub u8);

impl TryFrom<u8> for Precision {
    type Error = ConversionError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if value <= 8 {
            Ok(Self(value))
        } else {
            Err(ConversionError::PrecisionOverflow)
        }
    }
}

impl<'a> Unpack<'a> for Precision {
    const FIXED_SIZE: u32 = 1;

    const VARIABLE_SIZE: bool = false;

    fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
        let precision = u8::unpack(src, pos)?;
        Self::verify(src, pos)?;
        Ok(Self(precision))
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
        assert!(
            Self::unpack(src, pos).unwrap().0 <= 8,
            "precision must be 8 or less"
        );
        Ok(())
    }
}

impl FromStr for Precision {
    type Err = ConversionError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(
            s.parse::<u8>()
                .map_err(|_| ConversionError::InvalidNumber)?,
        ))
    }
}

impl std::fmt::Display for Precision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

serialize_as_str!(Precision, "precision");
