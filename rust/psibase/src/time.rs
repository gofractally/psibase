use crate::{Pack, ToKey, ToSchema, Unpack};
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
    ToKey,
    ToSchema,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "TimePointSecInput")]
pub struct TimePointSec {
    pub seconds: i64,
}

impl From<i64> for TimePointSec {
    fn from(seconds: i64) -> Self {
        TimePointSec { seconds }
    }
}

impl From<chrono::DateTime<chrono::Utc>> for TimePointSec {
    fn from(seconds: chrono::DateTime<chrono::Utc>) -> Self {
        TimePointSec {
            seconds: seconds.timestamp(),
        }
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
