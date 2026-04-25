use psibase::services::tokens::{Decimal, Precision, Quantity};

pub const PPM: u128 = 1_000_000;

pub fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

pub fn ppm_to_pct(ppm: u64) -> Decimal {
    Decimal::new(Quantity::new(ppm), Precision::new(4).unwrap())
}
