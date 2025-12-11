pub fn two_thirds_plus_one(count: u8) -> u8 {
    ((count as u16 * 2 + 3) / 3) as u8
}

/// Assigns decreasing integer levels to items, starting from `from_level`.
///
/// If `from_level` is `None`, defaults to `items.len()`
///
/// # Example
///
/// ```
/// let items = vec!["A", "B"];
/// // Explicit start level
/// let result = assign_decreasing_levels(items.clone(), Some(5));
/// assert_eq!(result, vec![(5, "A"), (4, "B")]);
///
/// // Default: start from length
/// let result = assign_decreasing_levels(items, None);
/// assert_eq!(result, vec![(2, "A"), (1, "B")]);
/// ```
pub fn assign_decreasing_levels<T>(items: Vec<T>, from_level: Option<usize>) -> Vec<(usize, T)> {
    let from_level = from_level.map_or(items.len(), |from_level| {
        psibase::check(
            from_level >= items.len(),
            "from level should be equal to or higher than items length",
        );
        from_level
    });
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let level = from_level - index;
            (level, item)
        })
        .collect()
}
