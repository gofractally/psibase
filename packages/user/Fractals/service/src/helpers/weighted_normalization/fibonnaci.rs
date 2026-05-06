use crate::helpers::weighted_normalization::fib::continuous_fibonacci;

/// Assigns decreasing integer levels to items, starting from `from_level`.
///
/// # Example
///
/// ```
/// let items = vec!["A", "B"];
/// // Explicit start level
/// let result = assign_decreasing_levels(items.clone());
/// assert_eq!(result, vec![(5, "A"), (4, "B")]);
///
/// // Default: start from length
/// let result = assign_decreasing_levels(items);
/// assert_eq!(result, vec![(2, "A"), (1, "B")]);
/// ```
pub fn assign_decreasing_levels<T>(items: Vec<T>) -> Vec<(usize, T)> {
    let from_level = items.len();
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let level = from_level - index;
            (level, item)
        })
        .collect()
}

pub fn fibonnaci<T>(items: Vec<T>) -> Vec<(T, u64)> {
    use crate::helpers::weighted_normalization::fib::EXTERNAL_S;

    const MAX_FIB: u32 = 32;
    const MAX_ITEMS: u32 = 25;
    const OFFSET: u32 = MAX_FIB - MAX_ITEMS;

    assign_decreasing_levels(items)
        .into_iter()
        .map(|(level, item)| {
            (
                item,
                continuous_fibonacci((level as u32 + OFFSET) * EXTERNAL_S as u32),
            )
        })
        .collect()
}
