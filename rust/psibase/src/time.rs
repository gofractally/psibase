use crate::{Pack, Reflect, ToKey, ToSchema, Unpack};
use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};
use std::ops::{Add, Sub};

#[derive(
    Debug,
    Copy,
    Clone,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    ToSchema,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "TimePointSecInput")]
pub struct TimePointSec {
    pub seconds: u32,
}

impl From<u32> for TimePointSec {
    fn from(seconds: u32) -> Self {
        TimePointSec { seconds }
    }
}

impl Add for TimePointSec {
    type Output = Self;

    fn add(self, other: Self) -> Self::Output {
        Self {
            seconds: self.seconds + other.seconds,
        }
    }
}

impl Sub for TimePointSec {
    type Output = Self;

    fn sub(self, other: Self) -> Self::Output {
        Self {
            seconds: self.seconds - other.seconds,
        }
    }
}

// TODO: TimePointSec is both a time point and a duration
// TODO: string conversions
// TODO: JSON
// TODO: implement trait with the time functions helpers
