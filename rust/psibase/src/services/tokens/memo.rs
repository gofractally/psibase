use fracpack::{FracInputStream, Pack, ToSchema, Unpack};
use std::fmt;
use std::str::FromStr;

use crate::{serialize_as_str, services::tokens::TokensError};

#[derive(Debug, Clone, ToSchema, Default, Pack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Memo(String);

impl Memo {
    pub fn new(value: String) -> Result<Self, TokensError> {
        if value.len() <= 80 {
            Ok(Self(value))
        } else {
            Err(TokensError::MemoTooLarge)
        }
    }
}

impl fmt::Display for Memo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl TryFrom<String> for Memo {
    type Error = TokensError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl FromStr for Memo {
    type Err = TokensError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s.to_string())
    }
}

impl<'a> Unpack<'a> for Memo {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn unpack(src: &mut FracInputStream) -> fracpack::Result<Self> {
        Ok(Self::new(String::unpack(src)?).map_err(|_| fracpack::Error::ExtraData)?)
    }

    fn verify(src: &mut FracInputStream) -> fracpack::Result<()> {
        let len = <&str>::unpack(src)?.len();

        if len <= 80 {
            Ok(())
        } else {
            Err(fracpack::Error::ExtraData)
        }
    }

    fn new_empty_container() -> fracpack::Result<Self> {
        Ok(Default::default())
    }
}

serialize_as_str!(Memo, "memo");
