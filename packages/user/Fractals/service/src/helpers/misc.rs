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
/// let items = vec!["Root", "Child", "Grandchild"];
/// let leveled = assign_decreasing_levels(items, Some(3));
/// assert_eq!(leveled, vec![(3, "Root"), (2, "Child"), (1, "Grandchild")]);
/// ```
pub fn assign_decreasing_levels<T>(items: Vec<T>, from_level: Option<usize>) -> Vec<(usize, T)> {
    let from_level = from_level.unwrap_or(items.len());
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let level = from_level.saturating_sub(index);
            (level, item)
        })
        .collect()
}

/// Creates a vector of fixed length, filling with `Some(item)` from the input
/// and padding with `None` if the input is shorter.
///
/// If `items.len() > vector_length`, excess items are **discarded**.
///
/// # Examples
///
/// ```
/// let input = vec!["alice", "bob"];
/// let fixed = to_fixed_vec(input, 5);
/// assert_eq!(
///     fixed,
///     vec![
///         Some("alice"),
///         Some("bob"),
///         None,
///         None,
///         None
///     ]
/// );
/// ```
pub fn to_fixed_vec<T>(items: Vec<T>, vector_length: usize) -> Vec<Option<T>> {
    items
        .into_iter()
        .map(Some)
        .chain(std::iter::repeat_with(|| None)) // No Clone needed!
        .take(vector_length)
        .collect()
}
