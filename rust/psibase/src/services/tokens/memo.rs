use async_graphql::{InputObject, SimpleObject};
use fracpack::{Error, Pack, Result, ToSchema, Unpack};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, ToSchema, Serialize, Deserialize, SimpleObject, InputObject, Default)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "MemoInput")]
pub struct Memo {
    contents: String,
}

impl Memo {
    pub fn new(contents: String) -> Self {
        assert!(
            contents.len() <= 80,
            "memo must be equal to or less than 80 bytes"
        );

        Self { contents }
    }

    pub fn validate(&self) {
        assert!(
            self.contents.len() <= 80,
            "memo must be equal to or less than 80 bytes"
        );
    }
}

impl fmt::Display for Memo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.contents.fmt(f)
    }
}

impl From<String> for Memo {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl<'a> Pack for Memo {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn pack(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&(self.contents.len() as u32).to_le_bytes());
        dest.extend_from_slice(self.contents.as_bytes());
    }

    fn is_empty_container(&self) -> bool {
        self.contents.is_empty()
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

        Ok(Self {
            contents: String::from_utf8(bytes.to_vec()).or(Err(Error::BadUTF8))?,
        })
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
