use std::collections::HashMap;

use super::constants::PPM;
use crate::{abort_message, AccountNumber};

pub fn aggregate_member_weights<O, S, P>(
    groups: O,
    is_member: P,
) -> HashMap<AccountNumber, u32>
where
    O: IntoIterator<Item = (AccountNumber, u32, S)>,
    S: IntoIterator<Item = (AccountNumber, u32)>,
    P: Fn(AccountNumber) -> bool,
{
    let mut weighted_members = HashMap::new();
    for (group, group_weight, scores) in groups {
        let mut score_total = 0u64;
        for (member, score) in scores {
            if !is_member(member) {
                continue;
            }
            score_total += score as u64;
            if score_total > PPM as u64 {
                abort_message(&format!(
                    "({}) provided member scores exceed 100%",
                    group.to_string()
                ));
            }
            let weight = ((score as u64 * group_weight as u64) / PPM as u64) as u32;
            *weighted_members.entry(member).or_insert(0u32) += weight;
        }
    }
    weighted_members
}

pub fn distribute_amount<I, F>(weighted_members: I, total: u64, mut emit: F) -> u64
where
    I: IntoIterator<Item = (AccountNumber, u32)>,
    F: FnMut(AccountNumber, u64),
{
    let mut remaining = total;
    for (member, weight) in weighted_members {
        if remaining == 0 {
            break;
        }
        let amount = ((weight as u128 * total as u128) / PPM as u128) as u64;
        let amount = amount.min(remaining);
        if amount > 0 {
            emit(member, amount);
            remaining -= amount;
        }
    }
    remaining
}
