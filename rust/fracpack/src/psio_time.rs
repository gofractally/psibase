// TEMPORARY: removed with fracpack
//
// The legacy coders of the PSIO time values that psibase uses
// (`psibase::TimePointSec`, `TimePointUSec`, `Seconds`, `MicroSeconds`).
// Until the wire flip fracpack still produces every byte, so these keep the
// bytes and the schema nodes of the structs the values replaced:
//
//   TimePointSec  { seconds: i64 }       definition_will_not_change, custom = "TimePointSec"
//   TimePointUSec { microseconds: i64 }  definition_will_not_change, custom = "TimePointUSec"
//   Seconds       { value: i64 }         definition_will_not_change
//   MicroSeconds  { value: i64 }         definition_will_not_change

use crate::{AnyType, FracInputStream, Pack, Result, SchemaBuilder, ToSchema, Unpack};
use psio::time::{Duration, Micros, Seconds, TimePoint};

macro_rules! legacy_time {
    ($ty:ty, $field:literal $(, $custom:literal)?) => {
        impl Pack for $ty {
            const FIXED_SIZE: u32 = <i64 as Pack>::FIXED_SIZE;
            const VARIABLE_SIZE: bool = false;
            fn pack(&self, dest: &mut Vec<u8>) {
                self.ticks().pack(dest)
            }
        }
        impl<'a> Unpack<'a> for $ty {
            const FIXED_SIZE: u32 = <i64 as Unpack>::FIXED_SIZE;
            const VARIABLE_SIZE: bool = false;
            fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
                <i64 as Unpack>::unpack(src).map(Self::from_ticks)
            }
            fn verify(src: &mut FracInputStream) -> Result<()> {
                <i64 as Unpack>::verify(src)
            }
        }
        impl ToSchema for $ty {
            fn schema(builder: &mut SchemaBuilder) -> AnyType {
                let mut fields = indexmap::IndexMap::new();
                fields.insert($field.into(), builder.insert::<i64>());
                let result = AnyType::Struct(fields);
                $(let result = AnyType::Custom {
                    type_: Box::new(result),
                    id: $custom.into(),
                };)?
                result
            }
        }
    };
}

legacy_time!(TimePoint<Seconds>, "seconds", "TimePointSec");
legacy_time!(TimePoint<Micros>, "microseconds", "TimePointUSec");
legacy_time!(Duration<Seconds>, "value");
legacy_time!(Duration<Micros>, "value");

#[cfg(test)]
mod tests {
    use super::*;
    use crate as fracpack;

    // The structs the PSIO values replaced, as rust/psibase/src/time.rs
    // declared them.
    #[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
    #[fracpack(
        definition_will_not_change,
        fracpack_mod = "fracpack",
        custom = "TimePointSec"
    )]
    struct OldTimePointSec {
        seconds: i64,
    }
    #[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
    #[fracpack(
        definition_will_not_change,
        fracpack_mod = "fracpack",
        custom = "TimePointUSec"
    )]
    struct OldTimePointUSec {
        microseconds: i64,
    }
    #[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
    #[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
    struct OldDuration {
        value: i64,
    }

    // A record and containers around the value: the embedding (fixed size,
    // no heap, not optional) is the old struct's too.
    macro_rules! around {
        ($name:ident, $ty:ty) => {
            #[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
            #[fracpack(fracpack_mod = "fracpack")]
            struct $name {
                before: u8,
                value: $ty,
                optional: Option<$ty>,
                list: Vec<$ty>,
                pair: ($ty, String),
            }
        };
    }

    fn schema_of<T: ToSchema + 'static>() -> String {
        let mut builder = SchemaBuilder::new();
        builder.insert_named::<T>("t".into());
        serde_json::to_string(&builder.build()).unwrap()
    }

    macro_rules! same {
        ($old_ty:ty, $old:expr, $new_ty:ty) => {{
            around!(AroundOld, $old_ty);
            around!(AroundNew, $new_ty);
            let old: fn(i64) -> $old_ty = $old;
            let new: fn(i64) -> $new_ty = <$new_ty>::from_ticks;
            assert_eq!(<$old_ty as Pack>::FIXED_SIZE, <$new_ty as Pack>::FIXED_SIZE);
            assert_eq!(<$old_ty as Pack>::VARIABLE_SIZE, <$new_ty as Pack>::VARIABLE_SIZE);
            assert_eq!(<$old_ty as Pack>::IS_OPTIONAL, <$new_ty as Pack>::IS_OPTIONAL);
            assert_eq!(<$old_ty as Unpack>::FIXED_SIZE, <$new_ty as Unpack>::FIXED_SIZE);
            assert_eq!(<$old_ty as Unpack>::VARIABLE_SIZE, <$new_ty as Unpack>::VARIABLE_SIZE);
            assert_eq!(<$old_ty as Unpack>::IS_OPTIONAL, <$new_ty as Unpack>::IS_OPTIONAL);
            for ticks in [0, 1, -1, 1795342530, 1795342530123456, i64::MIN, i64::MAX] {
                let bytes = old(ticks).packed();
                assert_eq!(bytes, ticks.to_le_bytes());
                assert_eq!(new(ticks).packed(), bytes);
                assert_eq!(<$new_ty>::unpacked(&bytes).unwrap(), new(ticks));
                <$new_ty>::verify_no_extra(&bytes).unwrap();
                assert!(<$new_ty>::unpacked(&bytes[..7]).is_err());
                assert!(<$new_ty>::verify_no_extra(&bytes[..7]).is_err());

                let bytes = AroundOld {
                    before: 7,
                    value: old(ticks),
                    optional: Some(old(ticks)),
                    list: vec![old(ticks), old(0)],
                    pair: (old(ticks), "x".to_string()),
                }
                .packed();
                let around = AroundNew {
                    before: 7,
                    value: new(ticks),
                    optional: Some(new(ticks)),
                    list: vec![new(ticks), new(0)],
                    pair: (new(ticks), "x".to_string()),
                };
                assert_eq!(around.packed(), bytes);
                assert_eq!(AroundNew::unpacked(&bytes).unwrap(), around);
                AroundNew::verify_no_extra(&bytes).unwrap();
            }
            assert_eq!(schema_of::<$old_ty>(), schema_of::<$new_ty>());
            assert_eq!(schema_of::<AroundOld>(), schema_of::<AroundNew>());
        }};
    }

    #[test]
    fn legacy_bytes_and_schema_are_those_of_the_replaced_structs() {
        same!(OldTimePointSec, |seconds| OldTimePointSec { seconds }, TimePoint<Seconds>);
        same!(
            OldTimePointUSec,
            |microseconds| OldTimePointUSec { microseconds },
            TimePoint<Micros>
        );
        same!(OldDuration, |value| OldDuration { value }, Duration<Seconds>);
        same!(OldDuration, |value| OldDuration { value }, Duration<Micros>);
    }
}
