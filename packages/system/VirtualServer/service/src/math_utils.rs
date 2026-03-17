use psibase::services::tokens::{Decimal, Precision, Quantity};

pub const PPM: u128 = 1_000_000;

pub fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

pub fn average(list: &[u64]) -> u64 {
    if list.is_empty() {
        return 0;
    }
    // Use u128 internally to avoid overflow on the sum
    (list.iter().map(|&x| x as u128).sum::<u128>() / list.len() as u128) as u64
}

pub fn ppm_to_pct(ppm: u64) -> Decimal {
    Decimal::new(Quantity::new(ppm), Precision::new(4).unwrap())
}
