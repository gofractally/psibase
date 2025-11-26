/// Distribute tokens proportionally using a closure that gets:
/// - the item itself (&T)
/// - its index in the list (usize)
pub fn distribute_by_weight<T, F>(
    items: &[T],
    mut weight_fn: F,
    total_distribution: u64,
) -> Vec<(T, u64)>
where
    T: Clone,
    F: FnMut(usize, &T) -> u64, // ← index first, then item
{
    if items.is_empty() || total_distribution == 0 {
        return vec![];
    }

    let mut total_weight: u128 = 0;
    let mut weighted = Vec::with_capacity(items.len());

    for (i, item) in items.iter().enumerate() {
        let weight = weight_fn(i, item);
        total_weight += weight as u128;
        weighted.push((item, weight));
    }

    if total_weight == 0 {
        return vec![];
    }

    let mut remaining = total_distribution;
    let mut result = Vec::with_capacity(items.len());

    weighted.sort_unstable_by_key(|&(_, weight)| std::cmp::Reverse(weight));

    for (pos, (item, weight)) in weighted.into_iter().enumerate() {
        let amount = if pos == items.len() - 1 {
            remaining // last one gets all dust
        } else {
            let share = (weight as u128 * total_distribution as u128) / total_weight;
            share.min(u64::MAX as u128) as u64
        }
        .min(remaining);

        if amount > 0 {
            result.push((item.clone(), amount));
            remaining -= amount;
        }
    }

    result
}
