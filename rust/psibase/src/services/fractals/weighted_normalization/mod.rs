pub mod curves;
pub mod fib;

use super::constants::PPM;
use crate::services::tokens::{Decimal, Precision};

/// Raw score for an item before the distribution curve is applied.
pub trait HasScore {
    fn get_score(&self) -> Decimal;
}

fn transform_and_normalize<I, F>(inputs: I, mut curve: F) -> Vec<u32>
where
    I: IntoIterator<Item = Decimal>,
    F: FnMut(Decimal) -> Decimal,
{
    // Transform inputs by applying the curve weighting
    let outputs: Vec<u64> = inputs
        .into_iter()
        .map(|input| curve(input))
        .map(|x| {
            x.with_precision(Precision::new(4).unwrap())
                .unwrap()
                .quantity
                .value
        })
        .collect();

    // Normalize the outputs
    let total: u128 = outputs.iter().map(|&x| x as u128).sum();

    if total == 0 {
        return vec![0; outputs.len()];
    }

    outputs
        .into_iter()
        .map(|output| ((output as u128 * PPM as u128) / total) as u32)
        .collect()
}

/// For each input item, its score ([`HasScore::get_score`]) is transformed by the curve function.
/// The set of transformed scores are then normalized between 0 and [`PPM`].
///
/// **Input:**
///   * Any iterator of references to items that implement the `HasScore` trait.
///   * A curve that maps Decimal input values to Decimal output values.
///
/// **Output:**
///   * `Vec<u32>` of proportional shares on a `PPM` scale
pub fn weighted_normalization<'a, T, I, Curve>(items: I, curve: Curve) -> Vec<u32>
where
    I: IntoIterator<Item = &'a T>,
    T: HasScore + 'a,
    Curve: FnMut(Decimal) -> Decimal,
{
    let inputs = items.into_iter().map(|item| item.get_score());
    transform_and_normalize(inputs, curve)
}
