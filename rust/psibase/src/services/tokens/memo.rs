use fracpack::{Error, Pack, Result, ToSchema, Unpack};
use std::{fmt, str::FromStr};

use crate::serialize_as_str;
use custom_error::custom_error;

#[derive(Debug, Clone, ToSchema, Default, Pack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Memo(String);

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

custom_error! { pub DerpError
    Idunno = "DerpError"
}
struct Derp {
    contents: String,
}

impl fmt::Display for Derp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.contents.as_str())
    }
}

impl FromStr for Derp {
    type Err = DerpError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self {
            contents: "hello".to_string(),
        })
    }
}

serialize_as_str!(Derp, "derp");

// 1100 - Call work

//
// 1615 Bunnings Brendale
// 1700 Kickinn

// Minecraft right now
// After minecraft, she wants GYG
// Bunnings, metal mouse traps;
// After that, we go to a park or something and read
// Clean a bit
// Pick outfit and go to dinner.
//
