use crate::{Pack, ToKey, ToSchema, Unpack};
use async_graphql::scalar;
use chrono::{DateTime, FixedOffset, Utc};
use serde::{
    de::{Deserializer, Visitor},
    ser::Serializer,
    Deserialize, Serialize,
};
use std::{
    fmt,
    ops::{Add, Sub},
    str::FromStr,
};

#[derive(
    Debug, Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Pack, Unpack, ToKey, ToSchema,
)]
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "TimePointSec"
)]
#[to_key(psibase_mod = "crate")]
pub struct TimePointSec {
    pub seconds: i64,
}
scalar!(TimePointSec);

impl FromStr for TimePointSec {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        DateTime::<FixedOffset>::parse_from_rfc3339(s)
            .map(|dt| dt.to_utc().into())
            .map_err(|e| e.to_string())
    }
}

impl ToString for TimePointSec {
    fn to_string(&self) -> String {
        DateTime::<Utc>::from(*self).to_rfc3339()
    }
}

impl TimePointSec {
    pub fn microseconds(&self) -> TimePointUSec {
        TimePointUSec {
            microseconds: self.seconds * 1000000,
        }
    }
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
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TimePointSec {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_str(TimePointSecVisitor)
    }
}

struct TimePointSecVisitor;

impl<'de> Visitor<'de> for TimePointSecVisitor {
    type Value = TimePointSec;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a valid ISO 8601 timestamp as a string")
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        TimePointSec::from_str(v).map_err(E::custom)
    }
}

#[derive(
    Debug, Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Pack, Unpack, ToKey, ToSchema,
)]
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "TimePointUSec"
)]
#[to_key(psibase_mod = "crate")]
pub struct TimePointUSec {
    pub microseconds: i64,
}
scalar!(TimePointUSec);

impl FromStr for TimePointUSec {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        DateTime::<FixedOffset>::parse_from_rfc3339(s)
            .map(|dt| dt.to_utc().into())
            .map_err(|e| e.to_string())
    }
}

impl ToString for TimePointUSec {
    fn to_string(&self) -> String {
        DateTime::<Utc>::from(*self).to_rfc3339()
    }
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
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TimePointUSec {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_str(TimePointUSecVisitor)
    }
}

struct TimePointUSecVisitor;

impl<'de> Visitor<'de> for TimePointUSecVisitor {
    type Value = TimePointUSec;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a valid ISO 8601 timestamp as a string")
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        TimePointUSec::from_str(v).map_err(E::custom)
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
    Serialize,
    Deserialize,
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
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[to_key(psibase_mod = "crate")]
pub struct MicroSeconds {
    value: i64,
}

impl MicroSeconds {
    pub fn new(value: i64) -> MicroSeconds {
        MicroSeconds { value }
    }
}

impl Add for MicroSeconds {
    type Output = Self;

    fn add(self, other: Self) -> Self::Output {
        Self::new(self.value + other.value)
    }
}

impl Sub for MicroSeconds {
    type Output = Self;

    fn sub(self, other: Self) -> Self::Output {
        Self::new(self.value - other.value)
    }
}

impl From<Seconds> for MicroSeconds {
    fn from(value: Seconds) -> Self {
        Self::new(value.value * 1_000_000)
    }
}

impl Add<MicroSeconds> for TimePointUSec {
    type Output = Self;

    fn add(self, other: MicroSeconds) -> Self::Output {
        Self::from(self.microseconds + other.value)
    }
}

impl Sub<MicroSeconds> for TimePointUSec {
    type Output = Self;

    fn sub(self, other: MicroSeconds) -> Self::Output {
        Self::from(self.microseconds - other.value)
    }
}

// TODO: string conversions
// TODO: implement trait with the time functions helpers
