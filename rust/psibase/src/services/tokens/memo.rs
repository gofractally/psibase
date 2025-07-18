use async_graphql::scalar;
use fracpack::{Error, Pack, Result, ToSchema, Unpack};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, Default, Pack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Memo(String);

scalar!(Memo);

impl Memo {
    pub fn new(contents: String) -> Self {
        assert!(
            contents.len() <= 80,
            "memo must be equal to or less than 80 bytes"
        );

        Self(contents)
    }

    pub fn validate(&self) {
        assert!(
            self.0.len() <= 80,
            "memo must be equal to or less than 80 bytes"
        );
    }
}

impl fmt::Display for Memo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<String> for Memo {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl<'a> Unpack<'a> for Memo {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Memo> {
        let len = u32::unpack(src, pos)?;
        let bytes = src
            .get(*pos as usize..(*pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *pos += len;

        Ok(Self::new(
            String::from_utf8(bytes.to_vec()).or(Err(Error::BadUTF8))?,
        ))
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let len = u32::unpack(src, pos)?;
        let bytes = src
            .get(*pos as usize..(*pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *pos += len;
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))?;
        Ok(())
    }

    fn new_empty_container() -> Result<Self> {
        Ok(Default::default())
    }
}
