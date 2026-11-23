//! Time is PSIO's: the four psibase names are `psio::time` values, with
//! PSIO's API (`from_ticks` / `ticks`, `to_unit` / `floor` / `ceil`, the
//! operators, `Display` / `FromStr`, serde, chrono and GraphQL).
//!
//! `Seconds` / `MicroSeconds` name the *durations* here; PSIO's units of the
//! same meaning are `psio::time::Seconds` / `psio::time::Micros`.

use crate::ToKey;

/// Seconds since the Unix epoch.
pub type TimePointSec = psio::time::TimePoint<psio::time::Seconds>;
/// Microseconds since the Unix epoch.
pub type TimePointUSec = psio::time::TimePoint<psio::time::Micros>;
/// A number of seconds.
pub type Seconds = psio::time::Duration<psio::time::Seconds>;
/// A number of microseconds.
pub type MicroSeconds = psio::time::Duration<psio::time::Micros>;

// The key of the tick count, as the structs these values replaced had
// (`{ seconds: i64 }`, `{ microseconds: i64 }`, `{ value: i64 }`).
impl<U: psio::time::Unit> ToKey for psio::time::TimePoint<U> {
    fn append_key(&self, key: &mut Vec<u8>) {
        self.ticks().append_key(key)
    }
}

impl<U: psio::time::Unit> ToKey for psio::time::Duration<U> {
    fn append_key(&self, key: &mut Vec<u8>) {
        self.ticks().append_key(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fracpack::{Pack, Unpack};

    #[test]
    fn legacy_bytes_and_keys_are_the_tick_count() {
        let t = TimePointSec::from_ticks(1795342530);
        assert_eq!(t.packed(), 1795342530i64.to_le_bytes());
        assert_eq!(TimePointSec::unpacked(&t.packed()).unwrap(), t);
        assert_eq!(t.to_key(), 1795342530i64.to_key());
        assert_eq!(t.to_key(), [0x80, 0, 0, 0, 0x6b, 0x02, 0xc0, 0xc2]);
        let t = TimePointUSec::from_ticks(-1);
        assert_eq!(t.packed(), (-1i64).to_le_bytes());
        assert_eq!(t.to_key(), [0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        assert_eq!(Seconds::from_ticks(5).packed(), 5i64.to_le_bytes());
        assert_eq!(Seconds::from_ticks(5).to_key(), 5i64.to_key());
        assert_eq!(MicroSeconds::from_ticks(5).packed(), 5i64.to_le_bytes());
        assert_eq!(MicroSeconds::from_ticks(5).to_key(), 5i64.to_key());
        assert_eq!(
            Some(t).to_key(),
            [1, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
        );
    }

    #[test]
    fn json_is_psio_text() {
        let sec = TimePointSec::from_ticks(1795342530);
        let usec = TimePointUSec::from_ticks(1795342530123456);
        // Before PSIO's types: "2026-11-22T10:15:30+00:00" and
        // "2026-11-22T10:15:30.123456+00:00".
        assert_eq!(
            serde_json::to_string(&sec).unwrap(),
            r#""2026-11-22T10:15:30Z""#
        );
        assert_eq!(
            serde_json::to_string(&usec).unwrap(),
            r#""2026-11-22T10:15:30.123456Z""#
        );
        // A whole second in microseconds has its six digits (before: none).
        assert_eq!(
            serde_json::to_string(&TimePointUSec::from_ticks(1795342530000000)).unwrap(),
            r#""2026-11-22T10:15:30.000000Z""#
        );
        assert_eq!(sec.to_string(), "2026-11-22T10:15:30Z");
        assert_eq!(usec.to_string(), "2026-11-22T10:15:30.123456Z");

        // What C++ writes, and what this crate wrote before.
        for text in [
            r#""2026-11-22T10:15:30Z""#,
            r#""2026-11-22T10:15:30+00:00""#,
            r#""2026-11-22T12:15:30+02:00""#,
            r#""2026-11-22T10:15:30.000Z""#,
        ] {
            assert_eq!(serde_json::from_str::<TimePointSec>(text).unwrap(), sec);
        }
        for text in [
            r#""2026-11-22T10:15:30.123456Z""#,
            r#""2026-11-22T10:15:30.123456+00:00""#,
            r#""2026-11-22T10:15:30.123456000Z""#,
        ] {
            assert_eq!(serde_json::from_str::<TimePointUSec>(text).unwrap(), usec);
        }
        assert_eq!(
            serde_json::from_str::<TimePointUSec>(r#""2026-11-22T10:15:30Z""#).unwrap(),
            sec.to_unit().unwrap()
        );
        // A fraction the unit cannot hold is an error (before: dropped).
        assert!(serde_json::from_str::<TimePointSec>(r#""2026-11-22T10:15:30.5Z""#).is_err());

        // A duration is its tick count (before: {"value":5}).
        assert_eq!(serde_json::to_string(&Seconds::from_ticks(5)).unwrap(), "5");
        assert_eq!(
            serde_json::to_string(&MicroSeconds::from_ticks(-5)).unwrap(),
            "-5"
        );
        assert_eq!(
            serde_json::from_str::<Seconds>("5").unwrap(),
            Seconds::from_ticks(5)
        );
        println!("BIG {}", serde_json::to_string(&MicroSeconds::from_ticks(1 << 60)).unwrap());
        println!("OLDVAL {:?}", serde_json::from_str::<Seconds>(r#"{"value":5}"#).is_err());
    }

    #[test]
    fn graphql_scalars_are_psio_s() {
        use async_graphql::{InputType, OutputType};
        // Before: TimePointSec, TimePointUSec; the durations were not scalars.
        assert_eq!(<TimePointSec as OutputType>::type_name(), "DateTimeSeconds");
        assert_eq!(
            <TimePointUSec as OutputType>::type_name(),
            "DateTimeMicroseconds"
        );
        assert_eq!(<Seconds as OutputType>::type_name(), "Seconds");
        assert_eq!(<MicroSeconds as OutputType>::type_name(), "Microseconds");
        let sec = TimePointSec::from_ticks(1795342530);
        assert_eq!(
            sec.to_value(),
            async_graphql::Value::String("2026-11-22T10:15:30Z".into())
        );
        assert_eq!(
            <TimePointSec as InputType>::parse(Some(async_graphql::Value::String(
                "2026-11-22T10:15:30+00:00".into()
            )))
            .unwrap(),
            sec
        );
    }

    #[test]
    fn unit_conversions() {
        let usec = TimePointUSec::from_ticks(1795342530123456);
        let sec = TimePointSec::from_ticks(1795342530);
        assert_eq!(usec.floor::<psio::time::Seconds>(), sec);
        assert_eq!(
            usec.ceil::<psio::time::Seconds>(),
            sec + Seconds::from_ticks(1)
        );
        assert_eq!(
            sec.to_unit::<psio::time::Micros>().unwrap().ticks(),
            1795342530000000
        );
        assert_eq!(
            Seconds::from_ticks(2).to_unit().unwrap(),
            MicroSeconds::from_ticks(2_000_000)
        );
    }
}
