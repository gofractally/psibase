use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};
use std::ops::{Add, Div, Mul, Sub};

use crate::{precision::Precision, Asset};

#[derive(Debug, PartialEq)]
pub enum ConversionError {
    InvalidNumber,
    PrecisionOverflow,
    Overflow,
    ParseError,
}

#[derive(
    Debug,
    Copy,
    Default,
    Clone,
    Pack,
    Unpack,
    ToSchema,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
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

    pub fn from_str(amount: &str, precision: Precision) -> Result<Self, ConversionError> {
        if !amount
            .chars()
            .filter(|&c| c != '.')
            .all(|c| c.is_ascii_digit())
        {
            return Err(ConversionError::InvalidNumber);
        }
        let value = match amount.split_once('.') {
            Some((integer_part, fraction_part)) => {
                let integer_value: u64 = integer_part
                    .parse()
                    .map_err(|_| ConversionError::ParseError)?;

                let integer_value = integer_value
                    .checked_mul(10u64.pow(precision.value as u32))
                    .ok_or(ConversionError::Overflow)?;

                let fraction_len = fraction_part.len() as u8;

                if fraction_len > precision.value {
                    return Err(ConversionError::PrecisionOverflow);
                }
                let remaining_pow = precision.value - fraction_len;

                let fraction_value: u64 = fraction_part
                    .parse()
                    .map_err(|_| ConversionError::ParseError)?;

                let fraction_value = fraction_value
                    .checked_mul(10u64.pow(remaining_pow as u32))
                    .ok_or(ConversionError::Overflow)?;

                integer_value + fraction_value
            }
            None => {
                let num_value: u64 = amount.parse().map_err(|_| ConversionError::ParseError)?;
                num_value
                    .checked_mul(10u64.pow(precision.value as u32))
                    .ok_or(ConversionError::Overflow)?
            }
        };

        Ok(Self { value })
    }

    pub fn to_asset(self, precision: Precision) -> Asset {
        Asset::new(self, precision)
    }
}

#[derive(Debug)]
pub enum MathError {
    Overflow,
    PrecisionMismatch,
}

impl Add for Quantity {
    type Output = Quantity;

    fn add(self, rhs: Quantity) -> Quantity {
        self.value.checked_add(rhs.value).unwrap().into()
    }
}

impl Sub for Quantity {
    type Output = Quantity;

    fn sub(self, rhs: Self) -> Quantity {
        self.value.checked_sub(rhs.value).unwrap().into()
    }
}
