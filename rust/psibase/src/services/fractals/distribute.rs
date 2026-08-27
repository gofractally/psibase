use std::{collections::HashMap, hash::Hash};

use super::constants::PPM;
use crate::abort_message;

/// Distributes each group's `total` across its members according to their
/// PPM shares (via [`allocations`]) and sums each member's per-group
/// amounts into a single map.
pub fn combine_group_scores<Groups, Scores, Member: Eq + Hash>(
    groups: Groups,
) -> HashMap<Member, u32>
where
    Groups: IntoIterator<Item = (u32, Scores)>,
    Scores: IntoIterator<Item = (Member, u32)>,
{
    let mut member_allocations: HashMap<Member, u32> = HashMap::new();

    for (total, member_ppm) in groups {
        for (member, allocation) in allocations(member_ppm, total as u64) {
            *member_allocations.entry(member).or_insert(0u32) += allocation as u32;
        }
    }
    member_allocations
}

/// Yields `(element, amount)` pairs, where `amount = (ppm / PPM) * budget`
/// (integer-floored). Elements whose computed amount is zero are skipped.
///
/// Aborts if the cumulative ppm exceeds `PPM`.
pub fn allocations<I, Element>(element_ppm: I, budget: u64) -> impl Iterator<Item = (Element, u64)>
where
    I: IntoIterator<Item = (Element, u32)>,
{
    let mut total_ppm = 0u64;
    element_ppm
        .into_iter()
        .filter_map(move |(element, ppm)| {
            total_ppm += ppm as u64;
            if total_ppm > PPM as u64 {
                abort_message("ppm sum exceeds 1,000,000 / 100%");
            }
            let amount = ((ppm as u128 * budget as u128) / PPM as u128) as u64;
            (amount > 0).then_some((element, amount))
        })
}
