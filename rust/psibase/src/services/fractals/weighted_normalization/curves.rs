use crate::services::tokens::{Decimal, Precision, Quantity};

use super::fib::continuous_fibonacci;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Curve {
    Identity = 0,
    Constant = 1,
    Fibonacci = 2,
}

impl From<u8> for Curve {
    fn from(value: u8) -> Self {
        match value {
            0 => Curve::Identity,
            1 => Curve::Constant,
            2 => Curve::Fibonacci,
            _ => panic!("unsupported algo"),
        }
    }
}

impl From<Curve> for u8 {
    fn from(value: Curve) -> Self {
        value as u8
    }
}

fn constant(_: Decimal) -> Decimal {
    Decimal::new(Quantity::from(1), Precision::new(0).unwrap())
}

fn identity_curve(x: Decimal) -> Decimal {
    x
}

pub fn get_curve(curve: Curve) -> fn(Decimal) -> Decimal {
    match curve {
        Curve::Identity => identity_curve,
        Curve::Constant => constant,
        Curve::Fibonacci => continuous_fibonacci,
    }
}
