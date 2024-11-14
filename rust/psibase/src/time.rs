use crate::{Pack, ToKey, ToSchema, Unpack};
use async_graphql::{InputObject, SimpleObject};
use chrono::{DateTime, FixedOffset, Utc};
use serde::{
    de::{Deserializer, Error as _},
    ser::Serializer,
    Deserialize, Serialize,
};
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

impl From<DateTime<Utc>> for TimePointSec {
    fn from(seconds: DateTime<Utc>) -> Self {
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

impl Serialize for TimePointSec {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(
            &DateTime::<Utc>::from_timestamp(self.seconds, 0)
                .unwrap()
                .to_rfc3339(),
        )
    }
}

impl<'de> Deserialize<'de> for TimePointSec {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = <&str>::deserialize(deserializer)?;
        Ok(DateTime::<FixedOffset>::parse_from_rfc3339(s)
            .map_err(|e| D::Error::custom(e.to_string()))?
            .to_utc()
            .into())
    }
}

// TODO: TimePointSec is both a time point and a duration
// TODO: string conversions
// TODO: implement trait with the time functions helpers
