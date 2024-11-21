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
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "TimePointSec"
)]
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

impl From<TimePointSec> for DateTime<Utc> {
    fn from(time: TimePointSec) -> Self {
        Self::from_timestamp(time.seconds, 0).expect("Timestamp out of range")
    }
}

impl Serialize for TimePointSec {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&DateTime::<Utc>::from(*self).to_rfc3339())
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
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "TimePointUSec"
)]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "TimePointUSecInput")]
pub struct TimePointUSec {
    pub microseconds: i64,
}

impl TimePointUSec {
    pub fn seconds(&self) -> TimePointSec {
        TimePointSec {
            seconds: self.microseconds / 1000000,
        }
    }
}

impl From<i64> for TimePointUSec {
    fn from(microseconds: i64) -> Self {
        TimePointUSec { microseconds }
    }
}

impl From<DateTime<Utc>> for TimePointUSec {
    fn from(seconds: DateTime<Utc>) -> Self {
        TimePointUSec {
            microseconds: seconds.timestamp_micros(),
        }
    }
}

impl From<TimePointUSec> for DateTime<Utc> {
    fn from(time: TimePointUSec) -> Self {
        Self::from_timestamp_micros(time.microseconds).expect("Timestamp out of range")
    }
}

impl Serialize for TimePointUSec {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&DateTime::<Utc>::from(*self).to_rfc3339())
    }
}

impl<'de> Deserialize<'de> for TimePointUSec {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = <&str>::deserialize(deserializer)?;
        Ok(DateTime::<FixedOffset>::parse_from_rfc3339(s)
            .map_err(|e| D::Error::custom(e.to_string()))?
            .to_utc()
            .into())
    }
}

#[derive(
    Debug, Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Pack, Unpack, ToKey, ToSchema,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[to_key(psibase_mod = "crate")]
pub struct Seconds {
    value: i64,
}

impl Seconds {
    pub fn new(value: i64) -> Seconds {
        Seconds { value }
    }
}

impl Add for Seconds {
    type Output = Self;

    fn add(self, other: Self) -> Self::Output {
        Self::new(self.value + other.value)
    }
}

impl Sub for Seconds {
    type Output = Self;

    fn sub(self, other: Self) -> Self::Output {
        Self::new(self.value - other.value)
    }
}

impl Add<Seconds> for TimePointSec {
    type Output = Self;

    fn add(self, other: Seconds) -> Self::Output {
        Self::from(self.seconds + other.value)
    }
}

impl Add<Seconds> for TimePointUSec {
    type Output = Self;

    fn add(self, other: Seconds) -> Self::Output {
        Self::from(self.microseconds + other.value * 1000000)
    }
}

impl Sub<Seconds> for TimePointSec {
    type Output = Self;

    fn sub(self, other: Seconds) -> Self::Output {
        Self::from(self.seconds - other.value)
    }
}

impl Sub<Seconds> for TimePointUSec {
    type Output = Self;

    fn sub(self, other: Seconds) -> Self::Output {
        Self::from(self.microseconds - other.value * 1000000)
    }
}

// TODO: string conversions
// TODO: implement trait with the time functions helpers
