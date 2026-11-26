use std::str::FromStr;


use crate::services::tokens::TokensError;

/// The number of decimal places of a token amount, 0 to 8.
///
/// For PSIO a precision is its number (`transparent`) and the range is an
/// invariant, so every validating reader and validated writer refuses a
/// value above 8. The ordinary writers and the trusted readers do not run
/// the invariant; `Precision::new` is what keeps a value in range.
#[derive(
    PartialEq,
    Debug,
    Copy,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[psio(transparent, invariant = "Precision::in_range")]
pub struct Precision(u8);

impl Precision {
    /// The largest precision.
    pub const MAX: u8 = 8;

    fn in_range(&self) -> Result<(), String> {
        if self.0 <= Self::MAX {
            Ok(())
        } else {
            Err(format!(
                "Value {} outside allowed Precision range: 0 to {}",
                self.0,
                Self::MAX
            ))
        }
    }

    pub fn new(value: u8) -> Result<Self, TokensError> {
        if value <= Self::MAX {
            Ok(Self(value))
        } else {
            Err(TokensError::PrecisionOverflow)
        }
    }

    pub fn value(&self) -> u8 {
        self.0
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

psio::async_graphql_scalar!(Precision, "Precision");
