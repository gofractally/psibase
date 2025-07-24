use std::str::FromStr;

use crate::serialize_as_str;
use crate::services::tokens::{TokensError, Precision, Quantity};

pub struct Decimal {
    quantity: Quantity,
    precision: Precision,
}

impl Decimal {
    pub fn new(quantity: Quantity, precision: Precision) -> Self {
        Self {
            quantity,
            precision,
        }
    }
}

impl std::fmt::Display for Decimal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.precision.0 == 0 {
            return write!(f, "{}", self.quantity.value.to_string());
        }
        let integer_part = self.quantity.value / 10u64.pow(self.precision.0 as u32);
        let fractional_part = self.quantity.value % 10u64.pow(self.precision.0 as u32);

        write!(
            f,
            "{}.{:0width$}",
            integer_part,
            fractional_part,
            width = self.precision.0 as usize
        )
    }
}

impl FromStr for Decimal {
    type Err = TokensError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if !s.chars().filter(|&c| c != '.').all(|c| c.is_ascii_digit()) {
            return Err(TokensError::InvalidNumber);
        }

        let precision: u8 = match s.split_once('.') {
            Some((_, fraction_part)) => fraction_part.len() as u8,
            None => 0,
        };
        let precision: Precision = precision.try_into()?;

        let quantity = Quantity::from_str(s, precision)?;

        Ok(Decimal::new(quantity, precision))
    }
}

serialize_as_str!(Decimal, "decimal");

#[cfg(test)]
mod tests {

    use super::Decimal;

    fn create_asset(quantity: u64, precision: u8) -> Decimal {
        Decimal::new(quantity.into(), precision.try_into().unwrap())
    }

    #[test]
    fn test_precision_0() {
        assert_eq!(create_asset(40000, 0).to_string(), "40000");
        assert_eq!(create_asset(1, 0).to_string(), "1");
        assert_eq!(create_asset(0, 0).to_string(), "0");
    }

    #[test]
    fn test_precision_1() {
        assert_eq!(create_asset(4000, 1).to_string(), "400.0");
        assert_eq!(create_asset(1, 1).to_string(), "0.1");
        assert_eq!(create_asset(0, 1).to_string(), "0.0");
    }

    #[test]
    fn test_precision_2() {
        assert_eq!(create_asset(40000, 2).to_string(), "400.00");
        assert_eq!(create_asset(1, 2).to_string(), "0.01");
        assert_eq!(create_asset(0, 2).to_string(), "0.00");
    }

    #[test]
    fn test_precision_3() {
        assert_eq!(create_asset(400000, 3).to_string(), "400.000");
        assert_eq!(create_asset(1, 3).to_string(), "0.001");
        assert_eq!(create_asset(123, 3).to_string(), "0.123");
        assert_eq!(create_asset(0, 3).to_string(), "0.000");
    }

    #[test]
    fn test_precision_4() {
        assert_eq!(create_asset(40000, 4).to_string(), "4.0000");
        assert_eq!(create_asset(1, 4).to_string(), "0.0001");
        assert_eq!(create_asset(12345, 4).to_string(), "1.2345");
        assert_eq!(create_asset(0, 4).to_string(), "0.0000");
    }

    #[test]
    fn test_precision_5() {
        assert_eq!(create_asset(400000, 5).to_string(), "4.00000");
        assert_eq!(create_asset(1, 5).to_string(), "0.00001");
        assert_eq!(create_asset(54321, 5).to_string(), "0.54321");
        assert_eq!(create_asset(0, 5).to_string(), "0.00000");
    }

    #[test]
    fn test_precision_6() {
        assert_eq!(create_asset(4000000, 6).to_string(), "4.000000");
        assert_eq!(create_asset(1, 6).to_string(), "0.000001");
        assert_eq!(create_asset(123456, 6).to_string(), "0.123456");
        assert_eq!(create_asset(0, 6).to_string(), "0.000000");
    }

    #[test]
    fn test_precision_7() {
        assert_eq!(create_asset(4000000, 7).to_string(), "0.4000000");
        assert_eq!(create_asset(1, 7).to_string(), "0.0000001");
        assert_eq!(create_asset(123456, 7).to_string(), "0.0123456");
        assert_eq!(create_asset(0, 7).to_string(), "0.0000000");
    }

    #[test]
    fn test_precision_8() {
        assert_eq!(create_asset(4000000, 8).to_string(), "0.04000000");
        assert_eq!(create_asset(1, 8).to_string(), "0.00000001");
        assert_eq!(create_asset(123456, 8).to_string(), "0.00123456");
        assert_eq!(create_asset(0, 8).to_string(), "0.00000000");
    }

    #[test]
    #[should_panic]
    fn test_precision_18() {
        assert_eq!(
            create_asset(4000000000000000000, 18).to_string(),
            "4.000000000000000000"
        );
        assert_eq!(create_asset(1, 18).to_string(), "0.000000000000000001");
        assert_eq!(
            create_asset(123456789123456789, 18).to_string(),
            "0.123456789123456789"
        );
    }

    #[test]
    fn test_large_quantity() {
        assert_eq!(
            create_asset(u64::MAX, 0).to_string(),
            "18446744073709551615"
        );
        assert_eq!(
            create_asset(u64::MAX, 8).to_string(),
            "184467440737.09551615"
        );
        assert_eq!(
            create_asset(1000000000000000000, 2).to_string(),
            "10000000000000000.00"
        );
    }

    #[test]
    #[should_panic]
    fn test_invalid_precision() {
        create_asset(1000, 19);
    }
}
