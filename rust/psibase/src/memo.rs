use custom_error::custom_error;

use std::fmt;
use std::str::FromStr;

custom_error! { pub MemoError
    MemoTooLarge = "Memo must be 80 bytes or less"
}

/// A note attached to a transfer or another action: UTF-8 text of at most
/// 80 bytes.
///
/// For PSIO a memo is its text (`transparent`) and the bound is declared on
/// it, so every validating pSSZ and JSON reader (`from_pssz`, `from_ijson`)
/// and every validated writer (`try_to_pssz`, ...) refuses a longer one. The
/// ordinary writers (`to_pssz`, `to_json`) and the trusted readers do not
/// check it; a `Memo` is always within its bound because its constructors
/// refuse any other text. It is not a key: PSIO's key derive does not
/// enforce the bound of a transparent type's member.
#[derive(
    Debug,
    Clone,
    Default,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(transparent)]
pub struct Memo(#[psio(max = 80)] String);

impl Memo {
    pub fn new(value: String) -> Result<Self, MemoError> {
        if value.len() <= 80 {
            Ok(Self(value))
        } else {
            Err(MemoError::MemoTooLarge)
        }
    }

    #[must_use]
    pub const fn empty() -> Self {
        Self(String::new())
    }
}

impl fmt::Display for Memo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl TryFrom<String> for Memo {
    type Error = MemoError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl FromStr for Memo {
    type Err = MemoError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s.to_string())
    }
}

impl From<&str> for Memo {
    fn from(s: &str) -> Self {
        Memo::from_str(s).unwrap()
    }
}

psio::async_graphql_scalar!(Memo, "Memo");
