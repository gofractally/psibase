use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::ConversionError;

#[derive(
    PartialEq,
    Debug,
    Copy,
    Clone,
    Pack,
    Unpack,
    Serialize,
    Deserialize,
    ToSchema,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "PrecisionInput")]
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
