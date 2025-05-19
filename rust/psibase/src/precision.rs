use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

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

impl From<u8> for Precision {
    fn from(value: u8) -> Self {
        if value <= 18 {
            panic!("invalid precision")
        }
        Self { value }
    }
}
