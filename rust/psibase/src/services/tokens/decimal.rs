use std::str::FromStr;

use crate::serialize_as_str;
use crate::services::tokens::{Precision, Quantity, TokensError};

/// Fixed-point decimal value stored as `quantity / 10^precision`.
///
/// `quantity` is stored exactly as provided. [`Decimal::new`](Self::new) does not
/// convert or rescale it; `precision` only controls how `quantity` is interpreted.
///
/// Examples:
/// - `quantity = 30_000`, `precision = 4` represents `3.0`
/// - `quantity = 3`, `precision = 0` also represents `3.0`
pub struct Decimal {
    pub quantity: Quantity,
    pub precision: Precision,
}

serialize_as_str!(Decimal, "decimal");

impl Decimal {
    pub fn new(quantity: Quantity, precision: Precision) -> Self {
        Self {
            quantity,
            precision,
        }
    }

    /// Rescales to `precision`
    /// * Increasing precision uses `checked_mul`; overflow returns [`TokensError::Overflow`].
    /// * Decreasing precision truncates toward zero.
    pub fn with_precision(&self, precision: Precision) -> Result<Self, TokensError> {
        let delta = precision.value() as i32 - self.precision.value() as i32;
        let value = if delta == 0 {
            self.quantity.value
        } else if delta > 0 {
            self.quantity
                .value
                .checked_mul(10_u64.pow(delta as u32))
                .ok_or(TokensError::Overflow)?
        } else {
            self.quantity.value / 10_u64.pow((-delta) as u32)
        };
        Ok(Decimal::new(Quantity::new(value), precision))
    }
}

impl std::fmt::Display for Decimal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.precision.value() == 0 {
            return write!(f, "{}", self.quantity.value.to_string());
        }
        let integer_part = self.quantity.value / 10u64.pow(self.precision.value() as u32);
        let fractional_part = self.quantity.value % 10u64.pow(self.precision.value() as u32);

        write!(
            f,
            "{}.{:0width$}",
            integer_part,
            fractional_part,
            width = self.precision.value() as usize
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

#[cfg(test)]
mod tests {

    use super::Decimal;
    use crate::services::tokens::{Precision, TokensError};

    fn create_decimal(quantity: u64, precision: u8) -> Decimal {
        Decimal::new(quantity.into(), precision.try_into().unwrap())
    }

    fn prec(p: u8) -> Precision {
        p.try_into().unwrap()
    }

    #[test]
    fn with_precision_same_units() {
        let d = create_decimal(12345, 4);
        let out = d.with_precision(prec(4)).unwrap();
        assert_eq!(out.quantity.value, 12345);
        assert_eq!(out.precision.value(), 4);
    }

    #[test]
    fn with_precision_scale_up() {
        let d = create_decimal(1, 2);
        let out = d.with_precision(prec(4)).unwrap();
        assert_eq!(out.quantity.value, 100);
    }

    #[test]
    fn with_precision_scale_down_truncates() {
        let d = create_decimal(199, 3);
        let out = d.with_precision(prec(2)).unwrap();
        assert_eq!(out.quantity.value, 19);
    }

    #[test]
    fn with_precision_overflow() {
        let d = create_decimal(u64::MAX, 0);
        assert!(matches!(
            d.with_precision(prec(1)),
            Err(TokensError::Overflow)
        ));
    }

    #[test]
    fn test_precision_0() {
        assert_eq!(create_decimal(40000, 0).to_string(), "40000");
        assert_eq!(create_decimal(1, 0).to_string(), "1");
        assert_eq!(create_decimal(0, 0).to_string(), "0");
    }

    #[test]
    fn test_precision_1() {
        assert_eq!(create_decimal(4000, 1).to_string(), "400.0");
        assert_eq!(create_decimal(1, 1).to_string(), "0.1");
        assert_eq!(create_decimal(0, 1).to_string(), "0.0");
    }

    #[test]
    fn test_precision_2() {
        assert_eq!(create_decimal(40000, 2).to_string(), "400.00");
        assert_eq!(create_decimal(1, 2).to_string(), "0.01");
        assert_eq!(create_decimal(0, 2).to_string(), "0.00");
    }

    #[test]
    fn test_precision_3() {
        assert_eq!(create_decimal(400000, 3).to_string(), "400.000");
        assert_eq!(create_decimal(1, 3).to_string(), "0.001");
        assert_eq!(create_decimal(123, 3).to_string(), "0.123");
        assert_eq!(create_decimal(0, 3).to_string(), "0.000");
    }

    #[test]
    fn test_precision_4() {
        assert_eq!(create_decimal(40000, 4).to_string(), "4.0000");
        assert_eq!(create_decimal(1, 4).to_string(), "0.0001");
        assert_eq!(create_decimal(12345, 4).to_string(), "1.2345");
        assert_eq!(create_decimal(0, 4).to_string(), "0.0000");
    }

    #[test]
    fn test_precision_5() {
        assert_eq!(create_decimal(400000, 5).to_string(), "4.00000");
        assert_eq!(create_decimal(1, 5).to_string(), "0.00001");
        assert_eq!(create_decimal(54321, 5).to_string(), "0.54321");
        assert_eq!(create_decimal(0, 5).to_string(), "0.00000");
    }

    #[test]
    fn test_precision_6() {
        assert_eq!(create_decimal(4000000, 6).to_string(), "4.000000");
        assert_eq!(create_decimal(1, 6).to_string(), "0.000001");
        assert_eq!(create_decimal(123456, 6).to_string(), "0.123456");
        assert_eq!(create_decimal(0, 6).to_string(), "0.000000");
    }

    #[test]
    fn test_precision_7() {
        assert_eq!(create_decimal(4000000, 7).to_string(), "0.4000000");
        assert_eq!(create_decimal(1, 7).to_string(), "0.0000001");
        assert_eq!(create_decimal(123456, 7).to_string(), "0.0123456");
        assert_eq!(create_decimal(0, 7).to_string(), "0.0000000");
    }

    #[test]
    fn test_precision_8() {
        assert_eq!(create_decimal(4000000, 8).to_string(), "0.04000000");
        assert_eq!(create_decimal(1, 8).to_string(), "0.00000001");
        assert_eq!(create_decimal(123456, 8).to_string(), "0.00123456");
        assert_eq!(create_decimal(0, 8).to_string(), "0.00000000");
    }

    #[test]
    #[should_panic]
    fn test_precision_18() {
        assert_eq!(
            create_decimal(4000000000000000000, 18).to_string(),
            "4.000000000000000000"
        );
        assert_eq!(create_decimal(1, 18).to_string(), "0.000000000000000001");
        assert_eq!(
            create_decimal(123456789123456789, 18).to_string(),
            "0.123456789123456789"
        );
    }

    #[test]
    fn test_large_quantity() {
        assert_eq!(
            create_decimal(u64::MAX, 0).to_string(),
            "18446744073709551615"
        );
        assert_eq!(
            create_decimal(u64::MAX, 8).to_string(),
            "184467440737.09551615"
        );
        assert_eq!(
            create_decimal(1000000000000000000, 2).to_string(),
            "10000000000000000.00"
        );
    }

    #[test]
    #[should_panic]
    fn test_invalid_precision() {
        create_decimal(1000, 19);
    }
}
