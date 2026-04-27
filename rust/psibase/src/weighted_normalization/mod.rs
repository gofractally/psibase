mod constant;
mod fib;
mod fibonnaci;

pub use constant::constant;
pub use fibonnaci::fibonnaci;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Algorithm {
    Constant = 1,
    Fibonacci = 2,
}

impl From<u8> for Algorithm {
    fn from(value: u8) -> Self {
        match value {
            1 => Algorithm::Constant,
            2 => Algorithm::Fibonacci,
            _ => panic!("unsupported algo"),
        }
    }
}

impl From<Algorithm> for u8 {
    fn from(value: Algorithm) -> Self {
        value as u8
    }
}

pub fn weighted_normalization<T>(algo: Algorithm, items: Vec<T>) -> Vec<(T, u64)> {
    match algo {
        Algorithm::Constant => constant(items),
        Algorithm::Fibonacci => fibonnaci(items),
    }
}
