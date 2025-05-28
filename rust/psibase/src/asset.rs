use std::str::FromStr;

// use async_graphql::{InputObject, SimpleObject};
// use fracpack::{Pack, ToSchema, Unpack};
// use serde::{Deserialize, Serialize};

use crate::{serialize_as_str, ConversionError};
use crate::{Precision, Quantity};

// #[derive(
//     Debug,
//     Copy,
//     Clone,
//     Pack,
//     Unpack,
//     ToSchema,
//     PartialEq,
//     SimpleObject,
//     InputObject,
//     Deserialize,
//     Serialize,
// )]
// #[fracpack(fracpack_mod = "fracpack")]
// #[graphql(input_name = "AssetInput")]
pub struct Asset {
    quantity: Quantity,
    precision: Precision,
}

impl Asset {
    pub fn new(quantity: Quantity, precision: Precision) -> Self {
        Self {
            quantity,
            precision,
        }
    }

    pub fn format(&self) -> String {
        if self.precision.value == 0 {
            return self.quantity.value.to_string();
        }
        let integer_part = self.quantity.value / 10u64.pow(self.precision.value as u32);
        let fractional_part = self.quantity.value % 10u64.pow(self.precision.value as u32);

        format!(
            "{}.{:0width$}",
            integer_part,
            fractional_part,
            width = self.precision.value as usize
        )
    }
}

impl FromStr for Asset {
    type Err = ConversionError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if !s.chars().filter(|&c| c != '.').all(|c| c.is_ascii_digit()) {
            return Err(ConversionError::InvalidNumber);
        }

        let precision: u8 = match s.trim().split_once('.') {
            Some((_, fraction_part)) => fraction_part.len() as u8,
            None => 0,
        };
        let precision: Precision = precision.into();

        let quantity = Quantity::from_str(s, precision)?;

        Ok(Asset::new(quantity, precision))
    }
}

impl std::fmt::Display for Asset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.format())
    }
}

serialize_as_str!(Asset, "asset");

#[cfg(test)]
mod tests {
    use super::Asset;

    fn create_asset(quantity: u64, precision: u8) -> Asset {
        Asset::new(quantity.into(), precision.into())
    }

    #[test]
    fn test_precision_0() {
        assert_eq!(create_asset(40000, 0).format(), "40000");
        assert_eq!(create_asset(1, 0).format(), "1");
        assert_eq!(create_asset(0, 0).format(), "0");
    }

    #[test]
    fn test_precision_1() {
        assert_eq!(create_asset(4000, 1).format(), "400.0");
        assert_eq!(create_asset(1, 1).format(), "0.1");
        assert_eq!(create_asset(0, 1).format(), "0.0");
    }

    #[test]
    fn test_precision_2() {
        assert_eq!(create_asset(40000, 2).format(), "400.00");
        assert_eq!(create_asset(1, 2).format(), "0.01");
        assert_eq!(create_asset(0, 2).format(), "0.00");
    }

    #[test]
    fn test_precision_3() {
        assert_eq!(create_asset(400000, 3).format(), "400.000");
        assert_eq!(create_asset(1, 3).format(), "0.001");
        assert_eq!(create_asset(123, 3).format(), "0.123");
    }

    #[test]
    fn test_precision_4() {
        assert_eq!(create_asset(40000, 4).format(), "4.0000");
        assert_eq!(create_asset(1, 4).format(), "0.0001");
        assert_eq!(create_asset(12345, 4).format(), "1.2345");
    }

    #[test]
    fn test_precision_5() {
        assert_eq!(create_asset(400000, 5).format(), "4.00000");
        assert_eq!(create_asset(1, 5).format(), "0.00001");
        assert_eq!(create_asset(54321, 5).format(), "0.54321");
    }

    #[test]
    fn test_precision_6() {
        assert_eq!(create_asset(4000000, 6).format(), "4.000000");
        assert_eq!(create_asset(1, 6).format(), "0.000001");
        assert_eq!(create_asset(123456, 6).format(), "0.123456");
    }

    #[test]
    fn test_precision_18() {
        assert_eq!(
            create_asset(4000000000000000000, 18).format(),
            "4.000000000000000000"
        );
        assert_eq!(create_asset(1, 18).format(), "0.000000000000000001");
        assert_eq!(
            create_asset(123456789123456789, 18).format(),
            "0.123456789123456789"
        );
    }

    #[test]
    fn test_large_quantity() {
        assert_eq!(create_asset(u64::MAX, 0).format(), "18446744073709551615");
        assert_eq!(create_asset(u64::MAX, 18).format(), "18.446744073709551615");
        assert_eq!(
            create_asset(1000000000000000000, 18).format(),
            "1.000000000000000000"
        );
    }

    #[test]
    #[should_panic(expected = "max precision is 18")]
    fn test_invalid_precision() {
        create_asset(1000, 19);
    }

    #[test]
    fn test_zero_high_precision() {
        assert_eq!(create_asset(0, 18).format(), "0.000000000000000000");
        assert_eq!(create_asset(0, 10).format(), "0.0000000000");
        assert_eq!(create_asset(0, 5).format(), "0.00000");
    }
}
