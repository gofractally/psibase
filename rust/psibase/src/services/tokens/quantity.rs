use async_graphql::{InputObject, SimpleObject};

use serde::{Deserialize, Serialize};
use std::ops::{Add, Sub};

use crate::services::tokens::{Precision, TokensError};

fn parse_u64_part(s: &str) -> Result<u64, TokensError> {
    if s.is_empty() {
        Ok(0)
    } else {
        s.parse().map_err(|_| TokensError::InvalidNumber)
    }
}

#[derive(
    Debug,
    Copy,
    Default,
    Clone,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
    Ord,
    PartialOrd,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
)]
#[graphql(input_name = "QuantityInput")]
pub struct Quantity {
    pub value: u64,
}

impl From<u64> for Quantity {
    fn from(value: u64) -> Self {
        Self { value }
    }
}

impl Quantity {
    pub fn new(value: u64) -> Self {
        Self { value }
    }

    pub fn from_str(amount: &str, precision: Precision) -> Result<Self, TokensError> {
        if !amount.chars().all(|c| c == '.' || c.is_ascii_digit()) {
            return Err(TokensError::InvalidNumber);
        }
        if !amount.chars().any(|c| c.is_ascii_digit()) {
            return Err(TokensError::InvalidNumber);
        }
        let value = match amount.split_once('.') {
            Some((integer_part, fraction_part)) => {
                let integer_value = parse_u64_part(integer_part)?;

                let integer_value = integer_value
                    .checked_mul(10u64.pow(precision.value() as u32))
                    .ok_or(TokensError::Overflow)?;

                // More digits than a `u8` counts is more than any precision.
                let fraction_len = u8::try_from(fraction_part.len())
                    .map_err(|_| TokensError::PrecisionOverflow)?;

                if fraction_len > precision.value() {
                    return Err(TokensError::PrecisionOverflow);
                }
                let remaining_pow = precision.value() - fraction_len;

                let fraction_value = parse_u64_part(fraction_part)?;

                let fraction_value = fraction_value
                    .checked_mul(10u64.pow(remaining_pow as u32))
                    .ok_or(TokensError::Overflow)?;

                // The two parts can each fit and their sum not: a quantity is
                // at most 2^64 - 1.
                integer_value
                    .checked_add(fraction_value)
                    .ok_or(TokensError::Overflow)?
            }
            None => {
                let num_value: u64 = amount.parse().map_err(|_| TokensError::InvalidNumber)?;
                num_value
                    .checked_mul(10u64.pow(precision.value() as u32))
                    .ok_or(TokensError::Overflow)?
            }
        };

        Ok(Self { value })
    }
}

impl Add for Quantity {
    type Output = Quantity;

    fn add(self, rhs: Quantity) -> Quantity {
        self.value.checked_add(rhs.value).unwrap().into()
    }
}

impl Sub for Quantity {
    type Output = Quantity;

    fn sub(self, rhs: Self) -> Self::Output {
        self.value.checked_sub(rhs.value).unwrap().into()
    }
}

#[cfg(test)]
mod tests {
    use super::Quantity;
    use crate::services::tokens::{Precision, TokensError};

    fn read(amount: &str, precision: u8) -> Result<u64, TokensError> {
        Quantity::from_str(amount, Precision::new(precision).unwrap()).map(|q| q.value)
    }

    #[test]
    fn reads_amounts_at_a_precision() {
        assert_eq!(read("0", 0).unwrap(), 0);
        assert_eq!(read("40000", 0).unwrap(), 40000);
        assert_eq!(read("400.00", 2).unwrap(), 40000);
        assert_eq!(read("1.5", 4).unwrap(), 15000);
        assert_eq!(read(".5", 1).unwrap(), 5);
        assert_eq!(read("5.", 1).unwrap(), 50);
        assert_eq!(read("007.10", 2).unwrap(), 710);
        assert!(matches!(read("", 0), Err(TokensError::InvalidNumber)));
        assert!(matches!(read(".", 2), Err(TokensError::InvalidNumber)));
        assert!(matches!(read("1.2.3", 4), Err(TokensError::InvalidNumber)));
        assert!(matches!(read("-1", 0), Err(TokensError::InvalidNumber)));
        assert!(matches!(
            read("1.234", 2),
            Err(TokensError::PrecisionOverflow)
        ));
    }

    /// 2^64 - 1 is the largest quantity at every precision; one unit more is
    /// rejected, whichever part of the text carries it.
    #[test]
    fn a_quantity_that_does_not_fit_64_bits_is_rejected_not_wrapped() {
        let boundaries = [
            (0, "18446744073709551615", "18446744073709551616"),
            (1, "1844674407370955161.5", "1844674407370955161.6"),
            (2, "184467440737095516.15", "184467440737095516.16"),
            (4, "1844674407370955.1615", "1844674407370955.1616"),
            (7, "1844674407370.9551615", "1844674407370.9551616"),
            (8, "184467440737.09551615", "184467440737.09551616"),
        ];
        for (precision, largest, next) in boundaries {
            assert_eq!(read(largest, precision).unwrap(), u64::MAX, "{largest}");
            assert!(read(next, precision).is_err(), "{next} was read");
        }
        // The sum of the two parts overflows although each part fits: this
        // wrapped to 0 where overflow checks are off and panicked where they
        // are on.
        assert!(matches!(
            read("184467440737.09551616", 8),
            Err(TokensError::Overflow)
        ));
        assert!(matches!(
            read("184467440737.99999999", 8),
            Err(TokensError::Overflow)
        ));
        // The integer part alone.
        assert!(matches!(
            read("184467440738.00000000", 8),
            Err(TokensError::Overflow)
        ));
        assert!(matches!(
            read("1844674407370955162.0", 1),
            Err(TokensError::Overflow)
        ));
        assert!(read("99999999999999999999.9", 1).is_err());
    }

    /// A fraction of 256 digits is not a fraction of 0 digits.
    #[test]
    fn the_number_of_fraction_digits_does_not_wrap() {
        let zeros = "0".repeat(256);
        for precision in [0, 8] {
            assert!(matches!(
                read(&format!("5.{zeros}"), precision),
                Err(TokensError::PrecisionOverflow)
            ));
        }
        let one = format!("5.{}1", "0".repeat(255));
        assert!(matches!(read(&one, 0), Err(TokensError::PrecisionOverflow)));
        assert!(one.parse::<crate::services::tokens::Decimal>().is_err());
    }
}
