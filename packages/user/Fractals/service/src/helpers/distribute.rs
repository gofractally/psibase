pub fn distribute_by_weight<T, F>(
    items: Vec<T>,
    weight_fn: F,
    total_distribution: u64,
) -> (Vec<(T, u64)>, u64)
where
    F: Fn(usize, &T) -> u64,
{
    if items.is_empty() || total_distribution == 0 {
        return (vec![], total_distribution);
    }

    let (weighted, total_weight): (Vec<_>, u128) = items.into_iter().enumerate().fold(
        (Vec::new(), 0u128),
        |(mut weighted_items, acc_weight), (i, item)| {
            let weight = weight_fn(i, &item);
            weighted_items.push((item, weight));
            (weighted_items, acc_weight.saturating_add(weight as u128))
        },
    );

    if total_weight == 0 {
        return (vec![], total_distribution);
    }

    let mut remaining = total_distribution;
    let mut result = Vec::with_capacity(weighted.len());

    for (item, weight) in weighted {
        if remaining == 0 {
            break;
        }

        let share = (weight as u128 * total_distribution as u128) / total_weight;
        let amount = (share.min(u64::MAX as u128) as u64).min(remaining);

        if amount > 0 {
            result.push((item, amount));
            remaining -= amount;
        }
    }

    (result, remaining)
}
