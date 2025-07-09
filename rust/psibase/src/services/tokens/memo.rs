use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::check;

#[derive(
    Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "MemoInput")]
pub struct Memo {
    contents: String,
}

impl Memo {
    pub fn new(contents: String) -> Self {
        check(
            contents.len() <= 80,
            "memo must be equal to or less than 80 bytes",
        );
        Self { contents }
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
